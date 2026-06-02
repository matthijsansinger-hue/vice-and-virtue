"use client";

import { useEffect } from "react";
import { playClick } from "@/lib/sound";

// Plays a short wooden "tock" on every button / link / role=button /
// summary press, app-wide, via a single document-level listener. The
// sound is synthesized in lib/sound.ts (shared AudioContext) so there's
// no audio file, and the click gesture unlocks audio for later effects
// like the castle-entry whoosh.
export function ClickSound() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, a, [role="button"], summary')) {
        playClick();
      }
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
