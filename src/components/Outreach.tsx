"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setReady, endOutreach, OUTREACH_SECONDS } from "@/lib/game";
import { sendDirectMessage } from "@/lib/dm";
import { displayedName } from "@/lib/swaps";
import { useBlockedIds } from "@/lib/blocks";
import { useReportedIds } from "@/lib/reports";
import { Centered } from "./Centered";
import { BlockedStrip } from "./BlockedStrip";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import type { Room, Player, DirectMessage } from "@/lib/types";

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
  const [activePartnerId, setActivePartnerId] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Cross-chat notification: when you're in a thread with person X and
  // a DM arrives from a different person Y, show a banner so you don't
  // miss it. Tap the banner to switch to that thread.
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
  // Eligible for outreach = alive AND not in hospital. Imprisoned can chat.
  const eligible = players.filter((p) => !p.dead && !p.in_hospital);

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
    if (eligible.length > 0 && eligible.every((p) => !p.ready)) {
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
      senderName: displayedName(sender, room, players, myPlayer?.id),
      text: latest.text,
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

  // Host advances to consultation when everyone eligible is done, or shortly
  // after the timer expires as a fallback.
  const allReady = eligible.length > 0 && eligible.every((p) => p.ready);
  const graceOver = endsAt !== null && now > endsAt + 5000;
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const everyoneDone = resetSeen && allReady;
    if (everyoneDone || graceOver) {
      advancedRef.current = true;
      endOutreach(room.id);
    }
  }, [isHost, resetSeen, allReady, graceOver, room.id]);

  async function done() {
    if (!myPlayer || myPlayer.ready) return;
    await setReady(myPlayer.id, true);
  }

  // Dead: passive screen. Living players' outreach is off-limits, but
  // the dead can talk to each other in the dead-only chat below.
  if (myPlayer?.dead) {
    return (
      <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-6 py-12 text-outreach-outline">
        <div className="w-full max-w-sm text-center">
          <p className="text-xs uppercase tracking-widest text-outreach-outline/70">
            Day {room.day}
          </p>
          <p className="mt-2 text-2xl font-semibold">You&rsquo;re dead</p>
          <p className="mt-2 text-outreach-outline/70">
            You can&rsquo;t join the living&rsquo;s outreach.
          </p>
        </div>
        <div className="mt-6 w-full max-w-sm">
          <DeadChat room={room} players={players} myPlayer={myPlayer} />
        </div>
      </main>
    );
  }

  // Hospital: passive screen.
  if (myPlayer?.in_hospital) {
    return (
      <Centered className="outreach-castle-bg text-outreach-outline">
        <p className="text-xs uppercase tracking-widest text-outreach-outline/70">
          Day {room.day}
        </p>
        <p className="mt-2 text-2xl font-semibold">You&rsquo;re in hospital</p>
        <p className="mt-2 text-outreach-outline/70">
          You cannot chat this round.
        </p>
      </Centered>
    );
  }

  // Note: there's NO post-Done waiting screen anymore. Once you press
  // Done you stay on the partner list / thread view so you can still
  // see (and send) messages until the host advances or the timer
  // expires. The Done button below reflects the ready state.

  // Active player: either partner list or a single thread. Blocked players
  // are hidden from your partner list (you won't see or receive their DMs).
  const partners = eligible.filter(
    (p) => p.id !== myPlayer?.id && !blocked.has(p.id)
  );
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

  async function send() {
    const text = draft.trim();
    if (!text || !activePartner || !myPlayer || sending || myPlayer.muted)
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

  // ----- ACTIVE PLAYER: partner list + thread -----
  // Desktop shows the list and the open thread side-by-side (messaging-app
  // style); mobile swaps between them (tap a partner to open, Back to return).
  return (
    <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-4 pb-8 pt-16 text-outreach-outline">
      <div className="w-full max-w-5xl">
        {/* Shared header: day + timer. */}
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-outreach-outline/70">
            Day {room.day} &mdash; outreach
          </p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {remainingSec}
            <span className="text-xl text-outreach-outline/60">s</span>
          </p>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[20rem_1fr] lg:items-start">
          {/* LEFT: partner list (+ Done). Hidden on mobile while a thread
              is open. */}
          <section className={activePartner ? "hidden lg:block" : "block"}>
            <PhaseTip
              id="outreach"
              text="Tap anyone to chat privately — gather information, make deals, or spread convincing lies. Imprisoned players can chat too."
            />

            <BlockedStrip
              room={room}
              players={players}
              myPlayerId={myPlayer?.id}
              className="mb-3 justify-center lg:justify-start"
            />

            <ul className="flex flex-col gap-2">
              {partners.map((p) => {
                const thread = allMessages.filter(
                  (m) =>
                    (m.sender_id === myPlayer?.id && m.recipient_id === p.id) ||
                    (m.sender_id === p.id && m.recipient_id === myPlayer?.id)
                );
                const last = thread[thread.length - 1];
                const isActive = p.id === activePartnerId;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => setActivePartnerId(p.id)}
                      className={
                        "flex w-full items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left transition-opacity hover:opacity-90 " +
                        (isActive
                          ? "border-outreach-outline bg-outreach-outline/15 text-outreach-outline"
                          : "border-outreach-outline/30 bg-cream text-outreach-outline")
                      }
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {displayedName(p, room, players, myPlayer?.id)}
                          {p.in_prison && (
                            <span className="ml-2 text-xs text-outreach-outline/50">
                              (in prison)
                            </span>
                          )}
                        </span>
                        {last && (
                          <span className="block truncate text-xs text-outreach-outline/60">
                            {last.sender_id === myPlayer?.id ? "you: " : ""}
                            {last.text}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {partners.length === 0 && (
                <li className="text-center text-sm text-outreach-outline/60 italic">
                  No one else available.
                </li>
              )}
            </ul>

            {myPlayer?.ready ? (
              <div className="mt-4 w-full rounded-lg border-2 border-outreach-outline/60 bg-outreach-outline/15 py-3 text-center font-semibold text-outreach-outline">
                Done &mdash; waiting for the others
                <p className="mt-1 text-xs font-normal text-outreach-outline/70">
                  You can keep chatting until the phase ends.
                </p>
              </div>
            ) : (
              <button
                onClick={done}
                className="mt-4 w-full rounded-lg bg-outreach-outline py-3 font-semibold text-cream transition-opacity hover:opacity-90"
              >
                Done
              </button>
            )}
          </section>

          {/* RIGHT: open thread, or a desktop placeholder. Hidden on mobile
              until a thread is open. */}
          <section className={activePartner ? "block" : "hidden lg:block"}>
            {activePartner ? (
              <div className="flex flex-col overflow-hidden rounded-xl border border-outreach-outline/30 bg-outreach-fg/20">
                {/* Cross-chat notification: a DM from someone else. */}
                {notification && (
                  <button
                    onClick={() => {
                      setActivePartnerId(notification.senderId);
                      setNotification(null);
                      if (notificationTimerRef.current) {
                        clearTimeout(notificationTimerRef.current);
                      }
                    }}
                    className="flex flex-col items-start gap-0.5 border-b border-gold bg-cream px-3 py-2 text-left"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-outreach-outline/60">
                      New message from {notification.senderName}
                    </span>
                    <span className="line-clamp-2 text-sm text-outreach-outline">
                      {notification.text}
                    </span>
                  </button>
                )}

                {/* Thread header. */}
                <header className="flex items-center justify-between gap-2 border-b border-outreach-outline/20 bg-outreach-fg/30 px-3 py-2">
                  <button
                    onClick={() => setActivePartnerId(null)}
                    aria-label="Back to outreach overview"
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-outreach-outline/40 bg-cream px-3 py-1.5 text-sm font-semibold text-outreach-outline transition-opacity hover:opacity-80 lg:hidden"
                  >
                    <span aria-hidden className="text-base leading-none">
                      &larr;
                    </span>
                    <span>Back</span>
                  </button>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {displayedName(activePartner, room, players, myPlayer?.id)}
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
                <ul className="flex h-[55vh] flex-col gap-2 overflow-y-auto px-4 py-4 lg:h-[26rem]">
                  {threadMessages.length === 0 && (
                    <li className="text-center text-sm text-outreach-outline/60 italic">
                      No messages yet. Say hi.
                    </li>
                  )}
                  {threadMessages.map((m) => {
                    const mine = m.sender_id === myPlayer?.id;
                    return (
                      <li
                        key={m.id}
                        className={
                          "max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words " +
                          (mine
                            ? "self-end bg-outreach-outline text-cream"
                            : "self-start bg-cream text-outreach-outline")
                        }
                      >
                        {m.text}
                      </li>
                    );
                  })}
                </ul>

                {/* Input. */}
                <div className="border-t border-outreach-outline/20 bg-outreach-fg/30 p-3">
                  <div className="flex gap-2">
                    <input
                      value={draft}
                      onChange={(e) =>
                        setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") send();
                      }}
                      disabled={!!myPlayer?.muted}
                      placeholder={
                        myPlayer?.muted
                          ? "You've been muted for this game."
                          : "Type a message…"
                      }
                      className="flex-1 rounded-lg border border-outreach-outline/40 bg-cream px-3 py-2 text-outreach-outline placeholder:text-outreach-outline/40 focus:outline-none focus:ring-2 focus:ring-outreach-outline disabled:opacity-60"
                    />
                    <button
                      onClick={send}
                      disabled={!draft.trim() || sending || !!myPlayer?.muted}
                      className="rounded-lg bg-outreach-outline px-4 py-2 font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                  {sendError && (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      {sendError}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="hidden h-[26rem] items-center justify-center rounded-xl border border-dashed border-outreach-outline/30 bg-outreach-fg/10 px-6 text-center text-sm text-outreach-outline/60 lg:flex">
                Pick a player on the left to start a private conversation.
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
