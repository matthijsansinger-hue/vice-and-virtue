// Soul Energy scoring for the reflection minigame.

import type { Player } from "./types";

export type RankedPlayer = {
  player: Player;
  rank: number; // 1 = best; players with an equal score share a rank
  soulEnergy: number; // Soul Energy earned this round (rounded to a whole number)
};

// Ranks players by their raw minigame score and awards Soul Energy.
//   Soul Energy = 100 * 0.93^(rank-1)   for rank x, capped at rank 20.
// The award depends only on finishing position, not on the player count,
// so a given rank is always worth the same amount.
export function rankPlayers(players: Player[]): RankedPlayer[] {
  const sorted = [...players].sort(
    (a, b) => b.minigame_score - a.minigame_score
  );

  const ranked: RankedPlayer[] = [];
  let previousScore: number | null = null;
  let previousRank = 0;

  sorted.forEach((player, index) => {
    // Players with an equal score share a rank.
    const rank =
      previousScore !== null && player.minigame_score === previousScore
        ? previousRank
        : index + 1;
    previousScore = player.minigame_score;
    previousRank = rank;

    // Anyone past place 20 is scored as if they finished 20th.
    const cappedRank = Math.min(rank, 20);
    const soulEnergy = Math.round(100 * Math.pow(0.93, cappedRank - 1));

    ranked.push({ player, rank, soulEnergy });
  });

  return ranked;
}
