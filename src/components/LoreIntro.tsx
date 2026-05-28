"use client";

import { useEffect, useRef } from "react";
import { beginLoreEntry, endLoreIntro } from "@/lib/game";
import type { Player, Room } from "@/lib/types";

// Lore intro card shown right before role-reveal.
// When the host clicks Continue we DON'T immediately advance the
// room. Instead the host calls beginLoreEntry, which sets a 1-second
// timer on the room. Every client (host + all other players) sees
// that timer via realtime and runs the same "zoom into the castle"
// animation in sync. The host's client then schedules endLoreIntro
// for when the timer expires, which finally flips the room to
// role_reveal so everyone lands on their card together.
export function LoreIntro({
  room,
  myPlayer,
}: {
  room: Room;
  myPlayer: Player | null;
}) {
  const advancedRef = useRef(false);
  const isHost = myPlayer?.is_host ?? false;

  // `entering` is shared state — derived from the room's phase_ends_at
  // (which the host set via beginLoreEntry). All clients see it and
  // run their animation in step.
  const endsAtMs = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const entering = endsAtMs !== null;

  // Host-only: schedule the actual phase advance for when the timer
  // expires. Using `endsAtMs - Date.now()` (instead of a fixed 1000ms
  // delay) keeps things synced even if the host's click arrived in the
  // DB slightly later than expected.
  useEffect(() => {
    if (!isHost || !entering || !endsAtMs) return;
    if (advancedRef.current) return;
    const delay = Math.max(0, endsAtMs - Date.now());
    const handle = setTimeout(() => {
      advancedRef.current = true;
      endLoreIntro(room.id).catch(() => {
        advancedRef.current = false;
      });
    }, delay);
    return () => clearTimeout(handle);
  }, [isHost, entering, endsAtMs, room.id]);

  function next() {
    if (entering) return;
    beginLoreEntry(room.id);
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#1c1740] px-6 py-20 text-cream">
      {/* Background image layer — separated from the content so we can
          transform it independently during the zoom-in animation.
          The transition has a 1-second delay so the lore card has
          time to fade out (~0.5s) followed by a ~0.5s pure-castle
          pause before the 2-second zoom kicks in. */}
      <div
        className={
          "absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform ease-in " +
          (entering
            ? "scale-[5] duration-[2000ms] delay-[1000ms]"
            : "scale-100 duration-0")
        }
        style={{
          backgroundImage: "url('/lore-bg.png')",
          // Pivot the zoom on the castle's main entrance (just below
          // the image's vertical centre).
          transformOrigin: "50% 55%",
        }}
        aria-hidden
      />

      {/* Dark overlay so the cream lore card stays legible over the
          purple sky background. */}
      <div
        className="pointer-events-none absolute inset-0 bg-black/35"
        aria-hidden
      />

      {/* Content fades out as the zoom starts. */}
      <div
        className={
          "relative w-full max-w-sm transition-opacity duration-500 " +
          (entering ? "opacity-0" : "opacity-100")
        }
      >
        <div className="rounded-2xl border-2 border-gold bg-cream p-6 text-center text-home-bg shadow-2xl">
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
            disabled={entering}
            className="mt-6 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {entering ? "Entering…" : "Continue"}
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
