"use client";

// Plays the success-only ability clips that can't fire at commit time, because
// their outcome is decided server-side at the end of the round and only then
// surfaced to the acting player:
//   - Love "turn" / Wrath "corrupt" → the caster's success notice
//     ("…now serves your camp"); the clip is chosen from the caster's role.
//   - Vice Worshipper / Virtue Seeker correct guess → the guesser's success
//     notice ("Your guess was true …", added by migration 095).
//   - Wandering Soul escape → the game ends as a Soul win (soul_victory_intro).
// Animated notice ids are remembered in localStorage so a reload doesn't replay
// them. Mounted in app/room/[code]/page.tsx, inside AnimationProvider.

import { useEffect, useRef } from "react";
import { useAbilityAnimation } from "./AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player, Room } from "@/lib/types";

type Notice = { id: string; text: string };

const SEEN_KEY = "vv_anim_outcome_seen";
const SEEN_CAP = 500;

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_CAP)));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function AbilityOutcomeWatcher({
  room,
  myPlayer,
  notices,
}: {
  room: Room;
  myPlayer: Player | null;
  notices: Notice[];
}) {
  const { play } = useAbilityAnimation();
  const seenRef = useRef<Set<string> | null>(null);
  const soulPlayedRef = useRef(false);
  const role = myPlayer?.role ?? null;

  // Notice-driven success clips (conversion + correct guess).
  useEffect(() => {
    if (seenRef.current === null) seenRef.current = loadSeen();
    const seen = seenRef.current;
    let changed = false;
    for (const n of notices) {
      if (!n?.id || seen.has(n.id)) continue;
      const text = n.text || "";
      let clip: string | null = null;
      if ((role === "love" || role === "wrath") && text.includes("serves your camp")) {
        clip = clipForAbility(role, role === "love" ? "turn" : "corrupt");
      } else if (role === "vice_worshipper" && text.includes("Your guess was true")) {
        clip = clipForAbility("vice_worshipper", "guess");
      } else if (role === "virtue_seeker" && text.includes("Your guess was true")) {
        clip = clipForAbility("virtue_seeker", "guess");
      }
      if (clip) {
        seen.add(n.id);
        changed = true;
        void play(clip);
      }
    }
    if (changed) saveSeen(seen);
  }, [notices, role, play]);

  // Wandering Soul escape success = the game ends as a Soul win.
  useEffect(() => {
    if (role !== "wandering_soul") return;
    if (room.phase === "soul_victory_intro" && !soulPlayedRef.current) {
      soulPlayedRef.current = true;
      void play(clipForAbility("wandering_soul", "escape"));
    }
  }, [room.phase, role, play]);

  return null;
}
