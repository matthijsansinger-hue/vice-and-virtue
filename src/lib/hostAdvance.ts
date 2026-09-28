// Host-side phase advance with automatic retry.
//
// The host's browser drives every phase change, and each screen used a one-shot
// guard (`advancedRef.current = true; endX(room.id)`) so the advance fired once.
// If that one call failed — a request timing out under load, a Wi-Fi blip, the
// host's phone locking mid-transition — the guard stayed set and the room was
// stuck for EVERYONE: all players ready, timer expired, nothing happening. That
// is what froze the 2026-09-26 playtest rooms.
//
// fireHostAdvance keeps the one-shot guard (so the advance doesn't spam on
// every render tick) but re-arms it if, a few seconds after the attempt
// settles, the SERVER still shows the room in the same phase + day. The caller's
// effect then fires the advance again on its next tick. The fresh server read
// avoids retrying off a stale local view; the server is the backstop — since
// migration 120 the resolve_* RPCs no-op outside their own phase and
// apply_minigame_awards pays once per day, so even a duplicate call is harmless.

import type { MutableRefObject } from "react";
import { supabase } from "./supabase";

const RETRY_AFTER_MS = 6000;

export function fireHostAdvance(opts: {
  ref: MutableRefObject<boolean>;
  roomId: string;
  phase: string;
  day: number;
  run: () => unknown;
}): void {
  const { ref, roomId, phase, day, run } = opts;
  ref.current = true;

  Promise.resolve()
    .then(run)
    .catch(() => {
      // fall through to the stuck-check below
    })
    .finally(() => {
      setTimeout(check, RETRY_AFTER_MS);
    });

  // Only re-arm on a CONFIRMED "still in this phase". If the check itself
  // fails we can't tell whether the advance landed, so check again later
  // rather than risk re-running a resolution.
  async function check(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from("rooms")
        .select("phase, day")
        .eq("id", roomId)
        .maybeSingle();
      if (error) {
        setTimeout(check, RETRY_AFTER_MS);
        return;
      }
      const row = data as { phase: string; day: number } | null;
      if (row && row.phase === phase && row.day === day) {
        ref.current = false; // still stuck on this phase → re-arm
      }
    } catch {
      setTimeout(check, RETRY_AFTER_MS);
    }
  }
}
