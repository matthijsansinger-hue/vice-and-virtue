"use client";

import { useEffect, useRef } from "react";
import { playPrisonDoor } from "@/lib/sound";
import type { CourtState } from "@/lib/court";
import { Name, PAPER } from "./names";
import type { Player } from "@/lib/types";

// Step 4 — settlement: the verdict, then each player's net gain or loss for
// the day in court (just the total — the line-by-line sums were clutter).
// Most players press Continue → the new day.
export function CourtSettlement({
  state,
  myPlayer,
}: {
  state: CourtState;
  players: Player[];
  myPlayer: Player | null;
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

  const totals = new Map<string, number>();
  for (const l of state.ledger) totals.set(l.player_id, (totals.get(l.player_id) ?? 0) + l.amount);
  const rows = [...totals].filter(([, n]) => n !== 0).sort((a, b) => b[1] - a[1]);
  const mine = myPlayer ? totals.get(myPlayer.id) ?? 0 : 0;
  const counts = t && t.guilty !== null ? `${t.guilty} Guilty · ${t.not_guilty} Not guilty` : null;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-gold bg-home-bg p-5 text-center text-cream shadow-[0_6px_18px_rgba(0,0,0,.3)]">
        {t?.outcome === "adjourned" ? (
          <>
            <p className="text-xl font-black uppercase tracking-wide">The court is adjourned</p>
            <p className="mt-1 text-sm text-cream/80">The defendant can&rsquo;t be tried. Everything is refunded.</p>
          </>
        ) : (
          <>
            <p className="flex flex-wrap items-center justify-center gap-2 text-xl font-black uppercase tracking-wide">
              <Name id={def} />
              <span>
                {t?.outcome === "imprisoned" && "→ imprisoned"}
                {t?.outcome === "spared" && "→ spared"}
                {t?.outcome === "warded" && "can't be imprisoned today"}
              </span>
            </p>
            {counts && <p className="mt-1 text-sm text-cream/80">{counts}</p>}
            {t?.by_justice && (
              <p className="mt-2 text-sm font-semibold text-gold">
                Justice has spoken: a Vice stood trial and goes to prison.
              </p>
            )}
            {t?.outcome === "warded" && (
              <p className="mt-2 text-sm text-cream/80">Nobody goes to prison, and everyone is refunded.</p>
            )}
          </>
        )}
      </div>

      {myPlayer && (
        <p className="text-center text-lg font-black text-home-bg">
          Your day in court: {sign(mine)} SE
        </p>
      )}

      {rows.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(([id, n]) => (
            <li
              key={id}
              className={
                "flex items-center justify-between gap-2 rounded-lg border-2 px-3 py-2 text-home-bg " +
                (id === myPlayer?.id ? "border-home-bg" : "border-[#b08a2e]/50")
              }
              style={{ background: PAPER }}
            >
              <Name id={id} />
              <span className={"text-base font-black " + (n > 0 ? "text-[#1d6b2c]" : "text-[#b3141b]")}>
                {sign(n)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
