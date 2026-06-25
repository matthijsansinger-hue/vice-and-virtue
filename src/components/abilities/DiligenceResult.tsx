"use client";

import { useState } from "react";
import { diligenceCount } from "@/lib/game";
import type { Player } from "@/lib/types";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";

const COST = 100;

// Diligence's result-screen ability: pay 100 SE to learn how many of this
// round's minigame guesses were correct. One use per day.
export function DiligenceResult({ myPlayer }: { myPlayer: Player }) {
  const [busy, setBusy] = useState(false);
  const { play } = useAbilityAnimation();
  const [correct, setCorrect] = useState<number | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= COST;

  async function reveal() {
    if (busy || alreadyActed || !canAfford) return;
    setBusy(true);
    try {
      const res = await diligenceCount(myPlayer.id);
      await play(clipForAbility("diligence"));
      if (res.ok && typeof res.correct === "number") setCorrect(res.correct);
    } finally {
      setBusy(false);
    }
  }

  if (correct !== null) {
    return (
      <div className="mt-4 w-full max-w-sm rounded-xl border border-gold/40 bg-cream p-4 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Diligence
        </p>
        <p className="mt-1 text-center text-3xl font-semibold">{correct}</p>
        <p className="text-center text-xs text-home-bg/60">
          {correct === 1 ? "player" : "players"} you read correctly this round
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 w-full max-w-sm rounded-xl border border-gold/40 bg-reflection-fg/30 p-4 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Diligence</p>
      {alreadyActed ? (
        <p className="mt-2 text-sm text-cream/60 italic">
          You already used your ability today.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-cream/80">
            Pay {COST} Soul Energy to see how many players you read correctly
            this round.
          </p>
          <button
            onClick={reveal}
            disabled={busy || !canAfford}
            className="mt-3 w-full rounded-lg bg-gold py-2.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? "Counting…"
              : canAfford
                ? `Count my correct reads (${COST} SE)`
                : "Not enough Soul Energy"}
          </button>
        </>
      )}
    </div>
  );
}
