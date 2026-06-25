"use client";

import { useState } from "react";
import { buyExtraLife } from "@/lib/game";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player } from "@/lib/types";

const COST = 125;

// Determination: buy stackable extra lives (125 SE each). Each absorbs the
// next kill or hospitalisation aimed at you, for the whole game.
export function DeterminationAction({ myPlayer }: { myPlayer: Player }) {
  const [busy, setBusy] = useState(false);
  const { play } = useAbilityAnimation();
  // Optimistic count from the RPC return (player_secrets isn't realtime, and
  // myPlayer.extra_lives only refreshes on the next get_my_secrets pull).
  const [lives, setLives] = useState<number | null>(null);
  const current = lives ?? myPlayer.extra_lives ?? 0;
  const canAfford = myPlayer.soul_energy >= COST;

  async function buy() {
    if (busy || !canAfford) return;
    setBusy(true);
    try {
      const res = await buyExtraLife(myPlayer.id);
      await play(clipForAbility("determination"));
      if (res.ok && typeof res.extra_lives === "number") setLives(res.extra_lives);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Determination</p>
      <p className="mt-2 text-sm text-cream/80">
        Buy extra lives. Each one absorbs the next kill or hospitalisation that
        would strike you — for the whole game — then is spent. Stack as many as
        you can afford.
      </p>

      <p className="mt-4 text-center text-4xl font-semibold tabular-nums text-gold">
        {current}
      </p>
      <p className="text-center text-xs uppercase tracking-widest text-cream/60">
        extra {current === 1 ? "life" : "lives"}
      </p>

      <p className="mt-3 text-xs text-cream/60">
        Soul Energy: <span className="font-semibold">{myPlayer.soul_energy}</span>{" "}
        &middot; cost: {COST} each
      </p>
      <button
        onClick={buy}
        disabled={busy || !canAfford}
        className="mt-3 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy
          ? "Buying…"
          : canAfford
            ? "Buy an extra life (125 SE)"
            : "Not enough Soul Energy"}
      </button>
    </div>
  );
}
