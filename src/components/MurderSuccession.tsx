"use client";

import { useState } from "react";
import { ROLES } from "@/lib/roles";
import { chooseMurderSuccessor } from "@/lib/game";
import { Centered } from "./Centered";
import type { Room, Player } from "@/lib/types";

// Shown when Murder is about to die. The dying Murder picks a Vice
// successor; everyone else sees a neutral "resolving" screen so we
// don't reveal that Murder was killed.
export function MurderSuccession({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [selected, setSelected] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);

  const dyingId = room.pending_murder_death;
  const isDyingMurder = !!myPlayer && myPlayer.id === dyingId;

  // Eligible successors: active Vices, not the dying Murder.
  const candidates = players.filter(
    (p) =>
      p.id !== dyingId &&
      p.role &&
      ROLES[p.role]?.camp === "vice" &&
      !p.dead &&
      !p.in_prison &&
      !p.in_hospital
  );

  async function confirm() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await chooseMurderSuccessor(room.id, selected.id);
    } catch {
      setBusy(false);
    }
  }

  // Non-dying players see a neutral resolving screen.
  if (!isDyingMurder) {
    return (
      <Centered className="reflection-stars-bg text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Day {room.day}
        </p>
        <p className="mt-2 text-xl font-semibold">Resolving&hellip;</p>
        <p className="mt-2 text-cream/70">
          Waiting for an action to complete.
        </p>
      </Centered>
    );
  }

  // Confirm step.
  if (selected) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center reflection-stars-bg px-6 text-center text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Murder &mdash; succession
        </p>
        <p className="mt-4 max-w-sm text-2xl font-semibold">
          Hand the role of Murder to <span>{selected.name}</span>?
        </p>
        <p className="mt-2 max-w-sm text-sm text-cream/70">
          You die after confirming. They become the new Murder.
        </p>
        <div className="mt-6 flex w-full max-w-xs gap-2">
          <button
            onClick={confirm}
            disabled={busy}
            className="flex-1 rounded-lg bg-consultation-bg py-2 font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Confirming…" : "Confirm"}
          </button>
          <button
            onClick={() => setSelected(null)}
            disabled={busy}
            className="flex-1 rounded-lg border border-gold py-2 font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
          >
            Back
          </button>
        </div>
      </main>
    );
  }

  // Picker.
  return (
    <main className="flex min-h-screen flex-col items-center reflection-stars-bg px-4 py-8 text-cream">
      <div className="w-full max-w-md">
        <p className="text-center text-xs uppercase tracking-widest text-gold">
          Murder &mdash; succession
        </p>
        <p className="mt-2 text-center text-2xl font-semibold">
          You&rsquo;ve been killed
        </p>
        <p className="mt-2 text-center text-sm text-cream/70">
          Pick a Vice to take over the role of Murder before you die.
        </p>

        <ul className="mt-6 flex flex-col gap-2">
          {candidates.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setSelected(p)}
                className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90"
              >
                {p.name}
              </button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="text-center text-sm text-cream/60 italic">
              No eligible Vice successors.
            </li>
          )}
        </ul>
      </div>
    </main>
  );
}
