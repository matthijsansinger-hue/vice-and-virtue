"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";

const MURDER_COST = 150;

export function MurderAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= MURDER_COST;
  // Valid targets: anyone alive (free or imprisoned), but not yourself.
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function pickTarget(target: Player) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        MURDER_COST,
        myPlayer.soul_energy,
        "kill",
        target.id
      );
    } finally {
      setBusy(false);
    }
  }

  // After queueing, show the queued state.
  if (
    alreadyActed &&
    myPlayer.pending_action === "kill" &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <ParchmentCard kicker="Murder — queued">
        <p className="mt-2">
          You will kill <strong>{target?.name ?? "?"}</strong> at the end of
          this phase.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Murder">
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to kill. Resolves at the end of this phase.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={MURDER_COST} />

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
