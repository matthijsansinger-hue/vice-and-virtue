"use client";

import { useEffect, useState } from "react";
import { plantBomb, bombCarriers, fanaticState } from "@/lib/game";
import type { Player } from "@/lib/types";

const PLANT_COST = 100;
const CHECK_COST = 100;

// Fanaticism (one reflection action per day): plant a bomb on a player (100, up
// to 2 per game), or pay 100 to see who currently carries your bombs.
// Detonation happens separately, during the consultation phase.
export function FanaticismAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [mode, setMode] = useState<"plant" | "check" | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<{ id: number; name: string }[] | null>(
    null
  );
  const [remaining, setRemaining] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  const targets = players.filter(
    (p) => !p.dead && !p.in_prison && !p.in_hospital && p.id !== myPlayer.id
  );

  // Load how many bombs are left to plant + how many are in circulation.
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
        setDone(`${target.name} is already carrying a bomb. Try someone else next time.`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await bombCarriers(myPlayer.id);
      if (res.ok) {
        setCarriers(res.carriers ?? []);
      }
    } finally {
      setBusy(false);
    }
  }

  if (carriers) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Fanaticism &mdash; your bombs
        </p>
        {carriers.length === 0 ? (
          <p className="mt-2 italic text-home-bg/70">
            You have no bombs in circulation.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {carriers.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="font-semibold">Bomb {c.id}</span> &mdash;{" "}
                {c.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
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

  if (mode === null) {
    const noBombsLeft = remaining !== null && remaining < 1;
    const noneInPlay = active !== null && active < 1;
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Fanaticism</p>
        <p className="mt-2 text-sm text-cream/80">
          Spread your bombs, or scout where they&rsquo;ve drifted. Detonate
          during the consultation.
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
              &middot; In circulation:{" "}
              <span className="font-semibold">{active}</span>
            </>
          )}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => setMode("plant")}
            disabled={myPlayer.soul_energy < PLANT_COST || noBombsLeft}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Plant a bomb (100 SE)
            {noBombsLeft && (
              <span className="ml-1 text-xs text-home-bg/50">(none left)</span>
            )}
          </button>
          <button
            onClick={check}
            disabled={myPlayer.soul_energy < CHECK_COST || noneInPlay || busy}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            See who carries your bombs (100 SE)
            {noneInPlay && (
              <span className="ml-1 text-xs text-home-bg/50">(none in play)</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Fanaticism</p>
      <p className="mt-2 text-sm text-cream/80">
        Slip a bomb to a player. From tomorrow they must pass it on each
        reflection &mdash; and you can detonate it during any consultation.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {targets.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => plant(p)}
              disabled={busy}
              className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setMode(null)}
        disabled={busy}
        className="mt-2 w-full rounded-lg border border-gold/50 px-4 py-2 text-sm text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
      >
        Back
      </button>
    </div>
  );
}
