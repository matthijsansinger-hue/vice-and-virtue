"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";

const TORMENT_COST = 100;

export function TormentAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= TORMENT_COST;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function pickTarget(target: Player) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        TORMENT_COST,
        myPlayer.soul_energy,
        "torment",
        target.id
      );
    } finally {
      setBusy(false);
    }
  }

  if (
    alreadyActed &&
    myPlayer.pending_action === "torment" &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <ParchmentCard kicker="Torment — queued">
        <p className="mt-2">
          <strong>{target?.name ?? "?"}</strong>&rsquo;s minigame will have
          half of the player icons obscured this round.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Torment">
      <p className="mt-2 text-sm text-cream/80">
        Pick a player. In the next minigame, half of the other players&rsquo;
        icons will be obscured on their screen.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={TORMENT_COST} />

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <TargetList
          targets={targets}
          onPick={pickTarget}
          disabled={busy}
          tag={(p) =>
            p.in_prison && (
              <span className="ml-2 text-xs text-home-bg/50">(in prison)</span>
            )
          }
        />
      )}
    </AbilityPanel>
  );
}
