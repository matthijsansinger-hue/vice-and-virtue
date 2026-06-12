"use client";

import { useState } from "react";
import { giftSoulEnergy, grantExtraLife } from "@/lib/game";
import type { Player } from "@/lib/types";

const GIFT_COST = 100;
const LIFE_COST = 200;

// Generosity (one ability per day): gift a player 100 Soul Energy (100), or
// grant a player a lasting extra life (200).
export function GenerosityAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [mode, setMode] = useState<"gift" | "life" | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function act(target: Player) {
    if (busy || !mode) return;
    setBusy(true);
    try {
      const ok =
        mode === "gift"
          ? await giftSoulEnergy(myPlayer.id, target.id)
          : await grantExtraLife(myPlayer.id, target.id);
      if (ok) {
        setDone(
          mode === "gift"
            ? `You gave ${target.name} 100 Soul Energy.`
            : `You granted ${target.name} an extra life.`
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Generosity
        </p>
        <p className="mt-2">{done}</p>
      </div>
    );
  }

  if (alreadyActed) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Generosity</p>
        <p className="mt-4 text-sm text-cream/60 italic">
          You already gave today.
        </p>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Generosity</p>
        <p className="mt-2 text-sm text-cream/80">Choose what to give today.</p>
        <p className="mt-2 text-xs text-cream/60">
          Soul Energy:{" "}
          <span className="font-semibold">{myPlayer.soul_energy}</span>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => setMode("gift")}
            disabled={myPlayer.soul_energy < GIFT_COST}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Gift a player 100 Soul Energy (100 SE)
          </button>
          <button
            onClick={() => setMode("life")}
            disabled={myPlayer.soul_energy < LIFE_COST}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Grant a player a lasting extra life (200 SE)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Generosity</p>
      <p className="mt-2 text-sm text-cream/80">
        {mode === "gift"
          ? "Pick who receives 100 Soul Energy."
          : "Pick who receives an extra life (absorbs a future kill or hospitalisation)."}
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {targets.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => act(p)}
              disabled={busy}
              className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {p.name}
              {p.in_prison && (
                <span className="ml-2 text-xs text-home-bg/50">(in prison)</span>
              )}
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
