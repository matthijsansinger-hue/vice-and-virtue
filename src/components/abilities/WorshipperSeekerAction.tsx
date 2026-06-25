"use client";

import { useState } from "react";
import { revealSelf, queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import {
  AbilityPanel,
  ParchmentCard,
  CostLine,
  TargetList,
  AbilityOption,
  BackButton,
} from "./ui";

const COST = 100;

// Vice Worshipper / Virtue Seeker share this component. Two abilities (one use
// per day):
//   * Reveal yourself privately to one player (100 SE) — they get a notice
//     naming you and your role.
//   * Guess the counterpart (100 SE): a correct Worshipper guess kills the
//     Virtue Seeker (Justice protect can block); a correct Seeker guess
//     imprisons the Vice Worshipper. Resolved at end of role-action.
export function WorshipperSeekerAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [mode, setMode] = useState<"reveal" | "guess" | null>(null);
  const { play } = useAbilityAnimation();
  const [busy, setBusy] = useState(false);
  const [revealedTo, setRevealedTo] = useState<string | null>(null);

  const isWorshipper = myPlayer.role === "vice_worshipper";
  const roleLabel = isWorshipper ? "Vice Worshipper" : "Virtue Seeker";
  const counterpartLabel = isWorshipper ? "Virtue Seeker" : "Vice Worshipper";
  const guessEffect = isWorshipper ? "kill them" : "imprison them";
  const guessAction = isWorshipper ? "worshipper_guess" : "seeker_guess";

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= COST;
  const targets = players.filter((p) => p.id !== myPlayer.id && !p.dead);

  async function doReveal(target: Player) {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await revealSelf(myPlayer.id, target.id);
      await play(clipForAbility(myPlayer.role));
      if (ok) setRevealedTo(target.name);
    } finally {
      setBusy(false);
    }
  }

  async function doGuess(target: Player) {
    if (busy) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        COST,
        myPlayer.soul_energy,
        guessAction,
        target.id
      );
      await play(clipForAbility(myPlayer.role));
    } finally {
      setBusy(false);
    }
  }

  if (revealedTo) {
    return (
      <ParchmentCard kicker={`${roleLabel} — revealed`}>
        <p className="mt-2">
          You revealed yourself to <strong>{revealedTo}</strong>.
        </p>
      </ParchmentCard>
    );
  }

  if (
    alreadyActed &&
    myPlayer.pending_action === guessAction &&
    myPlayer.pending_target
  ) {
    const t = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <ParchmentCard kicker={`${roleLabel} — queued`}>
        <p className="mt-2">
          You guessed <strong>{t?.name ?? "?"}</strong>. If they are the{" "}
          {counterpartLabel}, you will {guessEffect}.
        </p>
      </ParchmentCard>
    );
  }

  if (alreadyActed) {
    return (
      <AbilityPanel title={roleLabel}>
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      </AbilityPanel>
    );
  }

  if (mode === null) {
    return (
      <AbilityPanel title={roleLabel}>
        <CostLine have={myPlayer.soul_energy} />
        <div className="mt-4 flex flex-col gap-2">
          <AbilityOption
            onClick={() => setMode("reveal")}
            disabled={!canAfford}
            cost={COST}
          >
            Reveal yourself to a player
          </AbilityOption>
          <AbilityOption
            onClick={() => setMode("guess")}
            disabled={!canAfford}
            cost={COST}
          >
            Guess the {counterpartLabel} &mdash; {guessEffect}
          </AbilityOption>
        </div>
        {!canAfford && (
          <p className="mt-2 text-sm text-red-300 italic">
            Not enough Soul Energy.
          </p>
        )}
      </AbilityPanel>
    );
  }

  const onPick = mode === "reveal" ? doReveal : doGuess;
  return (
    <AbilityPanel title={roleLabel}>
      <p className="mt-2 text-sm text-cream/80">
        {mode === "reveal"
          ? "Pick a player to privately reveal your identity to."
          : `Pick the player you think is the ${counterpartLabel}.`}
      </p>
      <TargetList targets={targets} onPick={onPick} disabled={busy} />
      <BackButton onClick={() => setMode(null)} disabled={busy} />
    </AbilityPanel>
  );
}
