"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useBlockedIds } from "@/lib/blocks";
import type { Message } from "@/lib/types";

// Read-only panel that shows all messages sent to the given camp.
// Updates live as new messages arrive.
//
// Senders are NOT displayed — by design, camp messages are anonymous
// broadcasts (the data is in the DB if we ever want to use it for
// other roles, but the UI doesn't reveal who sent what).
export function CampMessagesPanel({
  roomId,
  camp,
}: {
  roomId: string;
  camp: "vice" | "virtue";
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const { blocked } = useBlockedIds(roomId);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("room_id", roomId)
        .eq("camp", camp)
        .order("created_at", { ascending: true });
      if (!cancelled) {
        setMessages((data ?? []) as Message[]);
      }
    }
    loadInitial();

    const channel = supabase
      .channel(`camp-messages-${roomId}-${camp}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          if (msg.camp === camp) {
            setMessages((prev) => [...prev, msg]);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, camp]);

  // Hide messages from players you've blocked. Camp chat is anonymous, so
  // there's no per-message block here — blocking happens elsewhere (lobby /
  // named chats) and the filter applies everywhere by sender id.
  const visible = messages.filter((m) => !blocked.has(m.sender_id));
  if (visible.length === 0) return null;

  const campLabel = camp === "vice" ? "Vices" : "Virtues";

  return (
    <div className="rounded-xl border border-gold/40 bg-cream p-4 text-home-bg">
      <p className="text-sm uppercase tracking-widest text-home-bg/60">
        {campLabel} &mdash; messages
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {visible.map((m) => (
          <li
            key={m.id}
            className="rounded bg-home-bg/5 px-3 py-2 text-sm font-medium break-words"
          >
            {m.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
