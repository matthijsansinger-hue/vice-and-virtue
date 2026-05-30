"use client";

import { useEffect, useState } from "react";
import { endViceVictoryIntro } from "@/lib/game";
import type { Player, Room } from "@/lib/types";

// Dramatic intro shown when the Vices win, BEFORE the regular
// game-over scoreboard. Flow:
//   0.0s – 1.0s: only the ruined-town image is visible (silent beat)
//   1.0s+      : the lore paragraph fades in and the host's Continue
//                button becomes visible
// Host clicks Continue → endViceVictoryIntro → phase flips to
// game_over and everyone lands on the scoreboard together.
export function ViceVictoryIntro({
  room,
  myPlayer,
}: {
  room: Room;
  myPlayer: Player | null;
}) {
  const isHost = myPlayer?.is_host ?? false;
  const [revealed, setRevealed] = useState(false);
  const [continuing, setContinuing] = useState(false);

  // 1-second silent beat before the text + button appear.
  useEffect(() => {
    const handle = setTimeout(() => setRevealed(true), 1000);
    return () => clearTimeout(handle);
  }, []);

  async function next() {
    if (continuing) return;
    setContinuing(true);
    try {
      await endViceVictoryIntro(room.id);
    } catch {
      setContinuing(false);
    }
  }

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-end overflow-hidden bg-[#3a2618] bg-cover bg-center bg-no-repeat px-6 pb-12 pt-20 text-cream"
      style={{ backgroundImage: "url('/vices-win-bg.png')" }}
    >
      {/* Bottom-anchored dark overlay so the lore text is legible
          against the busy image. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/55 to-transparent"
        aria-hidden
      />

      <div
        className={
          "relative w-full max-w-md text-center transition-opacity duration-700 " +
          (revealed ? "opacity-100" : "opacity-0")
        }
      >
        <p className="text-xs uppercase tracking-[0.3em] text-consultation-bg">
          The Vices stand triumphant
        </p>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-cream/95 drop-shadow-md">
          <p>The room falls silent. One by one, every spark of hope is smothered.</p>
          <p>
            The Vices stand triumphant, their shadows stretching across the
            remnants of what once could have been unity.
          </p>
          <p>
            Wrath&rsquo;s belief is proven true: mankind cannot rise above its
            own chaos.
          </p>
        </div>

        {isHost ? (
          <button
            onClick={next}
            disabled={continuing}
            className="mt-8 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {continuing ? "Continuing…" : "Continue to results"}
          </button>
        ) : (
          <p className="mt-8 text-sm text-cream/60">
            Waiting for the host to continue&hellip;
          </p>
        )}
      </div>
    </main>
  );
}
