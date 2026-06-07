"use client";

import { useEffect, useRef, useState } from "react";
import { setReady, resetRoomReady, endViceVictoryIntro } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { playVictoryMusic } from "@/lib/sound";
import type { Player, Room } from "@/lib/types";

// Dramatic intro shown when the Vices win, BEFORE the regular
// game-over scoreboard. Flow:
//   0.0s – 1.0s: only the ruined-town image is visible (silent beat)
//   1.0s+      : the lore paragraph fades in and the Continue button appears
// A majority pressing Continue → 10s countdown → endViceVictoryIntro flips
// the phase to game_over and everyone lands on the scoreboard together.
export function ViceVictoryIntro({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const isHost = myPlayer?.is_host ?? false;
  const [revealed, setRevealed] = useState(false);
  const stungRef = useRef(false);
  const resetRef = useRef(false);

  // 1-second silent beat before the text + button appear.
  useEffect(() => {
    const handle = setTimeout(() => setRevealed(true), 1000);
    return () => clearTimeout(handle);
  }, []);

  // Somber sting the moment the Vice win screen appears (once).
  useEffect(() => {
    if (stungRef.current) return;
    stungRef.current = true;
    playVictoryMusic("vice");
  }, []);

  // This phase is reached from a SQL resolve_* function that doesn't reset
  // ready, so the host clears it once so majority-continue starts clean.
  useEffect(() => {
    if (!isHost || resetRef.current) return;
    resetRef.current = true;
    void resetRoomReady(room.id);
  }, [isHost, room.id]);

  // Majority press Continue → 10s countdown → host advances to game_over.
  // Scoped to the living (the winners), so ghosted/AFK dead losers can't hold
  // the majority hostage. The dead still see the button; it just doesn't gate.
  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => endViceVictoryIntro(room.id),
  });

  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#3a2618] bg-cover bg-center bg-no-repeat px-6 py-12 text-cream"
      style={{ backgroundImage: "url('/vices-win-bg.png')" }}
    >
      {/* Full-screen dark overlay so the lore text stays legible
          against the busy image, regardless of where the content sits. */}
      <div
        className="pointer-events-none absolute inset-0 bg-black/55"
        aria-hidden
      />

      <div
        className={
          "relative w-full max-w-lg text-center transition-opacity duration-700 " +
          (revealed ? "opacity-100" : "opacity-0")
        }
      >
        <p className="text-sm uppercase tracking-[0.3em] text-consultation-bg">
          The Vices stand triumphant
        </p>

        <div className="mt-5 space-y-4 text-lg leading-relaxed text-cream/95 drop-shadow-md">
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

        {revealed &&
          (myPlayer?.ready ? (
            <p className="mt-8 text-sm text-cream/70">
              You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
              {total})
            </p>
          ) : (
            <button
              onClick={() => myPlayer && setReady(myPlayer.id, true)}
              className="mt-8 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Continue to results ({readyCount}/{total})
            </button>
          ))}
        {revealed && remainingSec !== null && (
          <p className="mt-3 text-sm font-semibold text-gold">
            Most are ready &mdash; continuing in {remainingSec}s
          </p>
        )}
      </div>
    </main>
  );
}
