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
// Rule (from the design template, section 11.1):
//   - All Virtues imprisoned/dead -> Vices win
//   - All Vices imprisoned/dead   -> Virtues win
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
