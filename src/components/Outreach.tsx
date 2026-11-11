"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  PhaseTimer,
  StatePanel,
} from "@/components/ui/royal";
import { supabase } from "@/lib/supabase";
import { setReady, endOutreach, OUTREACH_SECONDS } from "@/lib/game";
import { CONTINUE_SECONDS, setContinueDeadline } from "@/lib/useMajorityAdvance";
import { sendDirectMessage } from "@/lib/dm";
import { displayedName } from "@/lib/swaps";
import { cleanForSend } from "@/lib/profanity";
import { getAccountLevels } from "@/lib/economy";
import { LevelStar } from "./LevelStar";
import { useBlockedIds } from "@/lib/blocks";
import { useReportedIds , isSilenced } from "@/lib/reports";
import { BlockedStrip } from "./BlockedStrip";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import { InkName } from "./InkName";
import {
  CastleMap,
  COURTYARD_VIEW,
  type MapArrange,
  type TokenDecor,
} from "./castle/CastleMap";
import { COURTYARD_PLAN, YARD, huddle, type Talk } from "@/lib/courtyard";
import { SentencePicker } from "./SentencePicker";
import {
  renderSentence,
  sendSentence,
  type SentenceKey,
  type SentencePayload,
} from "@/lib/sentences";
import { inkNumbers } from "@/lib/ink";
import { ROLES, getRole } from "@/lib/roles";
import type { Room, Player, DirectMessage } from "@/lib/types";
import { fireHostAdvance } from "@/lib/hostAdvance";
import { pacers } from "@/lib/bots";

// Dark wooden-sign fill for StatePanel on this light courtyard stage.
const SIGN_BG = "rgba(47,33,18,.92)";

const MAX_MESSAGE_LENGTH = 200;

export function Outreach({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const advancedRef = useRef(false);
  // Scroll container for the open thread — kept pinned to the latest message.
  const threadScrollRef = useRef<HTMLUListElement>(null);
  const [activePartnerId, setActivePartnerId] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // The premade-sentence picker (migration 129); always open with a bot.
  const [showSentences, setShowSentences] = useState(false);

  // (In-game name bars use this game's colours — lib/gameColors — not the
  // customisable banner.)
  // Account level per account-linked player, by user_id (for the level star).
  const [levelsByUser, setLevelsByUser] = useState<Record<string, number>>({});
  const accountIdsKey = players.map((p) => p.user_id ?? "").join(",");
  useEffect(() => {
    const ids = players
      .map((p) => p.user_id)
      .filter((x): x is string => !!x);
    if (ids.length === 0) {
      setLevelsByUser({});
      return;
    }
    let active = true;
    getAccountLevels(ids).then((m) => {
      if (active) setLevelsByUser(Object.fromEntries(m));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIdsKey]);

  // Cross-chat notification: when you're in a thread with person X and
  // a DM arrives from a different person Y, show a banner so you don't
  // miss it. Tap the banner to switch to that thread.
  // Communication potion (migration 111): lifts the one-partner-per-cycle
  // lock for this outreach and makes the buyer immune to the report auto-mute.
  const [commsArmed, setCommsArmed] = useState(false);
  useEffect(() => {
    if (!myPlayer?.id) return;
    let cancelled = false;
    supabase
      .rpc("my_potions", { p_player_id: myPlayer.id })
      .then(({ data }) => {
        if (!cancelled && data) {
          setCommsArmed(!!(data as { comms?: boolean }).comms);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id]);

  // Migration 143: Pride's broadcast (today's Outreach as a read-only global
  // chat) and the server's view of my limits. Polled — it's one small read.
  const [ostate, setOstate] = useState<OutreachState | null>(null);
  const [ostateTick, setOstateTick] = useState(0);
  useEffect(() => {
    if (!myPlayer?.id) return;
    let cancelled = false;
    const load = () =>
      supabase
        .rpc("outreach_state", { p_room_id: room.id, p_viewer_id: myPlayer.id })
        .then(({ data }) => {
          if (!cancelled && data) setOstate(data as OutreachState);
        });
    load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [room.id, room.day, myPlayer?.id, ostateTick]);

  const [notification, setNotification] = useState<{
    senderId: string;
    senderName: string;
    text: string;
  } | null>(null);
  // Tracks the id of the most recently processed message so the
  // notification doesn't fire for the entire initial load (only for
  // genuinely new arrivals).
  const lastNotifiedIdRef = useRef<string | null>(null);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const isHost = myPlayer?.is_host ?? false;
  const { blocked, block } = useBlockedIds(room.id);
  const { isReported, report } = useReportedIds(room.id);
  // Eligible for outreach = not dead. Imprisoned AND hospitalised can both chat
  // (the day's one chance to act for them).
  const eligible = players.filter((p) => !p.dead);
  // Who sets the pace: the humans (bots act instantly — lib/bots.ts).
  const pace = pacers(eligible);

  // Torment (reworked 2026-09-28): the day's Torment target sees ink blots
  // instead of names everywhere on this screen — partner list, thread header,
  // new-message banner, "speaking with" note — plus no banner colours, level
  // stars or prison bars that would give a player away. Each blot has a number
  // (a per-viewer, per-day shuffle — see lib/ink.ts) so threads stay tellable
  // apart. Display-only: who you message is still the real player.
  const tormented = !!myPlayer?.is_tormented;
  const inkNo =
    tormented && myPlayer
      ? inkNumbers(
          players.filter((p) => p.id !== myPlayer.id).map((p) => p.id),
          `${room.id}:${room.day}:${myPlayer.id}`
        )
      : null;
  // Plain-text label for places that can't hold the blot graphic.
  const inkText = (id: string) => `an ink-blotted stranger (#${inkNo?.get(id) ?? "?"})`;

  // How a message reads. A premade sentence (migration 129) renders from its
  // payload with MY display names, so an Envy swap stays consistent; free text
  // shows as typed. (The server's text copy is only the fallback.)
  function messageText(m: DirectMessage): string {
    if (m.payload) {
      const text = renderSentence(
        m.payload as SentencePayload,
        (id) => {
          const p = players.find((x) => x.id === id);
          return p ? displayedName(p, room, players, myPlayer?.id) : "someone";
        },
        myPlayer?.id
      );
      if (text) return text;
    }
    return m.text;
  }

  // Last message id seen per partner — drives the gold "unread" dot on the
  // partner list. Opening a thread marks its latest message as seen; purely
  // client-side, resets each day with the component.
  const [seenLatest, setSeenLatest] = useState<Record<string, string>>({});
  const myId = myPlayer?.id ?? null;
  useEffect(() => {
    if (!activePartnerId || !myId) return;
    const latest = [...allMessages]
      .reverse()
      .find(
        (m) =>
          (m.sender_id === activePartnerId && m.recipient_id === myId) ||
          (m.sender_id === myId && m.recipient_id === activePartnerId)
      );
    if (!latest) return;
    setSeenLatest((s) =>
      s[activePartnerId] === latest.id ? s : { ...s, [activePartnerId]: latest.id }
    );
  }, [activePartnerId, allMessages, myId]);

  // Ticking clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : OUTREACH_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  // Reset-seen guard (same pattern as minigame / role-action).
  useEffect(() => {
    if (pace.length > 0 && pace.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime DM subscription: load existing and watch for new inserts.
  // Filtered to the current day so each outreach phase starts fresh
  // (previous days' DMs stay in the table but are hidden).
  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      const { data } = await supabase
        .from("dm_messages")
        .select("*")
        .eq("room_id", room.id)
        .eq("day", room.day)
        .order("created_at", { ascending: true });
      if (!cancelled) setAllMessages((data ?? []) as DirectMessage[]);
    }
    loadInitial();

    const channel = supabase
      .channel(`dm-${room.id}-${room.day}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const msg = payload.new as DirectMessage;
          // Ignore inserts from other days (defensive — shouldn't
          // happen in normal flow but keeps realtime self-consistent
          // with the filtered initial load).
          if (msg.day !== room.day) return;
          setAllMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [room.id, room.day]);

  // Auto-scroll the open thread to the bottom whenever a new message arrives
  // or you switch threads, so the latest line is always in view.
  useEffect(() => {
    const el = threadScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [allMessages, activePartnerId]);

  // Cross-chat notification: when a new DM arrives addressed to me
  // from someone other than my current active partner, surface it.
  // Only fires for genuinely new messages (the initial load is skipped
  // because lastNotifiedIdRef starts null and the first run just marks
  // the newest existing message as seen).
  useEffect(() => {
    if (allMessages.length === 0) return;
    const latest = allMessages[allMessages.length - 1];

    // On the very first effect run, just mark the newest message as
    // already seen and don't notify for any existing messages.
    if (lastNotifiedIdRef.current === null) {
      lastNotifiedIdRef.current = latest.id;
      return;
    }
    if (lastNotifiedIdRef.current === latest.id) return;
    lastNotifiedIdRef.current = latest.id;

    if (!myPlayer) return;
    if (latest.recipient_id !== myPlayer.id) return; // not for me
    if (latest.sender_id === myPlayer.id) return; // my own echo
    if (!activePartnerId) return; // notification only matters while in a thread
    if (latest.sender_id === activePartnerId) return; // current partner
    if (blocked.has(latest.sender_id)) return; // blocked — no notification

    const sender = players.find((p) => p.id === latest.sender_id);
    if (!sender) return;
    setNotification({
      senderId: sender.id,
      senderName: inkNo ? inkText(sender.id) : displayedName(sender, room, players, myPlayer?.id),
      text: messageText(latest),
    });

    // Auto-dismiss after 5 seconds (cleared early when superseded).
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }
    notificationTimerRef.current = setTimeout(() => {
      setNotification(null);
    }, 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages, activePartnerId]);

  // Auto-mark ready when the timer runs out.
  useEffect(() => {
    if (
      expired &&
      myPlayer &&
      !myPlayer.dead &&
      !myPlayer.in_hospital &&
      !myPlayer.ready
    ) {
      setReady(myPlayer.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // Majority pressed Done → shorten the timer to a visible 10s countdown so
  // everyone sees the phase is about to end. (Won't extend a timer already
  // under 10s.) Stragglers are auto-readied at expiry by the effect above.
  const readyCount = pace.filter((p) => p.ready).length;
  const majority =
    resetSeen && pace.length > 0 && readyCount * 2 > pace.length;
  useEffect(() => {
    if (!isHost || !majority) return;
    if (endsAt !== null && endsAt - Date.now() <= (CONTINUE_SECONDS + 0.5) * 1000) {
      return;
    }
    void setContinueDeadline(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, majority, endsAt, room.id]);

  // Everyone done → advance immediately (don't wait out the countdown). Else the
  // host advances to consultation when the (possibly shortened) timer elapses,
  // plus a short grace so stragglers' auto-ready writes land first.
  const allReady =
    resetSeen && pace.length > 0 && pace.every((p) => p.ready);
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const timerExpired = endsAt !== null && now >= endsAt + 1500;
    if (allReady || timerExpired) {
      fireHostAdvance({
        ref: advancedRef,
        roomId: room.id,
        phase: room.phase,
        day: room.day,
        run: () => endOutreach(room.id),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, now, endsAt, room.id, allReady]);

  async function done() {
    if (!myPlayer || myPlayer.ready) return;
    await setReady(myPlayer.id, true);
  }

  // Dead: passive screen. Living players' outreach is off-limits, but
  // the dead can talk to each other in the dead-only chat below.
  if (myPlayer?.dead) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-6 py-12 text-outreach-outline">
        <StatePanel accentRgb="153,27,27" bg={SIGN_BG}>
          <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
            Day {room.day}
          </p>
          <p className={`mt-2 text-3xl font-bold text-red-200 ${heading}`}>
            You&rsquo;re dead
          </p>
          <p className="mt-2 text-cream/70">
            You can&rsquo;t join the living&rsquo;s outreach.
          </p>
        </StatePanel>
        <div className="mt-6 w-full max-w-sm">
          <DeadChat room={room} players={players} myPlayer={myPlayer} />
        </div>
      </main>
      </MotionConfig>
    );
  }

  // Hospitalised players CAN chat in outreach (they're eligible above), so no
  // passive screen here — they get the normal partner list + composer.

  // Note: there's NO post-Done waiting screen anymore. Once you press
  // Done you stay on the partner list / thread view so you can still
  // see (and send) messages until the host advances or the timer
  // expires. The Done button below reflects the ready state.

  // Active player: either partner list or a single thread. Blocked players
  // are hidden from your partner list (you won't see or receive their DMs).
  const partners = eligible
    .filter((p) => p.id !== myPlayer?.id && !blocked.has(p.id))
    // Tormented: list in blot-number order, not the (known) join order.
    .sort((a, b) => (inkNo ? (inkNo.get(a.id) ?? 0) - (inkNo.get(b.id) ?? 0) : 0));
  const activePartner = activePartnerId
    ? players.find((p) => p.id === activePartnerId) ?? null
    : null;

  const threadMessages = activePartner
    ? allMessages.filter(
        (m) =>
          (m.sender_id === myPlayer?.id &&
            m.recipient_id === activePartner.id) ||
          (m.sender_id === activePartner.id &&
            m.recipient_id === myPlayer?.id)
      )
    : [];

  // OUTREACH LIMITS (migration 143; the server enforces the same). You may
  // START one chat per cycle — write first to one player — but can always
  // answer anyone who wrote to you. 250 characters per cycle in total, at most
  // 100 to any one player. Sociability and the Communication potion may start
  // chats with everyone. (myId is declared above.)
  const wroteToMe = (id: string) =>
    allMessages.some((m) => m.sender_id === id && m.recipient_id === myId);
  // The chat I started: my first message to someone who hadn't written yet.
  const startedWithId =
    (myId &&
      allMessages.find(
        (m) =>
          m.sender_id === myId &&
          !allMessages.some(
            (x) =>
              x.sender_id === m.recipient_id &&
              x.recipient_id === myId &&
              Date.parse(x.created_at) < Date.parse(m.created_at)
          )
      )?.recipient_id) ||
    null;
  const freeStart = commsArmed || !!ostate?.limits.free_start;
  const TOTAL_CHARS = ostate?.limits.total ?? 250;
  const PER_PERSON_CHARS = ostate?.limits.per_person ?? 100;
  const mine = allMessages.filter((m) => m.sender_id === myId);
  const usedTotal = mine.reduce((n, m) => n + m.text.length, 0);
  const usedTo = (id: string) =>
    mine.filter((m) => m.recipient_id === id).reduce((n, m) => n + m.text.length, 0);
  const lockedPartnerId = freeStart ? null : startedWithId;
  const lockedPartnerName = lockedPartnerId
    ? inkNo
      ? inkText(lockedPartnerId)
      : players.find((p) => p.id === lockedPartnerId)?.name ?? "someone"
    : null;
  const mayWriteTo = (id: string) =>
    lockedPartnerId === null || lockedPartnerId === id || wroteToMe(id);
  // Pride's broadcast day: nobody writes privately.
  const broadcast = ostate?.broadcast ?? null;
  // A mute is absolute — the Communication potion does NOT lift it. Buying
  // your way out of a report mute would be a moderation hole; the potion's
  // immunity is applied server-side when Sociability casts, so a buyer simply
  // never gets the ability mute in the first place.
  const muted = isSilenced(myPlayer, room.day);
  const charsLeft = activePartner
    ? Math.max(0, Math.min(TOTAL_CHARS - usedTotal, PER_PERSON_CHARS - usedTo(activePartner.id)))
    : 0;
  const canSendToActive =
    !!activePartner && !muted && !broadcast && mayWriteTo(activePartner.id) && charsLeft > 0;
  const cantSendReason = muted
    ? "You've been muted for this game."
    : broadcast
      ? "Nobody talks privately today."
      : activePartner && !mayWriteTo(activePartner.id)
        ? `You already started a chat with ${lockedPartnerName} this cycle — you can only answer people who write to you.`
        : TOTAL_CHARS - usedTotal <= 0
          ? `You've used all ${TOTAL_CHARS} characters for this cycle.`
          : `You've used your ${PER_PERSON_CHARS} characters for this player.`;
  // ----- The courtyard map -----
  // Who's talking to whom (outreach_state.talks, migration 146 — pairs and who
  // wrote first, never the text), plus my own chats straight from my messages
  // so I move the moment I write instead of at the next poll.
  const talks: Talk[] = [...(ostate?.talks ?? [])];
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const known = new Set(talks.map((t) => pairKey(t.a, t.b)));
  for (const m of allMessages) {
    const k = pairKey(m.sender_id, m.recipient_id);
    if (known.has(k)) continue;
    known.add(k);
    talks.push({ a: m.sender_id, b: m.recipient_id, at: m.created_at });
  }
  // Everyone sees the same courtyard today, so people can point at it ("the
  // two by the well"); the tormented get their own, so positions don't name
  // anyone.
  const courtyardSeed = inkNo
    ? `${room.id}:${room.day}:${myId ?? ""}:ink`
    : `${room.id}:${room.day}:courtyard`;
  const arrange: MapArrange = (placed, m, nameOf) =>
    huddle(placed, talks, {
      // Prisoners and the hospitalised can't walk: others come to them.
      // (Not for the tormented — staying put would mark someone out.)
      fixed: (id) =>
        !inkNo && !!players.find((p) => p.id === id && (p.in_prison || p.in_hospital)),
      nameOf,
      m,
      plan: COURTYARD_PLAN,
      seed: courtyardSeed,
      area: YARD,
    });
  const lastWith = (id: string) => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i];
      if (
        (m.sender_id === myId && m.recipient_id === id) ||
        (m.sender_id === id && m.recipient_id === myId)
      )
        return m;
    }
    return undefined;
  };
  // For screen readers: who each person is talking with (the map's links).
  const labelFor = (id: string) => {
    if (id === myId) return "you";
    if (inkNo) return `ink-blotted player ${inkNo.get(id) ?? "?"}`;
    const q = players.find((x) => x.id === id);
    return q ? displayedName(q, room, players, myId) : "someone";
  };
  const talkingWith = (id: string) =>
    talks.filter((t) => t.a === id || t.b === id).map((t) => labelFor(t.a === id ? t.b : t.a));
  const decorate = (p: Player): TokenDecor => {
    const last = lastWith(p.id);
    const unread =
      !!last && last.sender_id === p.id && seenLatest[p.id] !== last.id && p.id !== activePartnerId;
    const partners = talkingWith(p.id);
    return {
      active: p.id === activePartnerId,
      // New message from them → white "!" in a red circle.
      badge: unread ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold leading-none text-white ring-2 ring-cream shadow-[0_1px_4px_rgba(0,0,0,.45)]">
          !
        </span>
      ) : undefined,
      // Account level (hidden from the tormented — it would identify people).
      corner:
        !inkNo && p.user_id && levelsByUser[p.user_id] != null ? (
          <LevelStar level={levelsByUser[p.user_id]} size={20} />
        ) : undefined,
      note:
        [
          unread ? "new message" : "",
          partners.length
            ? `talking with ${new Intl.ListFormat("en", { type: "conjunction" }).format(partners)}`
            : "",
        ]
          .filter(Boolean)
          .join(", ") || undefined,
    };
  };

  async function send() {
    const text = draft.trim();
    if (!text || !activePartner || !myPlayer || sending || !canSendToActive)
      return;
    setSending(true);
    setSendError(null);
    try {
      await sendDirectMessage(
        room.id,
        myPlayer.id,
        activePartner.id,
        text,
        room.day
      );
      setDraft("");
    } catch (e) {
      setSendError(
        e instanceof Error ? e.message : "Couldn't send that message."
      );
    } finally {
      setSending(false);
    }
  }

  // ----- Premade sentences (migration 129) -----
  // Who a sentence can be about: every living player but me.
  const aboutOptions = players
    .filter((p) => !p.dead && p.id !== myPlayer?.id)
    .map((p) => ({ id: p.id, label: displayedName(p, room, players, myPlayer?.id) }));

  // Which roles "I'm the …" can name (132): this game's cast, else every role.
  const roleOptions = (room.role_pool ?? Object.keys(ROLES))
    .flatMap((id) => {
      const r = getRole(id);
      return r ? [{ id, label: r.name }] : [];
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  async function sendPremade(key: SentenceKey, aboutId?: string, roleId?: string) {
    if (!activePartner || !myPlayer || sending || !canSendToActive) return;
    setSending(true);
    setSendError(null);
    try {
      await sendSentence(myPlayer.id, activePartner.id, key, aboutId, roleId);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Couldn't send that.");
    } finally {
      setSending(false);
    }
  }

  // ----- ACTIVE PLAYER: partner list + thread -----
  // Desktop shows the list and the open thread side-by-side (messaging-app
  // style); mobile swaps between them (tap a partner to open, Back to return).
  return (
    <MotionConfig reducedMotion="user">
    <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-4 pb-8 pt-16 text-outreach-outline">
      <motion.div
        className="w-full max-w-5xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        {/* Shared header: day + timer. */}
        <motion.div variants={fadeUp} className="text-center">
          <p className={`text-xs uppercase tracking-[0.3em] text-outreach-outline/80 ${heading}`}>
            Day {room.day} &mdash; outreach
          </p>
          <PhaseTimer seconds={remainingSec} onLight className="mt-1" />
        </motion.div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          {/* LEFT: the courtyard (+ Done). Hidden on mobile while a thread
              is open. */}
          <motion.section
            variants={fadeUp}
            className={activePartner ? "hidden lg:block" : "block"}
          >
            <PhaseTip
              id="outreach"
              text="Tap someone in the courtyard to talk. Chats are one-on-one: you can start a chat with ONE player each cycle, but you can always answer anyone who writes to you. Everyone can see who's talking: the two people in each chat stand together, joined by a line."
            />

            <p className="mb-3 rounded-lg border border-outreach-outline/30 bg-outreach-fg/20 px-3 py-2 text-center text-xs font-medium text-outreach-outline lg:text-left">
              {broadcast
                ? "Pride has taken over today's Outreach — nobody talks privately."
                : freeStart
                  ? "You can start a chat with anyone this cycle."
                  : lockedPartnerName
                    ? `You started a chat with ${lockedPartnerName} this cycle. You can still answer anyone who writes to you.`
                    : "You may start a chat with one player this cycle, and answer anyone who writes to you."}
              {!broadcast && (
                <span className="mt-0.5 block font-normal opacity-80">
                  {Math.max(0, TOTAL_CHARS - usedTotal)} of {TOTAL_CHARS} characters left
                  &middot; at most {PER_PERSON_CHARS} per player
                </span>
              )}
              {!broadcast && (
                <span className="mt-0.5 block font-normal opacity-80">
                  Everyone can see who&rsquo;s talking: the two people in each chat stand together, joined by a line. What you say stays private.
                </span>
              )}
            </p>

            {inkNo && (
              <p className="mb-3 rounded-lg border border-[#150f1c]/40 bg-[#150f1c]/85 px-3 py-2 text-center text-xs font-medium text-cream lg:text-left">
                Torment&rsquo;s ink clouds your eyes &mdash; today you can&rsquo;t
                see who anyone is. Each blot keeps its number, so you can still
                tell your conversations apart.
              </p>
            )}

            {/* Hidden while tormented: it lists blocked players by name. */}
            {!inkNo && (
              <BlockedStrip
                room={room}
                players={players}
                myPlayerId={myPlayer?.id}
                className="mb-3 justify-center lg:justify-start"
              />
            )}

            <CastleMap
              view={COURTYARD_VIEW}
              room={room}
              players={players}
              myPlayerId={myPlayer?.id ?? null}
              accent="#e3b510"
              seed={courtyardSeed}
              ink={inkNo}
              // Blocked players stay in the courtyard but can't be opened.
              canPick={(p) => !broadcast && !!myPlayer && p.id !== myPlayer.id && !blocked.has(p.id)}
              dimUnpickable={!broadcast}
              onPick={(p) => setActivePartnerId(p.id)}
              arrange={arrange}
              decorate={decorate}
              label="The courtyard: tap someone to talk"
            />
            {!broadcast && partners.length === 0 && (
              <p className="mt-2 text-center text-sm text-outreach-outline/60 italic">
                No one else is in the courtyard.
              </p>
            )}

            {myPlayer?.ready ? (
              <div className="glow-gold-pulse mt-4 w-full rounded-xl border-2 border-outreach-outline/60 bg-outreach-outline/15 py-3 text-center font-semibold text-outreach-outline">
                Done &mdash; waiting for the others
                <p className="mt-1 text-xs font-normal text-outreach-outline/70">
                  You can keep chatting until the phase ends.
                </p>
              </div>
            ) : (
              <motion.button
                onClick={done}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className={`mt-4 w-full rounded-xl bg-outreach-outline py-3 font-semibold text-cream shadow-[0_0_14px_rgba(115,83,51,.4)] transition-shadow hover:shadow-[0_0_22px_rgba(115,83,51,.6)] ${heading}`}
              >
                Done
              </motion.button>
            )}
          </motion.section>

          {/* RIGHT: open thread, or a desktop placeholder. Hidden on mobile
              until a thread is open. */}
          <motion.section
            variants={fadeUp}
            className={activePartner || broadcast ? "block" : "hidden lg:block"}
          >
            {broadcast ? (
              <BroadcastPanel
                broadcast={broadcast}
                myPlayerId={myPlayer?.id ?? null}
                total={TOTAL_CHARS}
                onSent={() => setOstateTick((n) => n + 1)}
              />
            ) : activePartner ? (
              <div className="flex flex-col overflow-hidden rounded-xl border-2 border-outreach-outline/40 bg-cream/70 shadow-[0_6px_18px_rgba(0,0,0,.18)]">
                {/* Cross-chat notification: a DM from someone else. */}
                {notification && (
                  <motion.button
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    onClick={() => {
                      setActivePartnerId(notification.senderId);
                      setNotification(null);
                      if (notificationTimerRef.current) {
                        clearTimeout(notificationTimerRef.current);
                      }
                    }}
                    className="flex flex-col items-start gap-0.5 border-b-2 border-gold bg-cream px-3 py-2 text-left shadow-[0_2px_10px_rgba(227,181,16,.35)]"
                  >
                    <span className={`text-[10px] font-semibold uppercase tracking-widest text-gold ${heading}`}>
                      New message from {notification.senderName}
                    </span>
                    <span className="line-clamp-2 text-sm text-outreach-outline">
                      {notification.text}
                    </span>
                  </motion.button>
                )}

                {/* Thread header. */}
                <header className="flex items-center justify-between gap-2 border-b border-outreach-outline/20 bg-outreach-fg/30 px-3 py-2">
                  <button
                    onClick={() => setActivePartnerId(null)}
                    aria-label="Back to the courtyard"
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-outreach-outline/40 bg-cream px-3 py-1.5 text-sm font-semibold text-outreach-outline transition-opacity hover:opacity-80 lg:hidden"
                  >
                    <span aria-hidden className="text-base leading-none">
                      &larr;
                    </span>
                    <span>Back</span>
                  </button>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {inkNo ? (
                      <InkName n={inkNo.get(activePartner.id) ?? 0} />
                    ) : (
                      displayedName(activePartner, room, players, myPlayer?.id)
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {myPlayer &&
                      (isReported(activePartner.id) ? (
                        <span className="rounded border border-outreach-outline/20 px-2 py-1 text-xs font-semibold text-outreach-outline/50">
                          Reported
                        </span>
                      ) : (
                        <button
                          onClick={() => report(myPlayer.id, activePartner.id)}
                          title="Report this player"
                          className="rounded border border-outreach-outline/40 bg-cream px-2 py-1 text-xs font-semibold text-outreach-outline transition-opacity hover:opacity-80"
                        >
                          Report
                        </button>
                      ))}
                    <button
                      onClick={() => {
                        block(activePartner.id);
                        setActivePartnerId(null);
                      }}
                      title="Block this player"
                      className="rounded border border-outreach-outline/40 bg-cream px-2 py-1 text-xs font-semibold text-outreach-outline transition-opacity hover:opacity-80"
                    >
                      Block
                    </button>
                  </span>
                </header>

                {/* Thread messages. */}
                <ul
                  ref={threadScrollRef}
                  className="flex h-[55vh] flex-col gap-2 overflow-y-auto px-4 py-4 lg:h-[26rem]"
                >
                  {threadMessages.length === 0 && (
                    <li className="text-center text-sm text-outreach-outline/60 italic">
                      No messages yet. Say hi.
                    </li>
                  )}
                  {threadMessages.map((m) => {
                    const mine = m.sender_id === myPlayer?.id;
                    return (
                      <motion.li
                        key={m.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className={
                          "max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words shadow-[0_2px_6px_rgba(0,0,0,.15)] " +
                          (mine
                            ? "self-end rounded-br-sm bg-outreach-outline text-cream"
                            : "self-start rounded-bl-sm border border-outreach-outline/25 bg-cream text-outreach-outline")
                        }
                      >
                        {messageText(m)}
                      </motion.li>
                    );
                  })}
                </ul>

                {/* Input: free text and/or premade sentences (migration 129).
                    A bot only understands sentences, so with a bot the picker
                    is the whole composer. */}
                <div className="border-t border-outreach-outline/20 bg-outreach-fg/30 p-3">
                  {(activePartner.is_bot || showSentences) && (
                    <div className="mb-2">
                      {activePartner.is_bot && (
                        <p className="mb-1.5 text-xs text-outreach-outline/70">
                          Bots only understand premade sentences.
                        </p>
                      )}
                      <SentencePicker
                        players={aboutOptions}
                        roles={roleOptions}
                        disabled={!canSendToActive || sending}
                        onSend={sendPremade}
                      />
                    </div>
                  )}
                  {activePartner.is_bot && !canSendToActive && (
                    <p className="text-xs text-outreach-outline/70">{cantSendReason}</p>
                  )}
                  {!activePartner.is_bot && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowSentences((v) => !v)}
                      title="Premade sentences"
                      className={
                        "shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-90 " +
                        (showSentences
                          ? "border-outreach-outline bg-outreach-outline text-cream"
                          : "border-outreach-outline/40 bg-cream text-outreach-outline")
                      }
                    >
                      Sentences
                    </button>
                    <input
                      value={draft}
                      onChange={(e) =>
                        setDraft(e.target.value.slice(0, Math.min(MAX_MESSAGE_LENGTH, charsLeft)))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") send();
                      }}
                      disabled={!canSendToActive}
                      placeholder={!canSendToActive ? cantSendReason : "Type a message…"}
                      className="flex-1 rounded-lg border border-outreach-outline/40 bg-cream px-3 py-2 text-outreach-outline placeholder:text-outreach-outline/40 focus:outline-none focus:ring-2 focus:ring-outreach-outline disabled:opacity-60"
                    />
                    <button
                      onClick={send}
                      disabled={!draft.trim() || sending || !canSendToActive}
                      className="rounded-lg bg-outreach-outline px-4 py-2 font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                  )}
                  {canSendToActive && (
                    <p className="mt-1 text-[11px] text-outreach-outline/60">
                      {Math.max(0, charsLeft - draft.length)} characters left for this player
                    </p>
                  )}
                  {sendError && (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      {sendError}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="hidden h-[26rem] items-center justify-center rounded-xl border-2 border-dashed border-outreach-outline/30 bg-outreach-fg/10 px-6 text-center text-sm text-outreach-outline/60 lg:flex">
                Tap someone in the courtyard to talk to them.
              </div>
            )}
          </motion.section>
        </div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}

// outreach_state (migration 143): Pride's broadcast and my limits.
type OutreachState = {
  broadcast: {
    // Never who (migration 144): only Pride is told it's him.
    mine: boolean;
    messages: { id: string; text: string; at: string }[];
    used: number;
  } | null;
  limits: { total: number; per_person: number; free_start: boolean };
  // Migration 146: who's talking to whom today (absent before it's applied).
  talks?: Talk[];
};

// Pride's broadcast day: today's Outreach is one global chat that everyone
// reads and only Pride writes in (250 characters). Shown as "Pride", never
// by name — only Pride himself knows it's him.
function BroadcastPanel({
  broadcast,
  myPlayerId,
  total,
  onSent,
}: {
  broadcast: NonNullable<OutreachState["broadcast"]>;
  myPlayerId: string | null;
  total: number;
  onSent: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = myPlayerId !== null && broadcast.mine;
  const left = Math.max(0, total - broadcast.used);

  async function send() {
    const text = cleanForSend(draft.trim());
    if (!text || busy || !myPlayerId) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("pride_broadcast_send", {
        p_player_id: myPlayerId,
        p_text: text,
      });
      const res = data as { ok: boolean; reason?: string } | null;
      if (rpcError || !res?.ok) {
        setError(
          res?.reason === "char_limit"
            ? `That's more than your ${total} characters for today.`
            : "Couldn't send that."
        );
      } else {
        setDraft("");
        onSent();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border-2 border-outreach-outline/40 bg-cream/70 shadow-[0_6px_18px_rgba(0,0,0,.18)]">
      <div className="border-b border-outreach-outline/20 bg-outreach-fg/30 px-4 py-3">
        <p className="font-semibold text-outreach-outline">
          {mine ? "You have" : "Pride has"} taken over today&rsquo;s Outreach
        </p>
        <p className="text-xs text-outreach-outline/70">
          Everyone reads this chat; only {mine ? "you" : "Pride"} can write. Nobody talks
          privately today.{mine ? " Nobody else is told it's you." : ""}
        </p>
      </div>
      <ul className="flex h-80 flex-col gap-2 overflow-y-auto p-3">
        {broadcast.messages.map((m) => (
          <li
            key={m.id}
            className="max-w-[85%] self-start rounded-lg bg-outreach-outline px-3 py-2 text-sm text-cream"
          >
            <span className="mr-1 font-semibold text-gold">Pride:</span>
            {m.text}
          </li>
        ))}
        {broadcast.messages.length === 0 && (
          <li className="m-auto text-sm italic text-outreach-outline/60">Nothing yet.</li>
        )}
      </ul>
      {mine && (
        <div className="border-t border-outreach-outline/20 bg-outreach-fg/30 p-3">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, left))}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
              disabled={left === 0}
              placeholder={left === 0 ? "You've used all your characters." : "Speak to everyone…"}
              className="flex-1 rounded-lg border border-outreach-outline/40 bg-cream px-3 py-2 text-outreach-outline placeholder:text-outreach-outline/40 focus:outline-none focus:ring-2 focus:ring-outreach-outline disabled:opacity-60"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || busy || left === 0}
              className="rounded-lg bg-outreach-outline px-4 py-2 font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <p className="mt-1 text-[11px] text-outreach-outline/60">
            {Math.max(0, left - draft.length)} of {total} characters left
          </p>
          {error && <p className="mt-1 text-xs font-medium text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
