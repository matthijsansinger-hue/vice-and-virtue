"use client";

import { useState } from "react";
import { ROLES, type Tier } from "@/lib/roles";
import { spendSoulEnergy } from "@/lib/game";
import type { Player } from "@/lib/types";

// Cost in Soul Energy per chosen tier (Y * multiplier, Y = 100).
const TIER_COSTS: Record<Tier, number> = {
  S: 350,
  A: 300,
  B: 250,
  C: 200,
  D: 100,
};

const TIERS: Tier[] = ["S", "A", "B", "C", "D"];

export function CertaintyAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [pickedTier, setPickedTier] = useState<Tier | null>(null);
  const [busy, setBusy] = useState(false);

  const alreadyUsed = myPlayer.acted_this_day;

  async function pickTier(tier: Tier) {
    if (alreadyUsed || busy) return;
    const cost = TIER_COSTS[tier];
    if (myPlayer.soul_energy < cost) return;
    setBusy(true);
    setPickedTier(tier);
    try {
      await spendSoulEnergy(myPlayer.id, cost, myPlayer.soul_energy);
    } catch {
      setPickedTier(null);
    } finally {
      setBusy(false);
    }
  }

  // Result view: show which players hold a role in the picked tier.
  if (pickedTier) {
    const inTier = players.filter(
      (p) =>
        p.role && ROLES[p.role]?.tier === pickedTier && p.id !== myPlayer.id
    );
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Certainty &mdash; tier {pickedTier}
        </p>
        <p className="mt-2 text-sm text-home-bg/70">
          Players with a {pickedTier}-tier role:
        </p>
        <ul className="mt-3 flex flex-col gap-1">
          {inTier.map((p) => (
            <li
              key={p.id}
              className="rounded bg-home-bg/5 px-3 py-2 font-medium"
            >
              {p.name}
            </li>
          ))}
          {inTier.length === 0 && (
            <li className="text-sm text-home-bg/60 italic">
              No other player holds a tier-{pickedTier} role.
            </li>
          )}
        </ul>
      </div>
    );
  }

  // Picker view: choose a tier to inspect.
  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Certainty</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick a tier to see all players who hold a role in it.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy: <span className="font-semibold">{myPlayer.soul_energy}</span>
      </p>

      {alreadyUsed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Certainty today.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-5 gap-2">
          {TIERS.map((tier) => {
            const cost = TIER_COSTS[tier];
            const affordable = myPlayer.soul_energy >= cost;
            return (
              <button
                key={tier}
                onClick={() => pickTier(tier)}
                disabled={!affordable || busy}
                className={
                  "flex flex-col items-center rounded-lg border px-2 py-2 transition-colors " +
                  (affordable
                    ? "border-gold bg-cream text-home-bg hover:opacity-90"
                    : "border-cream/20 bg-cream/10 text-cream/40")
                }
              >
                <span className="text-lg font-semibold">{tier}</span>
                <span className="text-[10px]">{cost} SE</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
