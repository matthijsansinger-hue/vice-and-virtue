"use client";

import { useEffect, useRef } from "react";
import { playPrisonDoor } from "@/lib/sound";
import type { CourtState } from "@/lib/court";
import type { Player } from "@/lib/types";

const REASON_LABEL: Record<string, string> = {
  press: "pressed a charge",
  back: "backed a charge",
  refund: "refunded",
  exhibit: "filed an exhibit",
  counterproof: "filed counterproof",
  objection: "objected",
  objection_won: "caught a forgery",
  objection_fee: "proof upheld (objection fee)",
  payout: "the prosecution won (×2)",
  pot_share: "the defence's share of the pot",
  counterproof_won: "counterproof back ×2",
};

// Step 4 — settlement: the verdict, every player's gains and losses (all of it
// follows from public stakes, proof and the verdict), the reputations. Most
// players press Continue → the new day.
export function CourtSettlement({
  state,
  myPlayer,
  nameOf,
}: {
  state: CourtState;
  players: Player[];
  myPlayer: Player | null;
  nameOf: (id: string) => string;
}) {
  const t = state.trial;
  const def = state.defendant_id ?? t?.defendant_id ?? null;
  const doorRef = useRef(false);
  useEffect(() => {
    if (t?.outcome === "imprisoned" && !doorRef.current) {
      doorRef.current = true;
      playPrisonDoor();
    }
  }, [t?.outcome]);

  const byPlayer = new Map<string, { total: number; lines: { amount: number; reason: string }[] }>();
  for (const l of state.ledger) {
    const e = byPlayer.get(l.player_id) ?? { total: 0, lines: [] };
    e.total += l.amount;
    e.lines.push({ amount: l.amount, reason: l.reason });
    byPlayer.set(l.player_id, e);
  }
  const mine = myPlayer ? byPlayer.get(myPlayer.id)?.total ?? 0 : 0;
  const name = def ? nameOf(def) : "";
  const counts =
    t && t.guilty !== null ? ` — ${t.guilty} Guilty · ${t.not_guilty} Not guilty` : "";

  return (
    <div className="space-y-3 text-cream">
      <div className="rounded-xl border-2 border-gold bg-home-bg/90 p-4 text-center">
        <p className="text-lg font-semibold uppercase tracking-wide">
          {t?.outcome === "imprisoned" && `${name}${counts} → imprisoned`}
          {t?.outcome === "spared" && `${name}${counts} → spared`}
          {t?.outcome === "warded" && `${name}${counts} — can't be imprisoned today`}
          {t?.outcome === "adjourned" && "The court is adjourned"}
        </p>
        {t?.by_justice && (
          <p className="mt-1 text-sm text-gold">Justice has spoken: {name} is a Vice and goes to prison.</p>
        )}
        {t?.outcome === "warded" && (
          <p className="mt-1 text-sm text-cream/75">Nobody goes to prison, and everyone is refunded.</p>
        )}
        {t?.outcome === "adjourned" && (
          <p className="mt-1 text-sm text-cream/75">The defendant can&rsquo;t be tried. Everything is refunded.</p>
        )}
      </div>

      {myPlayer && (
        <p className="text-center font-semibold text-gold">
          Your day in court: {mine > 0 ? "+" : ""}
          {mine}
        </p>
      )}

      <ul className="space-y-1">
        {[...byPlayer]
          .sort((a, b) => b[1].total - a[1].total)
          .map(([id, e]) => (
            <li
              key={id}
              className={
                "rounded-lg px-3 py-2 text-sm " +
                (id === myPlayer?.id ? "border border-gold bg-gold/15" : "bg-home-bg/60")
              }
            >
              <p className="flex justify-between font-semibold">
                <span>{nameOf(id)}</span>
                <span>
                  {e.total > 0 ? "+" : ""}
                  {e.total}
                </span>
              </p>
              <p className="text-xs text-cream/65">
                {e.lines.map((l) => `${l.amount > 0 ? "+" : ""}${l.amount} ${REASON_LABEL[l.reason] ?? l.reason}`).join(" · ")}
              </p>
            </li>
          ))}
      </ul>
    </div>
  );
}
