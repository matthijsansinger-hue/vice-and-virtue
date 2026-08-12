// Win-condition checks.

import { ROLES } from "./roles";
import type { Player } from "./types";

export type WinningCamp = "vice" | "virtue";

// A player is "out of play" if they're imprisoned or dead.
function isOut(p: Player): boolean {
  return p.in_prison || p.dead;
}

// Returns the winning camp, or null if the game should continue.
//
// Rules:
//   - All Virtues imprisoned/dead -> Vices win
//   - All Vices imprisoned/dead   -> Virtues win
//
// (The old "Murder + 1 other active player -> instant Vice win" endgame was
// removed — with the store potions a lone Virtue still has a chance, so the
// game plays on until a camp is fully out.)
//
// Neutral anomaly roles (the Wandering Soul, camp "neutral") are counted for
// NEITHER camp, so the Soul never blocks a Vice/Virtue victory. The Soul's own
// two win paths are resolved server-side, not here:
//   - the escape guess            -> resolve_soul_escape (migration 094)
//   - last one left in the castle -> resolve_soul_last_standing (migration 108)
// The second one is exactly the case this function returns null for: both camps
// at 0 active players reads as "play on" here, and the Soul RPC ends it.
export function checkWinner(players: Player[]): WinningCamp | null {
  const active = players.filter((p) => !isOut(p));

  const activeVices = active.filter(
    (p) => p.role && ROLES[p.role]?.camp === "vice"
  ).length;
  const activeVirtues = active.filter(
    (p) => p.role && ROLES[p.role]?.camp === "virtue"
  ).length;

  if (activeVices === 0 && activeVirtues > 0) return "virtue";
  if (activeVirtues === 0 && activeVices > 0) return "vice";
  return null;
}
