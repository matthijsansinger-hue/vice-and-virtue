"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setReady, endOutreach, OUTREACH_SECONDS } from "@/lib/game";
import { sendDirectMessage } from "@/lib/dm";
import { displayedName } from "@/lib/swaps";
import { Centered } from "./Centered";
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

  const isHost = myPlayer?.is_host ?? false;
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
  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      const { data } = await supabase
        .from("dm_messages")
        .select("*")
        .eq("room_id", room.id)
        .order("created_at", { ascending: true });
      if (!cancelled) setAllMessages((data ?? []) as DirectMessage[]);
    }
    loadInitial();

    const channel = supabase
      .channel(`dm-${room.id}`)
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
          setAllMessages((prev) => [...prev, msg]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [room.id]);

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

  // Dead: passive screen.
  if (myPlayer?.dead) {
    return (
      <Centered className="bg-outreach-bg text-outreach-outline">
        <p className="text-xs uppercase tracking-widest text-outreach-outline/70">
          Day {room.day}
        </p>
        <p className="mt-2 text-2xl font-semibold">You&rsquo;re dead</p>
        <p className="mt-2 text-outreach-outline/70">
          The dead cannot chat during outreach (in this version).
        </p>
      </Centered>
    );
  }

  // Hospital: passive screen.
  if (myPlayer?.in_hospital) {
    return (
      <Centered className="bg-outreach-bg text-outreach-outline">
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

  // After Done -> waiting screen.
  if (myPlayer?.ready) {
    return (
      <Centered className="bg-outreach-bg text-outreach-outline">
        <p className="text-xl font-semibold">Done!</p>
        <p className="mt-2 text-outreach-outline/70">
          Waiting for the other players&hellip;
        </p>
      </Centered>
    );
  }

  // Active player: either partner list or a single thread.
  const partners = eligible.filter((p) => p.id !== myPlayer?.id);
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
    if (!text || !activePartner || !myPlayer || sending) return;
    setSending(true);
    try {
      await sendDirectMessage(room.id, myPlayer.id, activePartner.id, text);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  // ----- THREAD VIEW -----
  if (activePartner) {
    return (
      <main className="flex min-h-screen flex-col bg-outreach-bg text-outreach-outline">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-outreach-outline/20 bg-outreach-fg/30 px-4 py-3">
          <button
            onClick={() => setActivePartnerId(null)}
            className="text-sm font-semibold text-outreach-outline hover:underline"
          >
            &larr; Back
          </button>
          <span className="font-semibold">
            {displayedName(activePartner, room, players)}
          </span>
          <span className="text-sm tabular-nums">{remainingSec}s</span>
        </header>

        {/* Thread */}
        <ul className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
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

        {/* Input */}
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
              placeholder="Type a message…"
              className="flex-1 rounded-lg border border-outreach-outline/40 bg-cream px-3 py-2 text-outreach-outline placeholder:text-outreach-outline/40 focus:outline-none focus:ring-2 focus:ring-outreach-outline"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              className="rounded-lg bg-outreach-outline px-4 py-2 font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ----- PARTNER LIST VIEW -----
  return (
    <main className="flex min-h-screen flex-col items-center bg-outreach-bg px-4 py-8 text-outreach-outline">
      <div className="w-full max-w-md">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-outreach-outline/70">
            Day {room.day} &mdash; outreach
          </p>
          <p className="mt-1 text-5xl font-semibold tabular-nums">
            {remainingSec}
            <span className="text-2xl text-outreach-outline/60">s</span>
          </p>
          <p className="mt-1 text-sm text-outreach-outline/70">
            Tap a player to start chatting.
          </p>
        </div>

        <ul className="mt-6 flex flex-col gap-2">
          {partners.map((p) => {
            const thread = allMessages.filter(
              (m) =>
                (m.sender_id === myPlayer?.id && m.recipient_id === p.id) ||
                (m.sender_id === p.id && m.recipient_id === myPlayer?.id)
            );
            const last = thread[thread.length - 1];
            return (
              <li key={p.id}>
                <button
                  onClick={() => setActivePartnerId(p.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-outreach-outline/30 bg-cream px-4 py-3 text-left text-outreach-outline transition-opacity hover:opacity-90"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {displayedName(p, room, players)}
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

        <button
          onClick={done}
          className="mt-6 w-full rounded-lg bg-outreach-outline py-3 font-semibold text-cream transition-opacity hover:opacity-90"
        >
          Done
        </button>
      </div>
    </main>
  );
}
