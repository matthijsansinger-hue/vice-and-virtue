"use client";

// Always-visible currency balances for the top-right of the start screen:
// Life Proficiency (LP) + Mano. Renders nothing for guests / signed-out
// players (they have no balances). Fetches on mount; re-mounts (and refreshes)
// whenever the home screen is shown.

import { useEffect, useState } from "react";
import {
  getMyEconomy,
  LE_ABBR,
  LE_NAME,
  MANO_NAME,
  type AccountEconomy,
} from "@/lib/economy";

export function CurrencyBar() {
  const [econ, setEcon] = useState<AccountEconomy | null>(null);

  useEffect(() => {
    let active = true;
    getMyEconomy()
      .then((e) => {
        if (active) setEcon(e);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!econ) return null;

  return (
    <div className="fixed right-3 top-3 z-30 flex items-center gap-2 text-sm">
      <span
        title={LE_NAME}
        className="rounded-full border border-gold/50 bg-home-bg/70 px-3 py-1 font-semibold text-cream backdrop-blur-sm"
      >
        <span className="text-gold">{econ.le}</span> {LE_ABBR}
      </span>
      <span
        title={MANO_NAME}
        className="rounded-full border border-gold/50 bg-home-bg/70 px-3 py-1 font-semibold text-cream backdrop-blur-sm"
      >
        <span className="text-gold">{econ.mano}</span> {MANO_NAME}
      </span>
    </div>
  );
}
