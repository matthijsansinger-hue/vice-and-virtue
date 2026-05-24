"use client";

import { useState } from "react";
import { instantSacrifice, queueAction } from "@/lib/game";
import type { Room, Player } from "@/lib/types";

// Sacrifice can act in two contexts:
//   - mode="queued": during the role-action phase. The action is queued
//     and resolved at the end of the phase, with Justice protect able to
//     spare either side.
//   - mode="instant": during the consultation phase. The action takes
//     effect immediately, no protect check (protect only resolves during
//     role-action).
//
// In either case, the action is free (cost 0).
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
  const [selected, setSelected] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);

  async function confirm() {
    if (!selected || alreadyActed || busy) return;
    setBusy(true);
    try {
      if (mode === "queued") {
        await queueAction(
          myPlayer.id,
          0,
          myPlayer.soul_energy,
          "sacrifice",
          selected.id
        );
      } else {
        await instantSacrifice(room.id, myPlayer.id, selected.id, players);
      }
    } finally {
      setBusy(false);
    }
  }

  // Queued-mode "already queued" display. In instant mode the actor is
  // already dead by the time this would render, so the consultation
  // screen shows the dead screen instead.
  if (
    mode === "queued" &&
    alreadyActed &&
    myPlayer.pending_action === "sacrifice" &&
    myPlayer.pending_target
  ) {
    const target = players.find((p) => p.id === myPlayer.pending_target);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Sacrifice &mdash; queued
        </p>
        <p className="mt-2">
          You will die together with <strong>{target?.name ?? "?"}</strong> at
          the end of this phase.
        </p>
        <p className="mt-2 text-xs text-home-bg/60">
          Justice protect can spare either of you.
        </p>
      </div>
    );
  }

  // Step 2: confirm.
  if (selected) {
    return (
      <div
        className={
          "rounded-xl border border-gold/40 p-5 text-cream " +
          (mode === "instant"
            ? "bg-consultation-fg/30"
            : "bg-reflection-fg/30")
        }
      >
        <p className="text-sm uppercase tracking-widest text-gold">
          Sacrifice
        </p>
        <p className="mt-2 text-sm text-cream/80">
          You and <strong>{selected.name}</strong> will both die{" "}
          {mode === "queued"
            ? "at the end of this phase"
            : "right now"}
          . This cannot be undone.
          {mode === "instant" && (
            <span className="block mt-1 text-xs text-cream/60">
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
            onClick={() => setSelected(null)}
            disabled={busy}
            className="flex-1 rounded-lg border border-gold py-2 font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Step 1: pick a target.
  return (
    <div
      className={
        "rounded-xl border border-gold/40 p-5 text-cream " +
        (mode === "instant"
          ? "bg-consultation-fg/30"
          : "bg-reflection-fg/30")
      }
    >
      <p className="text-sm uppercase tracking-widest text-gold">Sacrifice</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to die with. Both of you die
        {mode === "queued" ? " at the end of this phase" : " immediately"}.
        Free to use, one-shot.
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {targets.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setSelected(p)}
                className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90"
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
      )}
    </div>
  );
}
