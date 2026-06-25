"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";

const ENVY_COST = 100;

export function EnvyAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);
  const { play } = useAbilityAnimation();

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= ENVY_COST;
  // Targets: alive (free or imprisoned), not self.
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function pickTarget(target: Player) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        ENVY_COST,
        myPlayer.soul_energy,
        "envy_swap",
        target.id
      );
      await play(clipForAbility("envy"));
    } finally {
      setBusy(false);
    }
  }

  if (
    alreadyActed &&
    myPlayer.pending_action === "envy_swap" &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <ParchmentCard kicker="Envy — queued">
        <p className="mt-2">
          You will swap identities with{" "}
          <strong>{target?.name ?? "?"}</strong> for this round. Votes will
          route to each other instead.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Envy">
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to swap identities with for this round. Names swap
        everywhere and votes for either of you route to the other.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={ENVY_COST} />

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
