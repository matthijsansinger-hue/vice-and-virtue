"use client";

// Opened from a party "+": your friends with where they are right now
// (migration 136 presence). Only friends on the home screen can be invited;
// friends in a lobby or a game show that status and can't be picked until
// they're back. Offline friends sit at the bottom, greyed. Friends already in
// your party or invited say so instead of offering Invite.

import { useEffect, useState } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import { heading } from "./ui/royal";
import { getFriendData, type FriendEntry } from "@/lib/friends";
import {
  getFriendsPresence,
  PRESENCE_LABEL,
  type PresenceStatus,
} from "@/lib/presence";

const ORDER: Record<PresenceStatus, number> = { home: 0, lobby: 1, game: 2, offline: 3 };
const DOT: Record<PresenceStatus, string> = {
  home: "#5fd068",
  lobby: "#e3b510",
  game: "#e6889a",
  offline: "rgba(255,239,197,.3)",
};
const REFRESH_MS = 10_000;

export function FriendPicker({
  meId,
  partyIds,
  invitedIds,
  full,
  onInvite,
  onAddFriends,
}: {
  meId: string;
  partyIds: Set<string>;
  invitedIds: Set<string>;
  // No room for another invite (members + pending invites = 3).
  full: boolean;
  // Resolves to an error message, or null when the invite went out.
  onInvite: (friendId: string, username: string) => Promise<string | null>;
  onAddFriends: () => void;
}) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [status, setStatus] = useState<Map<string, PresenceStatus>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  // Shown as invited straight away, before the party refresh lands.
  const [justInvited, setJustInvited] = useState<Set<string>>(new Set());

  async function invite(id: string, username: string) {
    if (sending) return;
    setSending(id);
    setInviteError(null);
    try {
      const err = await onInvite(id, username);
      if (err) setInviteError(err);
      else setJustInvited((prev) => new Set(prev).add(id));
    } catch {
      setInviteError("Couldn't send that invite. Please try again.");
    } finally {
      setSending(null);
    }
  }

  useEffect(() => {
    let active = true;
    getFriendData(meId)
      .then((d) => active && setFriends(d.friends))
      .catch(() => active && setError("Couldn't load your friends."));
    return () => {
      active = false;
    };
  }, [meId]);

  useEffect(() => {
    let active = true;
    const load = () =>
      getFriendsPresence()
        .then((m) => active && setStatus(m))
        .catch(() => {
          /* keep the last known statuses */
        });
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const statusOf = (id: string): PresenceStatus => status.get(id) ?? "offline";
  const sorted = [...(friends ?? [])].sort(
    (a, b) =>
      ORDER[statusOf(a.profile.id)] - ORDER[statusOf(b.profile.id)] ||
      a.profile.username.localeCompare(b.profile.username)
  );

  return (
    <div>
      <h2 className={`text-xl font-semibold tracking-wide text-gold ${heading}`}>Invite to your party</h2>
      <p className="mt-1 text-xs text-cream/60">
        Up to 2 friends. Friends on the home screen can be invited; friends in a lobby or a game once they&rsquo;re
        back. An invite lasts 3 minutes.
      </p>
      {full && (
        <p className="mt-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-cream/80">
          Your party is full.
        </p>
      )}
      {inviteError && <p className="mt-2 text-sm text-red-300">{inviteError}</p>}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {friends === null && !error && <p className="mt-4 text-center text-sm text-cream/55">Loading friends…</p>}

      {friends !== null && friends.length === 0 && (
        <div className="mt-4 text-center">
          <p className="text-sm text-cream/70">You haven&rsquo;t added any friends yet.</p>
          <button
            onClick={onAddFriends}
            className="mt-3 rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10"
          >
            Find friends
          </button>
        </div>
      )}

      {sorted.length > 0 && (
        <ul className="mt-3 flex max-h-[55dvh] flex-col gap-1.5 overflow-y-auto pr-1">
          {sorted.map(({ profile: p }) => {
            const s = statusOf(p.id);
            const inParty = partyIds.has(p.id);
            const invited = !inParty && (invitedIds.has(p.id) || justInvited.has(p.id));
            const invitable = s === "home" && !full;
            return (
              <li
                key={p.id}
                className={`flex items-center gap-3 rounded-xl border border-gold/15 bg-black/20 px-3 py-2 ${s === "offline" ? "opacity-55" : ""}`}
              >
                <CharacterAvatar
                  character={p.appearance}
                  initials={p.username.slice(0, 2).toUpperCase()}
                  className="h-10 w-10 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{p.username}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-cream/65">
                    <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: DOT[s] }} />
                    {PRESENCE_LABEL[s]}
                  </div>
                </div>
                {inParty ? (
                  <span className="shrink-0 text-xs font-semibold text-gold">In your party</span>
                ) : invited ? (
                  <span className="shrink-0 text-xs font-semibold text-cream/70">Invited</span>
                ) : (
                  s !== "offline" && (
                    <button
                      onClick={() => void invite(p.id, p.username)}
                      disabled={!invitable || sending !== null}
                      title={
                        full
                          ? "Your party is full"
                          : s === "home"
                            ? undefined
                            : `${p.username} is ${PRESENCE_LABEL[s].toLowerCase()}`
                      }
                      className="shrink-0 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-35"
                    >
                      {sending === p.id ? "Sending…" : "Invite"}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
