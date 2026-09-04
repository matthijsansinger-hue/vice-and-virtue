"use client";

import { useState } from "react";
import { queueGreed } from "@/lib/game";
import type { Player } from "@/lib/types";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";

const COST = 100;

// Greed (vice, Obstructor) — migration 115. Pay 100 SE to rob a player, and
// collect at the END of the reflection: resolve_greed runs after
// resolve_role_action, so you take whatever the target DIDN'T spend on their
// own ability this turn. Robbing someone who just paid 300 for a kill potion
// gets you very little; robbing a hoarder empties them.
//
// The victim is told that something took their Soul Energy, but never who, so
// using it doesn't out you.
export function GreedAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { play } = useAbilityAnimation();

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= COST;

  const targets = players.filter(
    (p) => p.id !== myPlayer.id && !p.dead
  );

  async function pick(id: string) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    setError(null);
    try {
      const res = await queueGreed(myPlayer.id, id);
      if (!res.ok) {
        setError(
          res.reason === "insufficient_se"
            ? "Not enough Soul Energy."
            : res.reason === "already_acted"
              ? "You already acted today."
              : "That target isn't valid."
        );
        return;
      }
      await play(clipForAbility("greed"));
    } catch {
      setError("Couldn't set that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (alreadyActed) {
    return (
      <ParchmentCard kicker="Greed — set">
        <p className="mt-2">
          Your hand is in a pocket. You&rsquo;ll take whatever&rsquo;s left in it
          once everyone has paid for tonight.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Greed">
      <p className="mt-2 text-sm text-cream/80">
        Rob a player for 100. You collect at the end of the reflection, so you
        get what they have <strong>left</strong> &mdash; not what they have now.
        Pick someone who looks like a saver.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={COST} />

      {!canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <TargetList
          targets={targets.map((p) => ({ id: p.id, name: p.name }))}
          onPick={(t) => pick(t.id)}
          disabled={busy}
        />
      )}
      {error && <p className="mt-2 text-sm text-red-300 italic">{error}</p>}
    </AbilityPanel>
  );
}
