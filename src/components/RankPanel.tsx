"use client";

// Profile "Ranked" panel: the account's ladder position — a tier-coloured
// emblem with the division number, the tier/division label, a points bar to
// 100, and a promote/demote hint at the boundaries. Reuses the badge tier art
// (TIER_META) so the five rank tiers look the same as the badge tiers.

import { useEffect, useState } from "react";
import { getMyRanked, tierKey, tierName, type RankedState } from "@/lib/ranked";
import { TIER_META } from "@/lib/badges";

export function RankPanel() {
  const [rank, setRank] = useState<RankedState | null>(null);

  useEffect(() => {
    let active = true;
    getMyRanked()
      .then((r) => {
        if (active) setRank(r);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!rank) return null;

  const meta = TIER_META[tierKey(rank.tierIndex)];
  const pts = Math.round(rank.points);
  const isApex = rank.tierIndex === 4 && rank.division === 1;
  const isFloor = rank.tierIndex === 0 && rank.division === 3;
  const atTop = rank.points >= 100;
  const atBottom = rank.points <= 0;

  return (
    <div className="rounded-xl border border-gold/60 bg-home-bg/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gold">Ranked</h2>
        <span className="text-xs text-cream/60">
          {rank.wins}/{rank.games} wins
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 text-2xl font-bold"
          style={{
            background: meta.gradient,
            borderColor: meta.ring,
            color: meta.text,
            boxShadow: meta.glow,
          }}
        >
          {rank.division}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-cream">
            {tierName(rank.tierIndex)}
          </p>
          <p className="text-sm text-cream/70">Division {rank.division}</p>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-cream/15">
          <div
            className="h-full rounded-full bg-gold"
            style={{
              width: `${Math.max(0, Math.min(100, pts))}%`,
              transition: "width 300ms ease",
            }}
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-cream/60">
          <span>{pts}/100 points</span>
          {atTop && !isApex && <span className="text-gold">Win to promote</span>}
          {atBottom && !isFloor && (
            <span className="text-red-300">A loss demotes</span>
          )}
          {isApex && atTop && <span className="text-gold">Peak rank</span>}
        </div>
      </div>
    </div>
  );
}
