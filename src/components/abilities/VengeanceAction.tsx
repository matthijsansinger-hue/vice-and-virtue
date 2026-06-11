"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";

const VENGEANCE_COST = 150;

// Vengeance (normal role-action): hospitalise a player for one day, 150 SE.
// Reuses the 'intox' action (protect-blockable, sends the target to hospital).
// Her revenge-while-imprisoned ability lives in VengeanceRevengeAction, shown
// by RoleAction only when she is in prison.
export function VengeanceAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= VENGEANCE_COST;
  const targets = players.filter((p) => p.id !== myPlayer.id && !p.dead);

  async function pick(target: Player) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        VENGEANCE_COST,
        myPlayer.soul_energy,
        "intox",
        target.id
      );
    } finally {
      setBusy(false);
    }
  }

  if (
    alreadyActed &&
    myPlayer.pending_action === "intox" &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Vengeance &mdash; queued
        </p>
        <p className="mt-2">
          You will send <strong>{target?.name ?? "?"}</strong> to the hospital
          (unless Justice protects them).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Vengeance</p>
      <p className="mt-2 text-sm text-cream/80">
        Send a player to the hospital for a day. Justice protect blocks it.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {VENGEANCE_COST}
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
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
                onClick={() => pick(p)}
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
