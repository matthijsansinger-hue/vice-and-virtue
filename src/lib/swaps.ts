// Helpers for Envy's identity swap (one day at a time) and
// duplicate-name disambiguation.

import type { Player, Room } from "./types";

// Returns the name to display for a player, accounting for two things:
//   1. Duplicate names: if multiple players share the same name, prefix
//      each with "1. ", "2. ", etc, ordered by join time.
//   2. Envy's identity swap: if the player is one of the swap pair,
//      show the OTHER side's (already-deduplicated) name.
//
// Vote routing works automatically from the visual swap — clicking
// "Bob" (label on Alice's icon) stores Alice's real id, which is the
// intended deceived outcome.
export function displayedName(
  player: Player,
  room: Room,
  players: Player[]
): string {
  const { envy_swap_a, envy_swap_b } = room;

  // If swapped, resolve to the OTHER player and use their dedup name.
  if (envy_swap_a && envy_swap_b) {
    if (player.id === envy_swap_a) {
      const other = players.find((p) => p.id === envy_swap_b);
      if (other) return deduplicatedName(other, players);
    } else if (player.id === envy_swap_b) {
      const other = players.find((p) => p.id === envy_swap_a);
      if (other) return deduplicatedName(other, players);
    }
  }

  return deduplicatedName(player, players);
}

// If multiple players share a name, prefix with "1. ", "2. ", etc by
// join order. Solo names are returned unchanged.
function deduplicatedName(player: Player, players: Player[]): string {
  const sameName = players
    .filter((p) => p.name === player.name)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (sameName.length <= 1) return player.name;
  const idx = sameName.findIndex((p) => p.id === player.id);
  return `${idx + 1}. ${player.name}`;
}
