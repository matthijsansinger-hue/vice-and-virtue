"use client";

import { useState } from "react";
import { gamblingRoll } from "@/lib/game";
import type { Player } from "@/lib/types";

const COST = 100;

// Gambling: pick a number 1-6 and a target, then roll a die (100 SE). On a
// match, a kill is queued on the target (protection / extra lives can stop it).
export function GamblingAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [guess, setGuess] = useState<number | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ roll: number; hit: boolean } | null>(
    null
  );

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= COST;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function roll() {
    if (busy || !guess || !target || alreadyActed || !canAfford) return;
    setBusy(true);
    try {
      const res = await gamblingRoll(myPlayer.id, target, guess);
      if (res.ok && typeof res.roll === "number") {
        setResult({ roll: res.roll, hit: !!res.hit });
      }
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const t = players.find((p) => p.id === target);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Gambling &mdash; the dice
        </p>
        <p className="mt-2 text-center text-5xl font-bold">{result.roll}</p>
        <p className="mt-3 text-center text-sm">
          {result.hit ? (
            <>
              You called <strong>{guess}</strong> &mdash; a hit!{" "}
              <strong>{t?.name ?? "Your target"}</strong> will be killed at the
              end of this phase (protection can still save them).
            </>
          ) : (
            <>
              You called <strong>{guess}</strong> &mdash; no match. Nothing
              happens this round.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Gambling</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick a number and a target, then roll. If the die matches your number,
        your target dies (Justice protect blocks it). A miss does nothing.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy: <span className="font-semibold">{myPlayer.soul_energy}</span>{" "}
        &middot; cost: {COST}
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already rolled today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs uppercase tracking-wide text-cream/60">
            Your number
          </p>
          <div className="mt-1 grid grid-cols-6 gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setGuess(n)}
                className={
                  "rounded-lg py-2 text-base font-bold transition-colors " +
                  (guess === n
                    ? "bg-gold text-home-bg"
                    : "border border-gold/40 text-cream hover:bg-cream/10")
                }
              >
                {n}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs uppercase tracking-wide text-cream/60">
            Target
          </p>
          <ul className="mt-1 flex flex-col gap-2">
            {targets.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setTarget(p.id)}
                  className={
                    "w-full rounded-lg px-4 py-2 text-left transition-colors " +
                    (target === p.id
                      ? "border-2 border-gold bg-gold text-home-bg"
                      : "border border-gold/40 bg-cream/90 text-home-bg hover:bg-cream")
                  }
                >
                  {p.name}
                  {p.in_prison && (
                    <span className="ml-2 text-xs opacity-60">(in prison)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={roll}
            disabled={busy || !guess || !target}
            className="mt-4 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Rolling…" : "Roll the die (100 SE)"}
          </button>
        </>
      )}
    </div>
  );
}
