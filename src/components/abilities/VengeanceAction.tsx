"use client";

import { useEffect, useState } from "react";
import { queueAction } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import type { Room, Player } from "@/lib/types";

const VENGEANCE_COST = 100;

export function VengeanceAction({
  myPlayer,
  players,
  room,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
}) {
  const [busy, setBusy] = useState(false);
  // Whether Vengeance can act this round (a Vice was just imprisoned).
  // Checked server-side so the imprisoned player's camp isn't exposed to
  // everyone; null = still checking.
  const [available, setAvailable] = useState<boolean | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= VENGEANCE_COST;

  const lastImprisonedId = room.last_imprisoned_player;
  const lastImprisoned = lastImprisonedId
    ? players.find((p) => p.id === lastImprisonedId)
    : null;

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("vengeance_available", { p_player_id: myPlayer.id })
      .then(({ data }) => {
        if (!cancelled) setAvailable(!!data);
      });
    return () => {
      cancelled = true;
    };
  }, [myPlayer.id, lastImprisonedId]);

  // Guess targets: every other living player. We no longer pre-filter to
  // actual voters (that would leak who voted) — a wrong guess just fails
  // server-side at resolution.
  const eligibleTargets = players.filter(
    (p) => p.id !== myPlayer.id && p.id !== lastImprisonedId && !p.dead
  );

  async function pickVoter(voter: Player) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        VENGEANCE_COST,
        myPlayer.soul_energy,
        "vengeance_guess",
        voter.id
      );
    } finally {
      setBusy(false);
    }
  }

  if (
    alreadyActed &&
    myPlayer.pending_action === "vengeance_guess" &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Vengeance &mdash; queued
        </p>
        <p className="mt-2">
          You guessed <strong>{target?.name ?? "?"}</strong>. If they voted to
          imprison {lastImprisoned?.name ?? "the imprisoned player"}, they
          will be hospitalized.
        </p>
      </div>
    );
  }

  // Cannot act: no prior imprisonment.
  if (!lastImprisoned) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">
          Vengeance
        </p>
        <p className="mt-2 text-sm text-cream/70 italic">
          No one was imprisoned in the last consultation.
        </p>
      </div>
    );
  }

  // Still checking whether a Vice was imprisoned.
  if (available === null) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">
          Vengeance
        </p>
        <p className="mt-2 text-sm text-cream/70 italic">Checking&hellip;</p>
      </div>
    );
  }

  // Cannot act: the most recent imprisonment was not a Vice.
  if (available === false) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">
          Vengeance
        </p>
        <p className="mt-2 text-sm text-cream/70 italic">
          The last imprisoned player ({lastImprisoned.name}) was a Virtue.
          Vengeance only triggers when a Vice is imprisoned.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Vengeance</p>
      <p className="mt-2 text-sm text-cream/80">
        <strong>{lastImprisoned.name}</strong> was imprisoned in the last
        consultation. Guess who voted for them &mdash; a correct guess sends
        that player to the hospital.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {VENGEANCE_COST}
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : eligibleTargets.length === 0 ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          No players left to guess.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {eligibleTargets.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => pickVoter(p)}
                disabled={busy}
                className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
