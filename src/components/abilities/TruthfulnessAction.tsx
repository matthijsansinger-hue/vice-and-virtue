"use client";

import { useState } from "react";
import { revealVotes } from "@/lib/game";
import type { Room, Player } from "@/lib/types";

const TRUTHFULNESS_COST = 200;

// Truthfulness's ability lives on the consultation result screen, NOT in
// the role-action phase. After a player is imprisoned, Truthfulness can
// spend Soul Energy to reveal who voted for them, broadcast to everyone.
//
// Render this only when (a) myPlayer is Truthfulness, (b) someone was
// just imprisoned, and (c) the reveal hasn't already been triggered.
export function TruthfulnessAction({
  myPlayer,
  room,
  imprisoned,
}: {
  myPlayer: Player;
  room: Room;
  imprisoned: Player;
}) {
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= TRUTHFULNESS_COST;

  async function reveal() {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await revealVotes(
        myPlayer.id,
        TRUTHFULNESS_COST,
        myPlayer.soul_energy,
        room.id
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 w-full max-w-sm rounded-xl border border-gold/40 bg-consultation-fg/30 p-4 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">
        Truthfulness
      </p>
      <p className="mt-2 text-sm text-cream/80">
        Reveal who voted to imprison {imprisoned.name}. Everyone will see the
        result.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {TRUTHFULNESS_COST}
      </p>

      {alreadyActed ? (
        <p className="mt-3 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : !canAfford ? (
        <p className="mt-3 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <button
          onClick={reveal}
          disabled={busy}
          className="mt-3 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Revealing…" : "Reveal votes"}
        </button>
      )}
    </div>
  );
}
