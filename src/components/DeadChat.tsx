"use client";

import { useEffect, useRef, useState } from "react";
import { heading } from "@/components/ui/royal";
import { supabase } from "@/lib/supabase";
import { sendDeadMessage } from "@/lib/deadChat";
import { useBlockedIds } from "@/lib/blocks";
import { useReportedIds, isSilenced } from "@/lib/reports";
import { BlockedStrip } from "./BlockedStrip";
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
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const { blocked, block } = useBlockedIds(room.id);
  const { isReported, report } = useReportedIds(room.id);

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

  const canSend = !!myPlayer?.dead && !isSilenced(myPlayer, room.day);
  const deadPlaceholder = !myPlayer?.dead
    ? "Only the dead may speak here."
    : isSilenced(myPlayer, room.day)
      ? myPlayer?.muted
        ? "You've been muted for this game."
        : "You've been silenced for today."
      : "Whisper to the dead…";
  const visibleMessages = messages.filter((m) => !blocked.has(m.sender_id));

  async function send() {
    if (!myPlayer || !canSend) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      await sendDeadMessage(room.id, myPlayer.id, text);
      setDraft("");
    } catch (e) {
      setSendError(
        e instanceof Error ? e.message : "Couldn't send that message."
      );
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
    <div
      className="rounded-xl border-2 border-gold/70 p-3 text-cream shadow-[0_6px_18px_rgba(0,0,0,.4),0_0_12px_rgba(227,181,16,.15)]"
      style={{ background: "rgba(40,26,14,.92)" }}
    >
      <p className={`text-center text-[10px] uppercase tracking-widest text-gold ${heading}`}>
        The Dead &mdash; private chat
      </p>

      <BlockedStrip
        room={room}
        players={players}
        myPlayerId={myPlayer?.id}
        dark
        className="mt-2"
      />

      <ul
        ref={listRef}
        className="mt-2 flex h-44 flex-col gap-1 overflow-y-auto rounded bg-cream/5 px-2 py-2 text-sm"
      >
        {visibleMessages.length === 0 && (
          <li className="text-center text-xs italic text-cream/60">
            No words from the other side yet.
          </li>
        )}
        {visibleMessages.map((m) => {
          const sender = players.find((p) => p.id === m.sender_id);
          const isMine = m.sender_id === myPlayer?.id;
          return (
            <li
              key={m.id}
              className="flex flex-col break-words rounded bg-cream/10 px-2 py-1"
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={
                    "text-[10px] font-semibold uppercase tracking-wide " +
                    (isMine ? "text-gold" : "text-cream/70")
                  }
                >
                  {isMine ? "You" : sender?.name ?? "Unknown"}
                </span>
                {!isMine && (
                  <span className="flex shrink-0 items-center gap-2">
                    {myPlayer &&
                      (isReported(m.sender_id) ? (
                        <span className="text-[10px] text-cream/30">
                          Reported
                        </span>
                      ) : (
                        <button
                          onClick={() => report(myPlayer.id, m.sender_id)}
                          title="Report this player"
                          className="text-[10px] text-cream/40 hover:text-red-300"
                        >
                          Report
                        </button>
                      ))}
                    <button
                      onClick={() => block(m.sender_id)}
                      title="Block this player"
                      className="text-[10px] text-cream/40 hover:text-red-300"
                    >
                      Block
                    </button>
                  </span>
                )}
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
          placeholder={deadPlaceholder}
          className="flex-1 rounded border border-gold/40 bg-cream/95 px-3 py-2 text-sm text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-1 focus:ring-gold disabled:bg-cream/40 disabled:placeholder:text-home-bg/40"
        />
        <button
          onClick={send}
          disabled={!canSend || sending || draft.trim().length === 0}
          className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-home-bg shadow-[0_0_8px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_12px_rgba(227,181,16,.5)] disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {sendError && (
        <p className="mt-1 text-xs text-red-300">{sendError}</p>
      )}
    </div>
  );
}
