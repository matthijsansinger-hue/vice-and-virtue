"use client";

import { useState } from "react";
import { spendSoulEnergy } from "@/lib/game";
import type { Player } from "@/lib/types";

const EMPATHY_COST = 150;

// Empathy: spend 150 SE once per day to reveal, for every player who
// received at least one vote in the last consultation, the list of
// voters who picked them. No target selection — it's a flat reveal
// of the whole vote map from yesterday.
export function EmpathyAction({
  myPlayer,
  players,
  day,
}: {
  myPlayer: Player;
  players: Player[];
  day: number;
}) {
  // `revealed` flips true after the player spends SE; the vote map is
  // computed from the current `players` state at that point.
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const alreadyUsed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= EMPATHY_COST;
  // Any non-null vote means the previous consultation actually happened
  // and its votes are still around to inspect.
  const hasPreviousVotes = players.some((p) => p.vote);

  async function reveal() {
    if (alreadyUsed || busy || !canAfford) return;
    setBusy(true);
    try {
      await spendSoulEnergy(myPlayer.id, EMPATHY_COST, myPlayer.soul_energy);
      setRevealed(true);
    } finally {
      setBusy(false);
    }
  }

  // Result view: every player who received 1+ votes is listed with
  // the names of those voters. Skip votes are ignored.
  if (revealed) {
    // Group voters by their vote target.
    const votersByTarget = new Map<string, Player[]>();
    for (const voter of players) {
      if (!voter.vote || voter.vote === "skip") continue;
      const arr = votersByTarget.get(voter.vote) ?? [];
      arr.push(voter);
      votersByTarget.set(voter.vote, arr);
    }
    const entries = Array.from(votersByTarget.entries()).map(
      ([targetId, voters]) => ({
        target: players.find((p) => p.id === targetId),
        voters,
      })
    );

    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Empathy &mdash; last consultation
        </p>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-home-bg/60 italic">
            No one received any votes in the last consultation.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {entries.map(({ target, voters }) => {
              if (!target) return null;
              return (
                <li
                  key={target.id}
                  className="rounded-lg border border-home-bg/10 bg-home-bg/5 px-3 py-2"
                >
                  <p className="text-sm font-semibold">
                    Voters for {target.name}
                  </p>
                  <p className="mt-1 text-sm text-home-bg/80">
                    {voters.map((v) => v.name).join(", ")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Empathy</p>
      <p className="mt-2 text-sm text-cream/80">
        Reveal, for every player, who voted to imprison them in the last
        consultation.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {EMPATHY_COST}
      </p>

      {day === 1 ? (
        <p className="mt-4 text-sm text-cream/70 italic">
          No previous consultation yet &mdash; Empathy can be used from day 2.
        </p>
      ) : !hasPreviousVotes ? (
        <p className="mt-4 text-sm text-cream/70 italic">
          No votes from the previous consultation to inspect.
        </p>
      ) : alreadyUsed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Empathy today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <button
          onClick={reveal}
          disabled={busy}
          className="mt-4 w-full rounded-lg border border-gold bg-cream px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Revealing…" : `Reveal votes (${EMPATHY_COST} SE)`}
        </button>
      )}
    </div>
  );
}
