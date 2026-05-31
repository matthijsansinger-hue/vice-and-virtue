"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { sendDeadMessage } from "@/lib/deadChat";
import type { DeadMessage, Player, Room } from "@/lib/types";

const MESSAGE_MAX_LENGTH = 240;

// Private group chat for dead players. Living players never see this
// component — the caller is expected to gate its rendering on
// `myPlayer.dead`. Spans the whole game; no day filtering.
export function DeadChat({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [messages, setMessages] = useState<DeadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      const { data } = await supabase
        .from("dead_messages")
        .select("*")
        .eq("room_id", room.id)
        .order("created_at", { ascending: true });
      if (!cancelled) setMessages((data ?? []) as DeadMessage[]);
    }
    loadInitial();

    const channel = supabase
      .channel(`dead-chat-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dead_messages",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const msg = payload.new as DeadMessage;
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
  }, [room.id]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const canSend = !!myPlayer?.dead;

  async function send() {
    if (!myPlayer || !canSend) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendDeadMessage(room.id, myPlayer.id, text);
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

  return (
    <div className="rounded-xl border-2 border-gold/70 bg-home-bg/85 p-3 text-cream shadow-lg">
      <p className="text-center text-[10px] uppercase tracking-widest text-gold">
        The Dead &mdash; private chat
      </p>

      <ul
        ref={listRef}
        className="mt-2 flex h-44 flex-col gap-1 overflow-y-auto rounded bg-cream/5 px-2 py-2 text-sm"
      >
        {messages.length === 0 && (
          <li className="text-center text-xs italic text-cream/60">
            No words from the other side yet.
          </li>
        )}
        {messages.map((m) => {
          const sender = players.find((p) => p.id === m.sender_id);
          const isMine = m.sender_id === myPlayer?.id;
          return (
            <li
              key={m.id}
              className="flex flex-col break-words rounded bg-cream/10 px-2 py-1"
            >
              <span
                className={
                  "text-[10px] font-semibold uppercase tracking-wide " +
                  (isMine ? "text-gold" : "text-cream/70")
                }
              >
                {isMine ? "You" : sender?.name ?? "Unknown"}
              </span>
              <span className="text-sm text-cream">{m.text}</span>
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
          placeholder={canSend ? "Whisper to the dead…" : "Only the dead may speak here."}
          className="flex-1 rounded border border-gold/40 bg-cream/95 px-3 py-2 text-sm text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-cream/40 disabled:placeholder:text-home-bg/40"
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
