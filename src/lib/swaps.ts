// Helpers for Envy's identity swap (one day at a time).

import type { Player, Room } from "./types";

// Returns the name that should be displayed for this player, taking the
// active Envy swap into account. If the player isn't part of the swap,
// returns their real name.
//
// Note: this is the ONLY function needed to implement the swap deception.
// Because UIs render the swapped name on the icon of the OTHER player,
// when a voter clicks "Bob" (label on Alice's icon) the selected id is
// Alice's real id - which is exactly what should be stored. The "votes
// for either hit the other" rule emerges automatically from the visual
// swap; no separate vote-routing function is required.
export function displayedName(
  player: Player,
  room: Room,
  players: Player[]
): string {
  const { envy_swap_a, envy_swap_b } = room;
  if (!envy_swap_a || !envy_swap_b) return player.name;

  if (player.id === envy_swap_a) {
    return players.find((p) => p.id === envy_swap_b)?.name ?? player.name;
  }
  if (player.id === envy_swap_b) {
    return players.find((p) => p.id === envy_swap_a)?.name ?? player.name;
  }
  return player.name;
}
