"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";

const PROTECT_COST = 100;
const KILL_COST = 200;

export function JusticeAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [action, setAction] = useState<"kill" | "protect" | null>(null);
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAffordProtect = myPlayer.soul_energy >= PROTECT_COST;
  const canAffordKill = myPlayer.soul_energy >= KILL_COST;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function pickTarget(target: Player) {
    if (!action || alreadyActed || busy) return;
    const cost = action === "kill" ? KILL_COST : PROTECT_COST;
    if (myPlayer.soul_energy < cost) return;
    setBusy(true);
    try {
      await queueAction(
        myPlayer.id,
        cost,
        myPlayer.soul_energy,
        action,
        target.id
      );
    } finally {
      setBusy(false);
    }
  }

  if (
    alreadyActed &&
    (myPlayer.pending_action === "kill" ||
      myPlayer.pending_action === "protect") &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    const verb = myPlayer.pending_action === "kill" ? "kill" : "protect";
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Justice &mdash; queued
        </p>
        <p className="mt-2">
          You will {verb} <strong>{target?.name ?? "?"}</strong> at the end of
          this phase.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Justice</p>
      <p className="mt-2 text-sm text-cream/80">
        Choose an action, then pick a target. Resolves at the end of this
        phase. Protection blocks kills targeting the same player.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span>
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : (
        <>
          {!action ? (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setAction("protect")}
                disabled={!canAffordProtect}
                className={
                  "flex-1 rounded-lg px-3 py-3 font-semibold transition-opacity " +
                  (canAffordProtect
                    ? "bg-consultation-fg text-cream hover:opacity-90"
                    : "bg-cream/10 text-cream/40")
                }
              >
                Protect
                <span className="ml-1 text-xs opacity-80">
                  ({PROTECT_COST})
                </span>
              </button>
              <button
                onClick={() => setAction("kill")}
                disabled={!canAffordKill}
                className={
                  "flex-1 rounded-lg px-3 py-3 font-semibold transition-opacity " +
                  (canAffordKill
                    ? "bg-consultation-bg text-cream hover:opacity-90"
                    : "bg-cream/10 text-cream/40")
                }
              >
                Kill
                <span className="ml-1 text-xs opacity-80">({KILL_COST})</span>
              </button>
            </div>
          ) : (
            <>
              <div className="mt-4 flex items-center justify-between text-sm">
                <p>
                  Pick a target to <strong>{action}</strong>:
                </p>
                <button
                  onClick={() => setAction(null)}
                  className="text-xs text-cream/60 underline"
                >
                  change action
                </button>
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {targets.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => pickTarget(p)}
                      disabled={busy}
                      className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {p.name}
                      {p.in_prison && (
                        <span className="ml-2 text-xs text-home-bg/50">
                          (in prison)
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
