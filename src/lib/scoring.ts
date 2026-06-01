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
// Tie-breaker: identical raw scores are ordered by submission time
// (whoever clicked Done / was auto-submitted first ranks higher).
// Players who never submitted are ranked last among any ties.
//
// Players who are imprisoned, dead, or hospitalized cannot score and are
// excluded from the ranking.
export function rankPlayers(players: Player[]): RankedPlayer[] {
  const eligible = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );

  const sorted = [...eligible].sort((a, b) => {
    if (b.minigame_score !== a.minigame_score) {
      return b.minigame_score - a.minigame_score;
    }
    // Tie on raw score: earlier submission ranks higher.
    const aTime = a.minigame_submitted_at
      ? Date.parse(a.minigame_submitted_at)
      : Number.POSITIVE_INFINITY;
    const bTime = b.minigame_submitted_at
      ? Date.parse(b.minigame_submitted_at)
      : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  return sorted.map((player, index) => {
    const rank = index + 1;
    const cappedRank = Math.min(rank, 20);
    // Players with a zero (or negative) raw score get 0 SE this round.
    // computeScore() in Minigame.tsx returns 0 whenever the player
    // had at least one wrong V/V tag — so this enforces "any wrong
    // guess = no Soul Energy this round" at the award step. They
    // still appear on the scoreboard with rank + 0 SE.
    const soulEnergy =
      player.minigame_score <= 0
        ? 0
        : Math.round(100 * Math.pow(0.93, cappedRank - 1));
    return { player, rank, soulEnergy };
  });
}
