"use client";

import { useEffect, useState } from "react";
import { endVirtueVictoryIntro } from "@/lib/game";
import type { Player, Room } from "@/lib/types";

// Dramatic intro shown when the Virtues win, BEFORE the regular
// game-over scoreboard. Flow:
//   0.0s – 1.0s: only the harmonious-city image is visible (silent beat)
//   1.0s+      : the lore paragraph fades in and the host's Continue
//                button becomes visible
// Host clicks Continue → endVirtueVictoryIntro → phase flips to
// game_over and everyone lands on the scoreboard together.
export function VirtueVictoryIntro({
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
      await endVirtueVictoryIntro(room.id);
    } catch {
      setContinuing(false);
    }
  }

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#2a3f5e] bg-cover bg-center bg-no-repeat px-6 py-12 text-cream"
      style={{ backgroundImage: "url('/virtues-win-bg.png')" }}
    >
      {/* Full-screen dark overlay so the lore text stays legible
          against the bright sunny image, regardless of where the
          content sits. */}
      <div
        className="pointer-events-none absolute inset-0 bg-black/55"
        aria-hidden
      />

      <div
        className={
          "relative w-full max-w-md text-center transition-opacity duration-700 " +
          (revealed ? "opacity-100" : "opacity-0")
        }
      >
        <p className="text-sm uppercase tracking-[0.3em] text-consultation-fg">
          Unity prevails
        </p>

        <div className="mt-5 space-y-4 text-lg leading-relaxed text-cream/95 drop-shadow-md">
          <p>The Vices collapse, and dawn breaks within the chamber.</p>
          <p>Harmony rekindles the teachings long forgotten.</p>
          <p>Here, humanity rose above anger and fear.</p>
          <p>Wrath is proven wrong &mdash; unity prevails.</p>
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
