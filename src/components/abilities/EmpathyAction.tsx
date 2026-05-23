"use client";

import { useState } from "react";
import { spendSoulEnergy } from "@/lib/game";
import type { Player } from "@/lib/types";

const EMPATHY_COST = 100;

export function EmpathyAction({
  myPlayer,
  players,
  day,
}: {
  myPlayer: Player;
  players: Player[];
  day: number;
}) {
  const [pickedTarget, setPickedTarget] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  const alreadyUsed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= EMPATHY_COST;
  // Any non-null vote means the previous consultation actually happened
  // and its votes are still around to inspect.
  const hasPreviousVotes = players.some((p) => p.vote);

  async function pickTarget(target: Player) {
    if (alreadyUsed || busy || !canAfford) return;
    setBusy(true);
    setPickedTarget(target);
    try {
      await spendSoulEnergy(myPlayer.id, EMPATHY_COST, myPlayer.soul_energy);
    } catch {
      setPickedTarget(null);
    } finally {
      setBusy(false);
    }
  }

  // Result view: show the voters who voted for the picked target.
  if (pickedTarget) {
    const voters = players.filter((p) => p.vote === pickedTarget.id);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Empathy &mdash; voters for {pickedTarget.name}
        </p>
        <ul className="mt-3 flex flex-col gap-1">
          {voters.map((v) => (
            <li
              key={v.id}
              className="rounded bg-home-bg/5 px-3 py-2 font-medium"
            >
              {v.name}
            </li>
          ))}
          {voters.length === 0 && (
            <li className="text-sm text-home-bg/60 italic">
              No one voted for {pickedTarget.name}.
            </li>
          )}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Empathy</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to see who voted for them in the last consultation.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {EMPATHY_COST}
      </p>

      {day === 1 ? (
        <p className="mt-4 text-sm text-cream/70 italic">
          No previous consultation yet &mdash; Empathy can be used from day 2.
        </p>
      ) : !hasPreviousVotes ? (
        <p className="mt-4 text-sm text-cream/70 italic">
          No votes from the previous consultation to inspect.
        </p>
      ) : alreadyUsed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Empathy today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {players
            .filter((p) => p.id !== myPlayer.id)
            .map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => pickTarget(p)}
                  disabled={busy}
                  className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {p.name}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
