"use client";

// Party state for the whole app (migration 137), mounted once in the root
// layout so an invite reaches you on any home-screen page, not just the hub.
//
// - Keeps `my_party()` fresh: a payload-free Broadcast nudge on
//   `party-user:<your id>` triggers a re-read (coalesced), with a slow poll and
//   wake-up re-reads as the safety net, like the room page.
// - Shows incoming invites as a toast (Accept / Decline) outside rooms.
// - Follows the leader: when the leader opens or joins a lobby (party_goto),
//   each member joins that lobby too. Only lobbies picked in the last 2 minutes
//   (server clock) are followed, each one once per device.
//
// Accepting an invite fires a `vv-party-joined` window event so the hub can
// switch to its Play tab, where the party is shown.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { IconX } from "@tabler/icons-react";
import { supabase } from "@/lib/supabase";
import {
  getMyParty,
  inviteToParty,
  leaveParty,
  partyGoto,
  partyReasonText,
  removeFromParty,
  respondToPartyInvite,
  setPartyMode,
  PARTY_FOLLOW_WINDOW_S,
  type Party,
  type PartyInvite,
  type PartyResult,
} from "@/lib/party";
import { joinRoom } from "@/lib/room";
import { setStoredPlayerId, setStoredPlayerName } from "@/lib/player";
import type { QueueKind } from "@/lib/matchmaking";
import { CharacterAvatar } from "./CharacterAvatar";
import { heading } from "./ui/royal";

export const PARTY_JOINED_EVENT = "vv-party-joined";

type PartyCtx = {
  userId: string | null;
  party: Party | null;
  invites: PartyInvite[];
  // In a party with at least one other member.
  inParty: boolean;
  // You lead your party — or you're solo, which counts as leading yourself.
  isLeader: boolean;
  invite: (userId: string, mode: QueueKind) => Promise<PartyResult>;
  respond: (inviteId: string, accept: boolean) => Promise<PartyResult>;
  leave: () => Promise<PartyResult>;
  remove: (userId: string) => Promise<PartyResult>;
  setMode: (mode: QueueKind) => Promise<PartyResult>;
  goto: (code: string) => Promise<PartyResult>;
};

const noop = async (): Promise<PartyResult> => ({ ok: false, reason: "forbidden" });
const Ctx = createContext<PartyCtx>({
  userId: null,
  party: null,
  invites: [],
  inParty: false,
  isLeader: true,
  invite: noop,
  respond: noop,
  leave: noop,
  remove: noop,
  setMode: noop,
  goto: noop,
});

export const useParty = () => useContext(Ctx);

const POLL_MS = 20_000;
const FOLLOWED_KEY = "vv_party_followed";

function readFollowed(): string | null {
  try {
    return localStorage.getItem(FOLLOWED_KEY);
  } catch {
    return null;
  }
}
function writeFollowed(key: string) {
  try {
    localStorage.setItem(FOLLOWED_KEY, key);
  } catch {
    /* private mode: the in-memory guard still stops a double follow */
  }
}

type Snapshot = { forUser: string; party: Party | null; invites: PartyInvite[] };

export function PartyProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname() ?? "/";
  const inRoom = path.startsWith("/room/");

  const [userId, setUserId] = useState<string | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [responding, setResponding] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const followingRef = useRef<string | null>(null);

  // Accounts only: an anonymous (logged-out) session has no party.
  useEffect(() => {
    let active = true;
    const pick = (u: { id: string; is_anonymous?: boolean } | null | undefined) =>
      u && !u.is_anonymous ? u.id : null;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(pick(data.session?.user));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(pick(session?.user));
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      refreshRef.current = () => {};
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight = false;
    let again = false;

    const run = async () => {
      timer = null;
      if (inflight) {
        again = true;
        return;
      }
      inflight = true;
      try {
        const s = await getMyParty();
        if (!disposed) setSnap({ forUser: userId, ...s });
      } catch {
        /* transient: the next nudge or poll retries */
      } finally {
        inflight = false;
        if (again && !disposed) {
          again = false;
          schedule(0);
        }
      }
    };
    const schedule = (delay = 150) => {
      if (disposed || timer) return;
      timer = setTimeout(run, delay);
    };
    refreshRef.current = () => schedule(0);

    const channel = supabase
      .channel(`party-user:${userId}`)
      .on("broadcast", { event: "changed" }, () => schedule())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") schedule(0);
      });
    const poll = setInterval(() => schedule(0), POLL_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    schedule(0);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Only show what belongs to the account that's signed in now.
  const current = snap && userId && snap.forUser === userId ? snap : null;
  const party = current?.party ?? null;
  const invites = useMemo(() => current?.invites ?? [], [current]);
  const inParty = (party?.members.length ?? 0) > 1;
  const isLeader = !party || party.leaderId === userId;

  // Follow the leader into the lobby they picked.
  useEffect(() => {
    if (!party || !userId || inRoom || party.leaderId === userId) return;
    if (!party.roomCode || party.roomAgeS == null || party.roomAgeS > PARTY_FOLLOW_WINDOW_S) return;
    const key = `${party.id}:${party.roomSetAt}`;
    if (followingRef.current === key || readFollowed() === key) return;
    followingRef.current = key;
    writeFollowed(key);
    const name = party.members.find((m) => m.userId === userId)?.username || "Player";
    const code = party.roomCode;
    void (async () => {
      try {
        const { room, player } = await joinRoom(code, name, userId);
        setStoredPlayerName(name);
        setStoredPlayerId(player.id);
        router.push(`/room/${room.code}`);
      } catch (e) {
        const why = e instanceof Error ? e.message : "Something went wrong.";
        setNotice(`Couldn't follow your party into lobby ${code}. ${why}`);
      }
    })();
  }, [party, userId, inRoom, router]);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(id);
  }, [notice]);

  const after = useCallback(async (p: Promise<PartyResult>): Promise<PartyResult> => {
    try {
      return await p;
    } finally {
      refreshRef.current();
    }
  }, []);

  const respond = useCallback(
    async (inviteId: string, accept: boolean) => {
      const res = await after(respondToPartyInvite(inviteId, accept));
      if (accept && res.ok) window.dispatchEvent(new Event(PARTY_JOINED_EVENT));
      return res;
    },
    [after]
  );

  const value = useMemo<PartyCtx>(
    () => ({
      userId,
      party,
      invites,
      inParty,
      isLeader,
      invite: (id, mode) => after(inviteToParty(id, mode)),
      respond,
      leave: () => after(leaveParty()),
      remove: (id) => after(removeFromParty(id)),
      setMode: (mode) => after(setPartyMode(mode)),
      goto: (code) => after(partyGoto(code)),
    }),
    [userId, party, invites, inParty, isLeader, after, respond]
  );

  async function onRespond(invite: PartyInvite, accept: boolean) {
    if (responding) return;
    setResponding(invite.id);
    try {
      const res = await respond(invite.id, accept);
      if (!res.ok && accept) setNotice(partyReasonText(res.reason, invite.fromUsername));
      else if (res.ok && accept && path !== "/") router.push("/");
    } catch {
      setNotice("Couldn't answer that invite. Please try again.");
    } finally {
      setResponding(null);
    }
  }

  const shown = !inRoom && userId ? invites[0] : undefined;

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {shown && (
            <motion.div
              key={shown.id}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border-2 border-gold bg-home-bg/95 p-3 text-cream shadow-[0_10px_30px_rgba(0,0,0,.5)] backdrop-blur"
              role="alertdialog"
              aria-label={`${shown.fromUsername} invited you to their party`}
            >
              <CharacterAvatar
                character={shown.fromCharacter}
                initials={shown.fromUsername.slice(0, 2).toUpperCase()}
                className="h-11 w-11 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-semibold ${heading}`}>{shown.fromUsername}</div>
                <div className="text-xs text-cream/70">
                  invited you to their party · {shown.partySize}/3
                  {invites.length > 1 && <span className="text-cream/50"> · +{invites.length - 1} more</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => void onRespond(shown, true)}
                  disabled={!!responding}
                  className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Join
                </button>
                <button
                  onClick={() => void onRespond(shown, false)}
                  disabled={!!responding}
                  aria-label="Decline"
                  className="rounded-lg border border-cream/30 p-1.5 text-cream/70 transition-colors hover:bg-cream/10 hover:text-cream disabled:opacity-50"
                >
                  <IconX size={16} aria-hidden />
                </button>
              </div>
            </motion.div>
          )}
          {notice && (
            <motion.div
              key="notice"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border border-gold/50 bg-home-bg/95 p-3 text-sm text-cream shadow-lg"
              role="status"
            >
              <span className="flex-1">{notice}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-cream/60 hover:text-cream">
                <IconX size={16} aria-hidden />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
