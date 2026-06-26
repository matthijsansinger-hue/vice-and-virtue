"use client";

import { useEffect, useRef, useState } from "react";
import { heading, CornerFrame } from "@/components/ui/royal";
import { beginLoreEntry, endLoreIntro } from "@/lib/game";
import { playWhoosh } from "@/lib/sound";
import { CanvasClip } from "@/components/animations/CanvasClip";
import { getClip } from "@/lib/animations/registry";
import type { Player, Room } from "@/lib/types";

// Lore intro card shown right before role-reveal. The host reads the setting and
// clicks Continue; that calls beginLoreEntry, which sets a short timer on the
// room. Every client sees the timer via realtime and plays the "abyss flight"
// cutscene in sync (replacing the old castle-zoom) — a flight through the void
// into the castle gate that ends on black. The host's client schedules
// endLoreIntro for when the timer expires, flipping the room to the next phase
// under the blackout so everyone lands together.
export function LoreIntro({
  room,
  myPlayer,
}: {
  room: Room;
  myPlayer: Player | null;
}) {
  const advancedRef = useRef(false);
  const whooshedRef = useRef(false);
  const isHost = myPlayer?.is_host ?? false;

  // Preload the castle backdrop so it doesn't pop in on slow connections.
  const [bgLoaded, setBgLoaded] = useState(false);
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setBgLoaded(true);
    img.src = "/lore-bg.png";
    if (img.complete) setBgLoaded(true);
    return () => {
      img.onload = null;
    };
  }, []);

  // `entering` is shared state — derived from the room's phase_ends_at (set by
  // beginLoreEntry when the host clicks Continue). All clients see it and play
  // the cutscene in step.
  const endsAtMs = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const entering = endsAtMs !== null;

  const abyss = getClip("abyss_flight");

  // A rushing whoosh in step with the abyss flight.
  useEffect(() => {
    if (!entering) {
      whooshedRef.current = false;
      return;
    }
    if (whooshedRef.current) return;
    whooshedRef.current = true;
    playWhoosh(3000);
  }, [entering]);

  // Host-only: flip the room to the next phase when the timer expires (the
  // cutscene has played and faded to black). Anchored to the absolute
  // phase_ends_at so it stays in sync regardless of realtime jitter.
  useEffect(() => {
    if (!isHost || !entering || !endsAtMs || advancedRef.current) return;
    const delay = Math.max(0, endsAtMs - Date.now());
    const handle = setTimeout(() => {
      advancedRef.current = true;
      endLoreIntro(room.id, room.role_assign_mode).catch(() => {
        advancedRef.current = false;
      });
    }, delay);
    return () => clearTimeout(handle);
  }, [isHost, entering, endsAtMs, room.id, room.role_assign_mode]);

  function next() {
    if (entering) return;
    beginLoreEntry(room.id);
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#1c1740] px-6 py-20 text-cream">
      {/* Static castle backdrop while reading the setting. */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-700 ease-out"
        style={{
          backgroundImage: "url('/lore-bg.png')",
          opacity: bgLoaded ? 1 : 0,
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-black/35" aria-hidden />

      {/* Lore card — the host reads it, then clicks Continue to begin. */}
      <div className="relative w-full max-w-sm">
        <div
          className="relative overflow-hidden rounded-2xl border-2 border-gold p-6 text-center text-home-bg shadow-2xl"
          style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
        >
          <CornerFrame colorClass="border-home-bg/30" />
          <p className={`relative text-xs uppercase tracking-[0.3em] text-home-bg/50 ${heading}`}>
            The setting
          </p>
          <div className="relative mt-4 space-y-3 text-sm leading-relaxed">
            <p>The world is gone&mdash;destroyed by vice.</p>
            <p>
              Now, <strong>King Wrath</strong>, the last survivor, has built a
              castle in the void between life and death.
            </p>
            <p>
              Here, he gathers the souls of the past&mdash;both Vices and
              Virtues.
            </p>
            <p>
              He wants to see what the world might have looked like if someone
              else had won.
            </p>
            <p className={`text-base font-semibold ${heading}`}>
              Deceive. Persuade. Survive.
            </p>
            <p className={`text-lg font-bold text-home-bg ${heading}`}>
              The winner will shape the new world.
            </p>
          </div>
        </div>

        {isHost ? (
          <button
            onClick={next}
            disabled={entering}
            className={`mt-6 w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 ${heading}`}
          >
            {entering ? "Entering…" : "Continue"}
          </button>
        ) : (
          <p className="mt-6 text-center text-sm text-cream/60">
            Waiting for the host to continue&hellip;
          </p>
        )}
      </div>

      {/* The abyss-flight cutscene takes over once the host begins, for everyone
          (synced via phase_ends_at). Full-bleed; not skippable — the host's
          timer drives the advance, which lands under the cutscene's final black. */}
      {entering && abyss && (
        <CanvasClip clip={abyss} skippable={false} fadeOut={false} onDone={() => {}} />
      )}
    </main>
  );
}
