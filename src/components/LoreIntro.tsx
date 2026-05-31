"use client";

import { useEffect, useRef, useState } from "react";
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
  // Fade-to-black overlay: flips to true 3.5s into the entry animation
  // (right when the zoom completes), held for the remaining 0.5s
  // before phase changes to role_reveal at 4s.
  const [blacked, setBlacked] = useState(false);

  // `entering` is shared state — derived from the room's phase_ends_at
  // (which the host set via beginLoreEntry). All clients see it and
  // run their animation in step.
  const endsAtMs = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const entering = endsAtMs !== null;

  // Trigger the black overlay 3.5s into the entry (right as the zoom
  // climaxes). Reset if entering ever flips back off.
  useEffect(() => {
    if (!entering) {
      setBlacked(false);
      return;
    }
    const handle = setTimeout(() => setBlacked(true), 3500);
    return () => clearTimeout(handle);
  }, [entering]);

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
          Transform and filter are set as inline-style STRINGS (not
          via Tailwind utility classes) so the browser sees a clean
          property-value change when `entering` flips, instead of a
          CSS-variable change that v4's scale-* compiles down to —
          which doesn't trigger transitions cleanly. */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/lore-bg.png')",
          // Pivot the zoom on the castle's glowing orange entrance,
          // which sits at roughly (50%, 62%) of the new image.
          transformOrigin: "50% 62%",
          transform: entering ? "scale(8)" : "scale(1)",
          filter: entering ? "blur(12px)" : "blur(0px)",
          // Per-property transition so blur is delayed beyond the
          // zoom start. Both end at t=3500ms (synced with the
          // black-overlay trigger).
          //   transform : delay 1000ms, duration 2500ms (t=1.0s → 3.5s)
          //   filter    : delay 1700ms, duration 1800ms (t=1.7s → 3.5s)
          transition:
            "transform 2500ms cubic-bezier(0.7,0,0.84,0) 1000ms, filter 1800ms cubic-bezier(0.7,0,0.84,0) 1700ms",
        }}
        aria-hidden
      />

      {/* Dark overlay so the cream lore card stays legible over the
          purple sky background. */}
      <div
        className="pointer-events-none absolute inset-0 bg-black/35"
        aria-hidden
      />

      {/* Fade-to-black overlay — flips on at t=3.5s (zoom complete) and
          holds until the room phase advances to role_reveal at t=4s.
          200ms fade-in feels like a quick "lights out / inside" cut. */}
      <div
        className={
          "pointer-events-none absolute inset-0 bg-black transition-opacity duration-200 ease-out " +
          (blacked ? "opacity-100" : "opacity-0")
        }
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
