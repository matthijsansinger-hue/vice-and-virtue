"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Room, Player } from "@/lib/types";
import { SoulCost, SoulEnergyText } from "@/components/ui/royal";

const TRUTHFULNESS_COST = 200;

// Truthfulness's ability lives on the consultation result screen, NOT in
// the role-action phase. After a player is imprisoned, Truthfulness can
// spend Soul Energy to reveal who voted for them, broadcast to everyone.
//
// Render this only when (a) myPlayer is Truthfulness, (b) someone was
// just imprisoned, and (c) the reveal hasn't already been triggered.
export function TruthfulnessAction({
  myPlayer,
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
      // reveal_votes_truthfulness verifies we're Truthfulness, spends the
      // SE, and sets vote_reveal so everyone sees the imprisoned's voters.
      await supabase.rpc("reveal_votes_truthfulness", {
        p_player_id: myPlayer.id,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 w-full max-w-sm rounded-xl border border-gold/40 bg-consultation-bg p-4 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">
        Truthfulness
      </p>
      <p className="mt-2 text-sm text-cream/80">
        Reveal who voted to imprison {imprisoned.name}. Everyone will see the
        result.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        <SoulEnergyText>Soul Energy</SoulEnergyText>:{" "}
        <SoulCost value={myPlayer.soul_energy} label="" /> &middot;
        cost: <SoulCost value={TRUTHFULNESS_COST} label="" />
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
