"use client";

import { useEffect, useRef } from "react";
import { setReady, endEventSummary } from "@/lib/game";
import { displayedName } from "@/lib/swaps";
import type { EventSummaryEntry, Player, Room } from "@/lib/types";

// Shown between role-action and the minigame. Surfaces the visible
// consequences of the previous role-action phase (deaths +
// hospitalizations only — protect / envy / torment are intentionally
// hidden). All players click Proceed; the host advances when everyone
// is ready.
export function EventSummary({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  const readyCount = players.filter((p) => p.ready).length;
  const allReady = players.length > 0 && players.every((p) => p.ready);

  useEffect(() => {
    if (isHost && allReady && !advancedRef.current) {
      advancedRef.current = true;
      endEventSummary(room.id);
    }
  }, [isHost, allReady, room.id]);

  if (!myPlayer) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-home-bg px-6 text-center text-cream">
        This game is already in progress.
      </main>
    );
  }

  const events: EventSummaryEntry[] = room.last_events ?? [];
  const playerById = new Map(players.map((p) => [p.id, p] as const));

  return (
    <main className="min-h-screen bg-home-bg px-5 py-20 text-cream">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-gold">
          Day {room.day} &mdash; what happened
        </h1>
        <p className="mt-1 text-center text-xs text-cream/60">
          Word travels through the castle.
        </p>

        <ul className="mt-6 flex flex-col gap-2">
          {events.length === 0 && (
            <li className="rounded-lg border border-gold/30 bg-cream/5 px-4 py-3 text-center text-sm text-cream/70">
              Nothing notable happened.
            </li>
          )}

          {events.map((e, idx) => {
            const target = playerById.get(e.target_id);
            if (!target) return null;
            const name = displayedName(target, room, players);
            return (
              <li
                key={idx}
                className="flex items-center gap-3 rounded-lg border border-gold/40 bg-cream px-3 py-3 text-home-bg"
              >
                <span
                  className={
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-cream " +
                    (e.type === "killed"
                      ? "bg-consultation-bg"
                      : "bg-consultation-fg")
                  }
                  aria-hidden
                >
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm">
                  <span className="font-semibold">{name}</span>
                  <span className="mx-2 text-home-bg/40">|</span>
                  <span>
                    {e.type === "killed"
                      ? "was killed"
                      : "was sent to the hospital"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 flex flex-col items-center">
          {myPlayer.ready ? (
            <p className="text-sm text-cream/70">
              You&rsquo;re ready &mdash; waiting for the others (
              {readyCount}/{players.length})
            </p>
          ) : (
            <button
              onClick={() => setReady(myPlayer.id, true)}
              className="rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Proceed
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
