"use client";

// Plays a phase's transition stinger once, for everyone, when the room enters a
// mapped phase. Guarded by `phase:day` so realtime re-renders / safety-net
// re-pulls don't replay it, and the phase the player mounts into is skipped (so
// a reload mid-phase doesn't replay the stinger). Renders nothing itself — it
// drives the shared AnimationProvider overlay.

import { useEffect, useRef } from "react";
import { useAbilityAnimation } from "./AnimationProvider";
import { STINGER_BY_PHASE } from "@/lib/animations/abilityClips";
import type { Room } from "@/lib/types";

export function PhaseTransition({ room }: { room: Room }) {
  const { play } = useAbilityAnimation();
  const seenRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${room.phase}:${room.day}`;
    // Skip the phase we mounted into (don't replay on reload).
    if (seenRef.current === null) {
      seenRef.current = key;
      return;
    }
    if (seenRef.current === key) return;
    seenRef.current = key;
    const stinger = STINGER_BY_PHASE[room.phase];
    if (stinger) void play(stinger);
  }, [room.phase, room.day, play]);

  return null;
}
