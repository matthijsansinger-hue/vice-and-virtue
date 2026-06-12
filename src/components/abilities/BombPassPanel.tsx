"use client";

import { useState } from "react";
import { passBomb } from "@/lib/game";
import type { Player } from "@/lib/types";

// Shown to ANY player (whatever their role) who is carrying a Fanaticism bomb
// they must pass this reflection. They pick another active player to hand it to;
// if they don't, it auto-passes at random when the reflection resolves. They're
// never told who planted it. Rendered above the player's own role ability.
export function BombPassPanel({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [chosen, setChosen] = useState<string | null>(
    myPlayer.bomb_pass_to ?? null
  );
  const [busy, setBusy] = useState(false);

  const targets = players.filter(
    (p) => !p.dead && !p.in_prison && !p.in_hospital && p.id !== myPlayer.id
  );

  async function pass(target: Player) {
    if (busy) return;
    setBusy(true);
    const prev = chosen;
    setChosen(target.id); // optimistic
    try {
      const ok = await passBomb(myPlayer.id, target.id);
      if (!ok) setChosen(prev);
    } finally {
      setBusy(false);
    }
  }

  const chosenName = chosen
    ? players.find((p) => p.id === chosen)?.name ?? null
    : null;

  return (
    <div
      className="urgent-pulse mb-4 rounded-xl border-2 border-[#b3445c]/70 p-5 text-cream"
      style={{
        background:
          "linear-gradient(165deg, rgba(128,0,32,.55) 0%, rgba(24,6,10,.94) 70%)",
      }}
    >
      <p className="text-sm font-semibold uppercase tracking-widest text-[#e6889a]">
        You&rsquo;re holding a bomb
      </p>
      <p className="mt-2 text-sm text-cream/85">
        Someone slipped it to you. Pass it to another player before the
        reflection ends &mdash; if you don&rsquo;t, it&rsquo;s handed off at
        random. Whoever holds it when it detonates dies.
      </p>
      {chosenName && (
        <p className="mt-2 text-sm font-medium text-[#f3c0cb]">
          Passing to {chosenName}. You can still change your mind.
        </p>
      )}
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {targets.map((p) => {
          const isChosen = p.id === chosen;
          return (
            <li key={p.id}>
              <button
                onClick={() => pass(p)}
                disabled={busy}
                className={
                  "w-full rounded-lg px-3 py-2 text-left text-sm transition-opacity disabled:opacity-50 " +
                  (isChosen
                    ? "border-2 border-[#f3c0cb] bg-[#f3c0cb]/20 font-semibold text-cream"
                    : "border border-[#b3445c]/60 bg-black/20 text-cream/90 hover:bg-black/30")
                }
              >
                {p.name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
