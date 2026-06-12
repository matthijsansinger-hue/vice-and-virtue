"use client";

import { useState } from "react";
import { convertPlayer, armTiebreak } from "@/lib/game";
import type { Player } from "@/lib/types";

const CONVERT_COST = 150;
const TIEBREAK_COST = 100;

// Love (one ability per day): turn a Vice into a Virtue Seeker (150 — charged
// even if the target wasn't a Vice), OR arm the deciding vote (100): in this
// day's consultation, a tie you vote in breaks to your chosen target.
export function LoveAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [mode, setMode] = useState<"turn" | "tiebreak" | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  // Conversion only lands on an active target (server rejects dead / imprisoned
  // / hospitalised), so don't offer them.
  const targets = players.filter(
    (p) => !p.dead && !p.in_prison && !p.in_hospital && p.id !== myPlayer.id
  );

  async function turn(target: Player) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await convertPlayer(myPlayer.id, target.id);
      if (res.ok) {
        setDone(
          res.converted
            ? `You turned ${target.name} — they now serve the Virtues as a Seeker.`
            : `${target.name} was already devout — they were not a Vice. Your offering was spent regardless.`
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function armVote() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await armTiebreak(myPlayer.id);
      if (ok) {
        setDone(
          "You've armed the deciding vote. If today's imprisonment ties, and you voted for one of the tied players, your choice is imprisoned."
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">Love</p>
        <p className="mt-2">{done}</p>
      </div>
    );
  }

  if (alreadyActed) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Love</p>
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Love</p>
        <p className="mt-2 text-sm text-cream/80">Choose how to act today.</p>
        <p className="mt-2 text-xs text-cream/60">
          Soul Energy:{" "}
          <span className="font-semibold">{myPlayer.soul_energy}</span>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => setMode("turn")}
            disabled={myPlayer.soul_energy < CONVERT_COST}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Turn a Vice into a Virtue Seeker (150 SE)
          </button>
          <button
            onClick={() => setMode("tiebreak")}
            disabled={myPlayer.soul_energy < TIEBREAK_COST}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Arm the deciding vote (100 SE)
          </button>
        </div>
      </div>
    );
  }

  if (mode === "tiebreak") {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Love</p>
        <p className="mt-2 text-sm text-cream/80">
          Arm the deciding vote for today only. If the imprisonment vote ends in
          a tie and you voted for one of the tied players, that player is
          imprisoned instead of going to a re-vote.
        </p>
        <button
          onClick={armVote}
          disabled={busy}
          className="mt-4 w-full rounded-lg border border-gold bg-cream px-4 py-3 text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Arm the deciding vote (100 SE)
        </button>
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

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Love</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick who to turn. It only takes hold on a Vice — but your offering is
        spent either way, so choose someone you believe serves the dark.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {targets.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => turn(p)}
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
