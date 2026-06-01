"use client";

import { useState } from "react";
import { spendSoulEnergy } from "@/lib/game";
import { getRole } from "@/lib/roles";
import type { Player } from "@/lib/types";

const CERTAINTY_COST = 100;

// Certainty: pick a single player, reveal their specific role (and
// the camp it belongs to). Flat cost of 100 Soul Energy. Self is
// excluded from the picker.
export function CertaintyAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [pickedTarget, setPickedTarget] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  const alreadyUsed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= CERTAINTY_COST;

  async function pickTarget(target: Player) {
    if (alreadyUsed || busy || !canAfford) return;
    setBusy(true);
    setPickedTarget(target);
    try {
      await spendSoulEnergy(myPlayer.id, CERTAINTY_COST, myPlayer.soul_energy);
    } catch {
      setPickedTarget(null);
    } finally {
      setBusy(false);
    }
  }

  // Result view: show the target's specific role + camp.
  if (pickedTarget) {
    const role = getRole(pickedTarget.role);
    const isVice = role?.camp === "vice";
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Certainty &mdash; {pickedTarget.name}
        </p>
        {role ? (
          <div className="mt-3 flex items-center gap-3">
            <span
              className={
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-home-bg/10 text-base font-semibold text-cream " +
                (isVice ? "bg-consultation-bg" : "bg-consultation-fg")
              }
              aria-hidden
            >
              {role.name.charAt(0)}
            </span>
            <span>
              <span className="block text-xs uppercase tracking-wide text-home-bg/60">
                Their role
              </span>
              <span className="block text-2xl font-semibold leading-tight">
                {role.name}
              </span>
              <span className="block text-xs text-home-bg/60">
                {isVice ? "Vice" : "Virtue"} &middot; Tier {role.tier}
              </span>
            </span>
          </div>
        ) : (
          <p className="mt-3 text-sm text-home-bg/60 italic">
            Could not determine their role.
          </p>
        )}
      </div>
    );
  }

  // Picker view: choose a player to inspect.
  const targets = players.filter((p) => p.id !== myPlayer.id);

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Certainty</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to reveal their exact role.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {CERTAINTY_COST}
      </p>

      {alreadyUsed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Certainty today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {targets.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => pickTarget(p)}
                disabled={busy}
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
