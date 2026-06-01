"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { sendConsultationMessage } from "@/lib/consultationChat";
import { displayedName } from "@/lib/swaps";
import type {
  ConsultationMessage,
  Player,
  Room,
} from "@/lib/types";

const MESSAGE_MAX_LENGTH = 240;

// Public group chat for the consultation phase. Everyone sees it.
// Dead / imprisoned / hospitalized players can read but not send.
// Filtered to the current day so each consultation has its own thread.
export function ConsultationChat({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [messages, setMessages] = useState<ConsultationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Load existing messages for the current day + subscribe to inserts.
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      const { data } = await supabase
        .from("consultation_messages")
        .select("*")
        .eq("room_id", room.id)
        .eq("day", room.day)
        .order("created_at", { ascending: true });
      if (!cancelled) {
        setMessages((data ?? []) as ConsultationMessage[]);
      }
    }
    loadInitial();

    const channel = supabase
      .channel(`consultation-chat-${room.id}-${room.day}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "consultation_messages",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const msg = payload.new as ConsultationMessage;
          if (msg.day !== room.day) return;
          setMessages((prev) =>
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

  // Auto-scroll to the bottom whenever a new message arrives.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const canSend =
    !!myPlayer &&
    !myPlayer.dead &&
    !myPlayer.in_prison &&
    !myPlayer.in_hospital;

  async function send() {
    if (!myPlayer || !canSend) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendConsultationMessage(room.id, myPlayer.id, room.day, text);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // The reason the composer is disabled, shown in the placeholder.
  let disabledReason: string | null = null;
  if (myPlayer?.dead) disabledReason = "You are dead — you can read but not send.";
  else if (myPlayer?.in_prison)
    disabledReason = "You are in prison — you can read but not send.";
  else if (myPlayer?.in_hospital)
    disabledReason = "You are in hospital — you can read but not send.";

  return (
    <div className="rounded-xl border border-gold/40 bg-cream/95 p-3 text-home-bg">
      <p className="text-center text-[10px] uppercase tracking-widest text-home-bg/50">
        Group chat
      </p>

      <ul
        ref={listRef}
        className="mt-2 flex h-48 flex-col gap-1 overflow-y-auto rounded bg-home-bg/5 px-2 py-2 text-sm"
      >
        {messages.length === 0 && (
          <li className="text-center text-xs text-home-bg/50 italic">
            No messages yet.
          </li>
        )}
        {messages.map((m) => {
          const sender = players.find((p) => p.id === m.sender_id);
          const senderName = sender
            ? displayedName(sender, room, players, myPlayer?.id)
            : "Unknown";
          const isMine = m.sender_id === myPlayer?.id;
          return (
            <li
              key={m.id}
              className="flex flex-col break-words rounded bg-cream px-2 py-1"
            >
              <span
                className={
                  "text-[10px] font-semibold uppercase tracking-wide " +
                  (isMine ? "text-gold" : "text-home-bg/60")
                }
              >
                {isMine ? "You" : senderName}
              </span>
              <span className="text-sm">{m.text}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MESSAGE_MAX_LENGTH))}
          onKeyDown={onKeyDown}
          disabled={!canSend || sending}
          placeholder={disabledReason ?? "Say something…"}
          className="flex-1 rounded border border-home-bg/20 bg-cream px-3 py-2 text-sm text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-home-bg/5 disabled:placeholder:text-home-bg/50"
        />
        <button
          onClick={send}
          disabled={!canSend || sending || draft.trim().length === 0}
          className="rounded bg-gold px-3 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
