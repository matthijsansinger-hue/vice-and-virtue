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
