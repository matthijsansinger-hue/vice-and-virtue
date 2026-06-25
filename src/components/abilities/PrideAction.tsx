"use client";

import { useState } from "react";
import { prideReveal } from "@/lib/game";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player } from "@/lib/types";

const COST = 50;

// Pride: reveal yourself to a random player (50 SE); that player scores
// nothing in this round's minigame. One use per day.
export function PrideAction({ myPlayer }: { myPlayer: Player }) {
  const [busy, setBusy] = useState(false);
  const { play } = useAbilityAnimation();
  const [revealedTo, setRevealedTo] = useState<string | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= COST;

  async function reveal() {
    if (busy || alreadyActed || !canAfford) return;
    setBusy(true);
    try {
      const res = await prideReveal(myPlayer.id);
      await play(clipForAbility("pride"));
      if (res.ok && res.target_name) setRevealedTo(res.target_name);
    } finally {
      setBusy(false);
    }
  }

  if (revealedTo) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">Pride</p>
        <p className="mt-2">
          You revealed yourself to <strong>{revealedTo}</strong> — dazzled, they
          will score nothing in this round&rsquo;s minigame.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Pride</p>
      <p className="mt-2 text-sm text-cream/80">
        Show off to a random player. They learn you are Pride, but they&rsquo;re
        so dazzled they score nothing in this round&rsquo;s minigame.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy: <span className="font-semibold">{myPlayer.soul_energy}</span>{" "}
        &middot; cost: {COST}
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already showed off today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <button
          onClick={reveal}
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Revealing…" : "Dazzle a random player (50 SE)"}
        </button>
      )}
    </div>
  );
}
