"use client";

import { useState } from "react";
import { instantSacrificeServer, queueAction } from "@/lib/game";
import type { Room, Player } from "@/lib/types";

// Sacrifice acts in two contexts:
//   - mode="queued" (role-action): queued, resolved at end of phase, Justice
//     protect can spare any of you.
//   - mode="instant" (consultation): immediate, no protect.
// The first target is free; each additional target costs 200 SE (charged when
// the sacrifice is committed). Cannot be used while imprisoned.
const EXTRA_COST = 200;

export function SacrificeAction({
  myPlayer,
  players,
  room,
  mode,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
  mode: "queued" | "instant";
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);
  const extraCost = Math.max(0, selectedIds.length - 1) * EXTRA_COST;
  const canAfford = myPlayer.soul_energy >= extraCost;
  const nameOf = (id: string) =>
    players.find((p) => p.id === id)?.name ?? "?";

  function toggle(id: string) {
    setSelectedIds((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );
  }

  async function confirm() {
    if (selectedIds.length === 0 || alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      if (mode === "queued") {
        await queueAction(
          myPlayer.id,
          extraCost,
          myPlayer.soul_energy,
          "sacrifice",
          JSON.stringify(selectedIds)
        );
      } else {
        await instantSacrificeServer(room.id, myPlayer.id, selectedIds);
      }
    } finally {
      setBusy(false);
    }
  }

  // Cannot use while imprisoned.
  if (myPlayer.in_prison) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Sacrifice</p>
        <p className="mt-4 text-sm text-cream/60 italic">
          You cannot sacrifice while imprisoned.
        </p>
      </div>
    );
  }

  // Queued "already queued" display.
  if (
    mode === "queued" &&
    alreadyActed &&
    myPlayer.pending_action === "sacrifice" &&
    myPlayer.pending_target
  ) {
    let names: string[] = [];
    try {
      names = (JSON.parse(myPlayer.pending_target) as string[]).map(nameOf);
    } catch {
      names = [nameOf(myPlayer.pending_target)];
    }
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Sacrifice &mdash; queued
        </p>
        <p className="mt-2">
          You will die together with <strong>{names.join(", ")}</strong> at the
          end of this phase.
        </p>
        <p className="mt-2 text-xs text-home-bg/60">
          Justice protect can spare any of you.
        </p>
      </div>
    );
  }

  // Confirm step.
  if (confirming) {
    const names = selectedIds.map(nameOf);
    return (
      <div
        className={
          "rounded-xl border border-gold/40 p-5 text-cream " +
          (mode === "instant" ? "bg-consultation-bg" : "bg-reflection-fg/30")
        }
      >
        <p className="text-sm uppercase tracking-widest text-gold">Sacrifice</p>
        <p className="mt-2 text-sm text-cream/80">
          You and <strong>{names.join(", ")}</strong> will all die{" "}
          {mode === "queued" ? "at the end of this phase" : "right now"}. This
          cannot be undone.
          {extraCost > 0 && (
            <span className="mt-1 block text-xs text-cream/60">
              Extra kills cost {extraCost} SE.
            </span>
          )}
          {mode === "instant" && (
            <span className="mt-1 block text-xs text-cream/60">
              No Justice protect can block this (acted outside role-action).
            </span>
          )}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={confirm}
            disabled={busy}
            className="flex-1 rounded-lg bg-consultation-bg py-2 font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Confirming…" : "Yes, sacrifice"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="flex-1 rounded-lg border border-gold py-2 font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Pick step (multi-select).
  return (
    <div
      className={
        "rounded-xl border border-gold/40 p-5 text-cream " +
        (mode === "instant" ? "bg-consultation-fg/30" : "bg-reflection-fg/30")
      }
    >
      <p className="text-sm uppercase tracking-widest text-gold">Sacrifice</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick the players to die with you
        {mode === "queued" ? " at the end of this phase" : " immediately"}. The
        first is free; each extra costs {EXTRA_COST} SE.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        extra cost: {extraCost}
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {targets.map((p) => {
              const sel = selectedIds.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => toggle(p.id)}
                    className={
                      "flex w-full items-center justify-between rounded-lg border px-4 py-2 text-left transition-opacity hover:opacity-90 " +
                      (sel
                        ? "border-gold bg-gold text-home-bg"
                        : "border-gold bg-cream text-home-bg")
                    }
                  >
                    <span>
                      {p.name}
                      {p.in_prison && (
                        <span className="ml-2 text-xs opacity-60">
                          (in prison)
                        </span>
                      )}
                    </span>
                    {sel && <span className="text-sm font-bold">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => setConfirming(true)}
            disabled={selectedIds.length === 0 || !canAfford}
            className="mt-3 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Sacrifice with {selectedIds.length} player
            {selectedIds.length === 1 ? "" : "s"}
            {extraCost > 0 ? ` (${extraCost} SE)` : ""}
          </button>
          {selectedIds.length > 1 && !canAfford && (
            <p className="mt-2 text-sm text-red-300 italic">
              Not enough Soul Energy for {selectedIds.length - 1} extra kill
              {selectedIds.length - 1 === 1 ? "" : "s"}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
