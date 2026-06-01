"use client";

import { useState } from "react";
import { endEventSummary } from "@/lib/game";
import { displayedName } from "@/lib/swaps";
import type { EventSummaryEntry, Player, Room } from "@/lib/types";

// Shown between role-action and the minigame. Surfaces the visible
// consequences of the previous role-action phase (deaths +
// hospitalizations only — protect / envy / torment are intentionally
// hidden). The host clicks Continue when everyone has read the events;
// non-host players see a "waiting" line.
export function EventSummary({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [continuing, setContinuing] = useState(false);

  const isHost = myPlayer?.is_host ?? false;

  async function next() {
    if (continuing) return;
    setContinuing(true);
    try {
      await endEventSummary(room.id);
    } catch {
      setContinuing(false);
    }
  }

  if (!myPlayer) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg px-6 text-center text-cream">
        This game is already in progress.
      </main>
    );
  }

  const events: EventSummaryEntry[] = room.last_events ?? [];
  const playerById = new Map(players.map((p) => [p.id, p] as const));

  return (
    <main className="wood-desk-startscreen min-h-screen bg-home-bg px-5 py-20 text-cream">
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
            const isHospital = e.type === "hospitalized";
            // Both event types now show the player's real name + first
            // letter avatar in a NEUTRAL brown — no camp colour, no
            // role badge. Killed players' role + camp stay hidden
            // mid-game; only GameOver reveals roles publicly.
            const name = displayedName(target, room, players, myPlayer?.id);
            return (
              <li
                key={idx}
                className="flex items-center gap-3 rounded-lg border border-gold/40 bg-cream px-3 py-3 text-home-bg"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-home-bg text-sm font-semibold text-cream"
                  aria-hidden
                >
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm">
                  <span className="font-semibold">{name}</span>
                  <span className="mx-2 text-home-bg/40">|</span>
                  <span>
                    {isHospital
                      ? "was sent to the hospital"
                      : "was killed"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 flex flex-col items-center">
          {isHost ? (
            <button
              onClick={next}
              disabled={continuing}
              className="w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {continuing ? "Continuing…" : "Continue to minigame"}
            </button>
          ) : (
            <p className="text-sm text-cream/70">
              Waiting for the host to continue&hellip;
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
