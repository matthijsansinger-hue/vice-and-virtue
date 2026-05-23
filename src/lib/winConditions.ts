// Win-condition checks.

import { ROLES } from "./roles";
import type { Player } from "./types";

export type WinningCamp = "vice" | "virtue";

// Returns the winning camp, or null if the game should continue.
//
// Rule (from the design template, section 11.1):
//   - All Virtues imprisoned -> Vices win
//   - All Vices imprisoned   -> Virtues win
// In our MVP a player is "out of play" exactly when in_prison is true
// (we don't have role-based kills yet).
export function checkWinner(players: Player[]): WinningCamp | null {
  const free = players.filter((p) => !p.in_prison);
  const freeVices = free.filter(
    (p) => p.role && ROLES[p.role]?.camp === "vice"
  ).length;
  const freeVirtues = free.filter(
    (p) => p.role && ROLES[p.role]?.camp === "virtue"
  ).length;

  if (freeVices === 0 && freeVirtues > 0) return "virtue";
  if (freeVirtues === 0 && freeVices > 0) return "vice";
  return null;
}
