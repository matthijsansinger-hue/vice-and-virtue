"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";

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
      <ParchmentCard kicker="Vengeance — queued">
        <p className="mt-2">
          You will send <strong>{target?.name ?? "?"}</strong> to the hospital
          (unless Justice protects them).
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Vengeance">
      <p className="mt-2 text-sm text-cream/80">
        Send a player to the hospital for a day. Justice protect blocks it.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={VENGEANCE_COST} />

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <TargetList targets={targets} onPick={pick} disabled={busy} />
      )}
    </AbilityPanel>
  );
}
