"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";

const INTOX_COST = 100;

export function IntoxicationAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= INTOX_COST;
  // Targets: alive (free or imprisoned, but not dead), not self.
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function pickTarget(target: Player) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        INTOX_COST,
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
      <ParchmentCard kicker="Intoxication — queued">
        <p className="mt-2">
          You will hospitalize <strong>{target?.name ?? "?"}</strong> at the
          end of this phase.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Intoxication">
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to send to the hospital for one day. They cannot act or
        score until tomorrow. Justice protect blocks this.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={INTOX_COST} />

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
