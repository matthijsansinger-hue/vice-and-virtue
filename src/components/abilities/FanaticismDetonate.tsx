"use client";

import { useCallback, useEffect, useState } from "react";
import { myBombs, detonateBomb } from "@/lib/game";
import type { Player } from "@/lib/types";

const DETONATE_COST = 150;

// Shown to Fanaticism during the consultation phase: detonate one of your live
// bombs (150 SE) to instantly kill its current holder. The list is BLIND — you
// see "Bomb 1 / Bomb 2", not who holds it (paying 100 in reflection reveals
// that). A bomb that drifted onto a teammate will kill them. Renders nothing
// unless you're an active Fanaticism with at least one live bomb.
export function FanaticismDetonate({ myPlayer }: { myPlayer: Player }) {
  const [bombs, setBombs] = useState<{ id: number; alive: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const active =
    myPlayer.role === "fanaticism" &&
    !myPlayer.dead &&
    !myPlayer.in_prison &&
    !myPlayer.in_hospital;

  const refresh = useCallback(() => {
    if (!active) return;
    myBombs(myPlayer.id).then(setBombs);
  }, [active, myPlayer.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!active) return null;
  const liveBombs = bombs.filter((b) => b.alive);
  if (liveBombs.length === 0) return null;

  async function detonate(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await detonateBomb(myPlayer.id, id);
      if (res.ok) {
        setResult(
          res.killed_name
            ? `Bomb ${id} detonated — it killed ${res.killed_name}.`
            : `Bomb ${id} detonated.`
        );
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const canAfford = myPlayer.soul_energy >= DETONATE_COST;

  return (
    <div
      className="mt-4 rounded-xl border-2 border-[#b3445c]/70 p-4 text-cream"
      style={{
        background:
          "linear-gradient(165deg, rgba(128,0,32,.5) 0%, rgba(24,6,10,.92) 70%)",
      }}
    >
      <p className="text-sm font-semibold uppercase tracking-widest text-[#e6889a]">
        Fanaticism &mdash; detonate
      </p>
      <p className="mt-1 text-xs text-cream/75">
        Kill whoever holds a bomb (150 SE). You won&rsquo;t know who until it
        blows &mdash; it may be a friend.
      </p>
      {result && (
        <p className="mt-2 text-sm font-medium text-[#f3c0cb]">{result}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {liveBombs.map((b) => (
          <button
            key={b.id}
            onClick={() => detonate(b.id)}
            disabled={busy || !canAfford}
            className="rounded-lg border border-[#b3445c] bg-black/25 px-4 py-2 text-sm font-semibold text-cream transition-opacity hover:bg-black/40 disabled:opacity-50"
          >
            Detonate Bomb {b.id}
          </button>
        ))}
      </div>
      {!canAfford && (
        <p className="mt-2 text-xs italic text-cream/55">
          Not enough Soul Energy (need {DETONATE_COST}).
        </p>
      )}
    </div>
  );
}
