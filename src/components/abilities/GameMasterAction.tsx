"use client";

import { useState } from "react";
import { gmFreePrisoner } from "@/lib/game";
import type { Player } from "@/lib/types";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";

const COST = 100;
const TARGET_ROUND = 9;

// The Game Master (neutral anomaly, migration 118). He wins ALONE if the game
// is still being played when round 9 opens, so every player he keeps in the
// game works for him.
//
// Freeing costs 100 SE, once a day — deliberately far cheaper than the communal
// 500 SE prison fund. It runs here in Role action rather than the Market
// specifically so a JAILED Game Master can still use it, including on himself;
// otherwise jailing him would end his game on the spot.
export function GameMasterAction({
  myPlayer,
  players,
  day,
}: {
  myPlayer: Player;
  players: Player[];
  day: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freed, setFreed] = useState<string | null>(null);
  const { play } = useAbilityAnimation();

  const canAfford = myPlayer.soul_energy >= COST;
  const roundsLeft = Math.max(0, TARGET_ROUND - day);

  // Himself included — being jailed is exactly when he needs this.
  const prisoners = players.filter((p) => p.in_prison && !p.dead);

  async function free(id: string) {
    if (busy || !canAfford) return;
    setBusy(true);
    setError(null);
    try {
      const res = await gmFreePrisoner(myPlayer.id, id);
      if (!res.ok) {
        setError(
          res.reason === "insufficient_se"
            ? "Not enough Soul Energy."
            : res.reason === "already_used"
              ? "You've already freed someone today."
              : res.reason === "not_imprisoned"
                ? "They're not in prison."
                : "Couldn't do that right now."
        );
        return;
      }
      setFreed(id);
      await play(clipForAbility("game_master"));
    } catch {
      setError("Couldn't do that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const goal = (
    <p className="mt-2 rounded-lg border border-soul/30 bg-soul/10 px-3 py-2 text-xs text-cream/85">
      <strong>Your win:</strong> keep this game alive until round {TARGET_ROUND}
      {roundsLeft > 0 ? ` — ${roundsLeft} more to go.` : " — this is it."} Both
      camps lose if you get there.
    </p>
  );

  if (freed) {
    const name = players.find((p) => p.id === freed)?.name;
    return (
      <ParchmentCard kicker="Game Master — done">
        <p className="mt-2">
          {freed === myPlayer.id
            ? "You let yourself out. The game goes on."
            : `${name ?? "They"} walk free. The game goes on.`}
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Game Master">
      {goal}
      <p className="mt-3 text-sm text-cream/80">
        Open a cell for 100 &mdash; once a day. Anyone you free is another
        player still in the game, and you can free <strong>yourself</strong> if
        they put you in there.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={COST} />

      {prisoners.length === 0 ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          Nobody is in prison right now.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <TargetList
          targets={prisoners.map((p) => ({
            id: p.id,
            name: p.id === myPlayer.id ? `${p.name} (you)` : p.name,
          }))}
          onPick={(t) => free(t.id)}
          disabled={busy}
        />
      )}
      {error && <p className="mt-2 text-sm text-red-300 italic">{error}</p>}
    </AbilityPanel>
  );
}
