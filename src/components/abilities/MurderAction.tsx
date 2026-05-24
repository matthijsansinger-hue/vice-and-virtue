"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";

const MURDER_COST = 100;

export function MurderAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= MURDER_COST;
  // Valid targets: anyone alive (free or imprisoned), but not yourself.
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function pickTarget(target: Player) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        MURDER_COST,
        myPlayer.soul_energy,
        "kill",
        target.id
      );
    } finally {
      setBusy(false);
    }
  }

  // After queueing, show the queued state.
  if (
    alreadyActed &&
    myPlayer.pending_action === "kill" &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Murder &mdash; queued
        </p>
        <p className="mt-2">
          You will kill <strong>{target?.name ?? "?"}</strong> at the end of
          this phase.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Murder</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to kill. Resolves at the end of this phase.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {MURDER_COST}
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {targets.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => pickTarget(p)}
                disabled={busy}
                className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {p.name}
                {p.in_prison && (
                  <span className="ml-2 text-xs text-home-bg/50">
                    (in prison)
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
