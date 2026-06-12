"use client";

import { useState } from "react";
import { queueAction } from "@/lib/game";
import type { Player } from "@/lib/types";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";
import { SoulCost } from "@/components/ui/royal";

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
  // Justice can protect themselves but cannot kill themselves.
  const targets = players.filter((p) => {
    if (p.dead) return false;
    if (p.id === myPlayer.id) return action === "protect";
    return true;
  });

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
      <ParchmentCard kicker="Justice — queued">
        <p className="mt-2">
          You will {verb} <strong>{target?.name ?? "?"}</strong> at the end of
          this phase.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Justice">
      <p className="mt-2 text-sm text-cream/80">
        Choose an action, then pick a target. Resolves at the end of this
        phase. Protection blocks kills targeting the same player.
      </p>
      <CostLine have={myPlayer.soul_energy} />

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
                  "flex-1 rounded-lg px-3 py-3 font-semibold transition-[opacity,box-shadow] " +
                  (canAffordProtect
                    ? "bg-consultation-fg text-cream shadow-[0_0_10px_rgba(0,0,128,.45)] hover:opacity-90 hover:shadow-[0_0_16px_rgba(0,0,128,.65)]"
                    : "bg-cream/10 text-cream/40")
                }
              >
                Protect
                <span className={`ml-1 text-xs ${canAffordProtect ? "" : "opacity-80"}`}>
                  (<SoulCost value={PROTECT_COST} />)
                </span>
              </button>
              <button
                onClick={() => setAction("kill")}
                disabled={!canAffordKill}
                className={
                  "flex-1 rounded-lg px-3 py-3 font-semibold transition-[opacity,box-shadow] " +
                  (canAffordKill
                    ? "bg-consultation-bg text-cream shadow-[0_0_10px_rgba(128,0,32,.45)] hover:opacity-90 hover:shadow-[0_0_16px_rgba(128,0,32,.65)]"
                    : "bg-cream/10 text-cream/40")
                }
              >
                Kill
                <span className={`ml-1 text-xs ${canAffordKill ? "" : "opacity-80"}`}>
                  (<SoulCost value={KILL_COST} />)
                </span>
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
              <TargetList
                targets={targets}
                onPick={pickTarget}
                disabled={busy}
                tag={(p) =>
                  p.in_prison && (
                    <span className="ml-2 text-xs text-home-bg/50">
                      (in prison)
                    </span>
                  )
                }
              />
            </>
          )}
        </>
      )}
    </AbilityPanel>
  );
}
