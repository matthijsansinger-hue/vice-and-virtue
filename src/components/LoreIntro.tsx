"use client";

import { useEffect, useRef } from "react";
import { heading, CornerFrame } from "@/components/ui/royal";
import { beginLoreEntry, endLoreIntro } from "@/lib/game";
import { playWhoosh } from "@/lib/sound";
import type { Player, Room } from "@/lib/types";

// The abyss flight is a recorded video (canvas was too heavy to render smoothly).
// While the host reads the setting it sits paused on a still frame; when the host
// clicks Continue it plays through ONCE — the flight into the castle, which only
// needs to happen once. STILL_T skips the opening fade-from-black so the paused
// frame shows the void + distant castle, not a black screen.
const STILL_T = 0.4;

export function LoreIntro({
  room,
  myPlayer,
}: {
  room: Room;
  myPlayer: Player | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const advancedRef = useRef(false);
  const whooshedRef = useRef(false);
  const isHost = myPlayer?.is_host ?? false;

  // `entering` is shared state — set by beginLoreEntry (host clicks Continue) and
  // seen by every client via realtime, so the flight starts for everyone at once.
  const endsAtMs = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const entering = endsAtMs !== null;

  // Park the video on a representative still frame.
  function showStill() {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.pause();
      if (v.currentTime < STILL_T) v.currentTime = STILL_T;
    } catch {
      /* metadata not ready yet; onLoadedMetadata will retry */
    }
  }

  // Once metadata is in, either hold the still (reading) or play (already entering).
  function onMeta() {
    if (entering) videoRef.current?.play?.().catch(() => {});
    else showStill();
  }

  // Reading → hold the still; entering → play the flight once (with a whoosh).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    if (entering) {
      v.play?.().catch(() => {});
      if (!whooshedRef.current) {
        whooshedRef.current = true;
        playWhoosh(3000);
      }
    } else {
      whooshedRef.current = false;
      showStill();
    }
  }, [entering]);

  // Host advances the room when the flight finishes (the video's `ended`), once.
  function advance() {
    if (!isHost || advancedRef.current) return;
    advancedRef.current = true;
    endLoreIntro(room.id, room.role_assign_mode).catch(() => {
      advancedRef.current = false;
    });
  }

  // Fallback: advance off the synced phase_ends_at timer too, in case `ended`
  // never fires (decode stall / error), so the room can't get stuck on the lore.
  useEffect(() => {
    if (!isHost || !entering || !endsAtMs) return;
    const delay = Math.max(0, endsAtMs - Date.now()) + 2000;
    const handle = setTimeout(advance, delay);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, entering, endsAtMs, room.id, room.role_assign_mode]);

  function next() {
    if (entering) return;
    beginLoreEntry(room.id);
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#05030a] px-6 py-20 text-cream">
      {/* The abyss flight — paused on a still while reading, plays once on enter. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src="/abyss-flight.mp4"
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={onMeta}
        onEnded={advance}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Light scrim for mood + to keep the card crisp over the bright beats. */}
      <div className="pointer-events-none absolute inset-0 bg-black/30" aria-hidden />

      {/* Lore card — the host reads it, then clicks Continue. Fades away as the
          host enters the castle, leaving the flight to play out underneath. */}
      <div
        className="relative w-full max-w-sm transition-opacity duration-500"
        style={{ opacity: entering ? 0 : 1 }}
      >
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
    </main>
  );
}
