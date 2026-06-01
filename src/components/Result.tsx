"use client";

import { useState } from "react";
import Link from "next/link";
import { rankPlayers } from "@/lib/scoring";
import { startGroupAction, startOutreach } from "@/lib/game";
import { displayedName } from "@/lib/swaps";
import type { Room, Player } from "@/lib/types";

// Turns 1, 2, 3... into "1st", "2nd", "3rd"...
function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

// The scoreboard shown after the minigame.
export function Result({
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
  const ranked = rankPlayers(players);
  const mine = ranked.find((r) => r.player.id === myPlayer?.id) ?? null;
  const deadCount = players.filter((p) => p.dead).length;
  const imprisonedCount = players.filter(
    (p) => p.in_prison && !p.dead
  ).length;
  const hospitalCount = players.filter(
    (p) => p.in_hospital && !p.dead && !p.in_prison
  ).length;

  // If the host enabled the outreach phase in the lobby, we go there
  // next; otherwise we jump straight to the pre-consultation group
  // action (Eye / Free / Skip).
  const nextPhaseLabel = room.outreach_enabled ? "outreach" : "group action";

  async function goNext() {
    setContinuing(true);
    try {
      if (room.outreach_enabled) {
        await startOutreach(room.id);
      } else {
        await startGroupAction(room.id);
      }
    } catch {
      setContinuing(false);
    }
  }

  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-6 py-12 text-cream">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-gold">
          Day {room.day} &mdash; results
        </h1>

        {mine && (
          <div className="mt-4 rounded-xl border border-gold bg-cream p-6 text-center text-home-bg">
            <p className="text-sm text-home-bg/60">You finished</p>
            <p className="mt-1 text-4xl font-semibold">{ordinal(mine.rank)}</p>
            <p className="mt-3 text-sm text-home-bg/60">Soul Energy earned</p>
            <p className="text-2xl font-semibold">
              {mine.soulEnergy}
              <span className="ml-2 text-base font-normal text-home-bg/60">
                (total {mine.player.soul_energy})
              </span>
            </p>
          </div>
        )}

        {/* Players who sat the round out (prison / hospital / dead) get
            an explainer instead of a personal scoreboard card, so they
            understand why they have no rank. They still see the full
            scoreboard below. */}
        {!mine && myPlayer && (
          <div className="mt-4 rounded-xl border border-gold/60 bg-cream/90 p-5 text-center text-home-bg">
            <p className="text-sm text-home-bg/60">
              {myPlayer.dead
                ? "You're dead"
                : myPlayer.in_prison
                  ? "You're in prison"
                  : myPlayer.in_hospital
                    ? "You're in hospital"
                    : "You didn't play this round"}
            </p>
            <p className="mt-1 text-sm text-home-bg/70">
              You sat this minigame out, so you didn&rsquo;t earn Soul
              Energy. The scoreboard below shows everyone who did.
            </p>
          </div>
        )}

        <h2 className="mt-8 text-sm uppercase tracking-widest text-gold">
          Scoreboard
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {ranked.map(({ player, rank, soulEnergy }) => {
            const isMe = player.id === myPlayer?.id;
            return (
              <li
                key={player.id}
                className={
                  "flex items-center justify-between rounded-lg bg-cream px-4 py-3 text-home-bg " +
                  (isMe ? "border-2 border-gold" : "border border-gold/40")
                }
              >
                <span className="flex items-center gap-3">
                  <span className="w-6 text-right font-semibold text-home-bg/60">
                    {rank}
                  </span>
                  <span>
                    {displayedName(player, room, players, myPlayer?.id)}
                    {isMe && (
                      <span className="ml-2 text-xs text-home-bg/50">
                        (you)
                      </span>
                    )}
                  </span>
                </span>
                <span className="font-semibold">
                  {soulEnergy}
                  <span className="ml-1 text-xs font-normal text-home-bg/60">
                    ({player.soul_energy})
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {(imprisonedCount > 0 || deadCount > 0 || hospitalCount > 0) && (
          <p className="mt-3 text-center text-xs text-cream/60">
            {[
              deadCount > 0 && `${deadCount} dead`,
              imprisonedCount > 0 && `${imprisonedCount} in prison`,
              hospitalCount > 0 && `${hospitalCount} in hospital`,
            ]
              .filter(Boolean)
              .join(", ")}{" "}
            (not scoring this round).
          </p>
        )}


        {isHost ? (
          <button
            onClick={goNext}
            disabled={continuing}
            className="mt-8 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {continuing ? "Continuing…" : `Continue to ${nextPhaseLabel}`}
          </button>
        ) : (
          <p className="mt-8 text-center text-sm text-cream/60">
            Waiting for the host to continue&hellip;
          </p>
        )}

        <div className="mt-4 text-center">
          <Link href="/" className="text-xs text-cream/40 underline">
            Back to start
          </Link>
        </div>
      </div>
    </main>
  );
}
