"use client";

import { useEffect, useState } from "react";
import { plantBomb, fanaticState } from "@/lib/game";
import type { Player } from "@/lib/types";

const PLANT_COST = 50;

// Fanaticism, role-action (migration 072): plant a bomb on a player (50 SE, up
// to 2 per game). Checking carriers + detonating now happen in the shop phase.
export function FanaticismAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  const targets = players.filter(
    (p) => !p.dead && !p.in_prison && !p.in_hospital && p.id !== myPlayer.id
  );

  useEffect(() => {
    let alive = true;
    fanaticState(myPlayer.id).then((s) => {
      if (!alive || !s.ok) return;
      setRemaining(s.remaining ?? 0);
      setActive(s.active ?? 0);
    });
    return () => {
      alive = false;
    };
  }, [myPlayer.id]);

  async function plant(target: Player) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await plantBomb(myPlayer.id, target.id);
      if (res.ok) {
        setDone(`You slipped a bomb to ${target.name}.`);
      } else if (res.reason === "already_holding") {
        setDone(`${target.name} is already carrying a bomb. Try someone else.`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Fanaticism
        </p>
        <p className="mt-2">{done}</p>
      </div>
    );
  }

  if (alreadyActed) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Fanaticism</p>
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      </div>
    );
  }

  const noBombsLeft = remaining !== null && remaining < 1;

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Fanaticism</p>
      <p className="mt-2 text-sm text-cream/80">
        Slip a bomb to a player (50 SE). From tomorrow they must pass it on each
        reflection — and you can detonate it during a shop phase.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span>
        {remaining !== null && (
          <>
            {" "}
            &middot; Bombs left to plant:{" "}
            <span className="font-semibold">{remaining}</span>
          </>
        )}
        {active !== null && (
          <>
            {" "}
            &middot; In circulation: <span className="font-semibold">{active}</span>
          </>
        )}
      </p>

      {noBombsLeft ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You&rsquo;ve planted both your bombs. Check on them or detonate during
          the shop phase.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {targets.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => plant(p)}
                disabled={busy || myPlayer.soul_energy < PLANT_COST}
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
