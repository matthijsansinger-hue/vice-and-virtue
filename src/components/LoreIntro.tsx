"use client";

import { useState } from "react";
import { endLoreIntro } from "@/lib/game";
import type { Player, Room } from "@/lib/types";

// Lore intro card shown right before role-reveal. Host-only Continue.
export function LoreIntro({
  room,
  myPlayer,
}: {
  room: Room;
  myPlayer: Player | null;
}) {
  const [continuing, setContinuing] = useState(false);
  const isHost = myPlayer?.is_host ?? false;

  async function next() {
    setContinuing(true);
    try {
      await endLoreIntro(room.id);
    } catch {
      setContinuing(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-home-bg px-6 py-20 text-cream">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border-2 border-gold bg-cream p-6 text-center text-home-bg">
          <p className="text-xs uppercase tracking-widest text-home-bg/50">
            The setting
          </p>
          <div className="mt-4 space-y-3 text-sm leading-relaxed">
            <p>The world is gone&mdash;destroyed by vice.</p>
            <p>
              Now, <strong>King Wrath</strong>, the last survivor, has
              built a castle in the void between life and death.
            </p>
            <p>
              Here, he gathers the souls of the past&mdash;both Vices
              and Virtues.
            </p>
            <p>
              He wants to see what the world might have looked like if
              someone else had won.
            </p>
            <p className="text-base font-semibold">
              Deceive. Persuade. Survive.
            </p>
            <p className="text-lg font-semibold text-home-bg">
              The winner will shape the new world.
            </p>
          </div>
        </div>

        {isHost ? (
          <button
            onClick={next}
            disabled={continuing}
            className="mt-6 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {continuing ? "Continuing…" : "Continue"}
          </button>
        ) : (
          <p className="mt-6 text-center text-sm text-cream/60">
            Waiting for the host to continue&hellip;
          </p>
        )}
      </div>
    </main>
  );
}
