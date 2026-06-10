"use client";

import { useState } from "react";
import { revealSelf, queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";

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
    } finally {
      setBusy(false);
    }
  }

  if (revealedTo) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          {roleLabel} &mdash; revealed
        </p>
        <p className="mt-2">
          You revealed yourself to <strong>{revealedTo}</strong>.
        </p>
      </div>
    );
  }

  if (
    alreadyActed &&
    myPlayer.pending_action === guessAction &&
    myPlayer.pending_target
  ) {
    const t = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          {roleLabel} &mdash; queued
        </p>
        <p className="mt-2">
          You guessed <strong>{t?.name ?? "?"}</strong>. If they are the{" "}
          {counterpartLabel}, you will {guessEffect}.
        </p>
      </div>
    );
  }

  if (alreadyActed) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">
          {roleLabel}
        </p>
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">
          {roleLabel}
        </p>
        <p className="mt-2 text-xs text-cream/60">
          Soul Energy:{" "}
          <span className="font-semibold">{myPlayer.soul_energy}</span>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => setMode("reveal")}
            disabled={!canAfford}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Reveal yourself to a player (100 SE)
          </button>
          <button
            onClick={() => setMode("guess")}
            disabled={!canAfford}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Guess the {counterpartLabel} &mdash; {guessEffect} (100 SE)
          </button>
        </div>
        {!canAfford && (
          <p className="mt-2 text-sm text-red-300 italic">
            Not enough Soul Energy.
          </p>
        )}
      </div>
    );
  }

  const onPick = mode === "reveal" ? doReveal : doGuess;
  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">{roleLabel}</p>
      <p className="mt-2 text-sm text-cream/80">
        {mode === "reveal"
          ? "Pick a player to privately reveal your identity to."
          : `Pick the player you think is the ${counterpartLabel}.`}
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {targets.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onPick(p)}
              disabled={busy}
              className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setMode(null)}
        disabled={busy}
        className="mt-2 w-full rounded-lg border border-gold/50 px-4 py-2 text-sm text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
      >
        Back
      </button>
    </div>
  );
}
