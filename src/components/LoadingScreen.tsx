"use client";

import { heading } from "@/components/ui/royal";

// The shared loading/waiting visual: the council-chamber scene behind whatever
// we're waiting on. Used while matchmaking searches for a lobby and for the
// ordinary "loading…" states, so waiting always looks like part of the game
// rather than a blank screen.
//
// The art lives at public/loading-bg.webp — the council-chamber scene, resized
// to 1920px and re-encoded from a 6.7 MB PNG down to ~166 KB, because a loading
// screen that takes a while to load is self-defeating.
//
// It's a very wide scene (3840x1240), so it's a COVER background with a dark
// wash rather than an <img>: an img would letterbox or shrink to a strip at
// phone aspect, and the wash keeps the text readable over a busy painting.
// If the file is ever missing, the wash and copy still render.
export function LoadingScreen({
  title = "Loading…",
  children,
  compact = false,
}: {
  title?: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={
        "relative isolate flex w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-gold/30 text-center " +
        (compact ? "min-h-[16rem] p-5" : "min-h-[22rem] p-8")
      }
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(rgba(13,10,6,.72), rgba(13,10,6,.86)), url('/loading-bg.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <p className={`text-lg font-semibold text-gold ${heading}`}>{title}</p>
      {children}
    </div>
  );
}
