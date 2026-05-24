// Soul Energy scoring for the reflection minigame.

import type { Player } from "./types";

export type RankedPlayer = {
  player: Player;
  rank: number; // 1 = best; each player gets a unique sequential rank
  soulEnergy: number; // Soul Energy earned this round (rounded to a whole number)
};

// Ranks players by their raw minigame score and awards Soul Energy.
//   Soul Energy = 100 * 0.93^(rank-1)   for rank x, capped at rank 20.
// The award depends only on finishing position, not on the player count.
//
// Ties on raw score get sequential ranks (whoever joined the room first
// breaks the tie) so every rank number is unique on the scoreboard.
//
// Players who are imprisoned or dead cannot score and are excluded from
// the ranking.
export function rankPlayers(players: Player[]): RankedPlayer[] {
  const eligible = players.filter((p) => !p.in_prison && !p.dead);

  // Sort by raw score descending. JavaScript's Array.sort is stable, so
  // tied players keep their original (join) order.
  const sorted = [...eligible].sort(
    (a, b) => b.minigame_score - a.minigame_score
  );

  return sorted.map((player, index) => {
    const rank = index + 1;
    // Anyone past place 20 is scored as if they finished 20th.
    const cappedRank = Math.min(rank, 20);
    const soulEnergy = Math.round(100 * Math.pow(0.93, cappedRank - 1));
    return { player, rank, soulEnergy };
  });
}
