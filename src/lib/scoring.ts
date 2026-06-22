// Soul Energy scoring for the Reflection Quiz.

import type { Player } from "./types";

export type RankedPlayer = {
  player: Player;
  rank: number; // 1 = best; tied scores SHARE a rank (standard competition ranking)
  soulEnergy: number; // Soul Energy earned this round (whole number)
};

// Ranks players by their raw Quiz score and awards Soul Energy.
//   Soul Energy = 100 * 0.93^(rank-1)   for rank x, capped at rank 20.
// The award depends only on finishing position, not on the player count.
//
// Speed is NOT a factor: players with the same raw score share the same rank
// (standard competition ranking — e.g. scores 5, 5, 3 → ranks 1, 1, 3), so a
// tie earns the same Soul Energy.
//
// Players who are imprisoned, dead, or hospitalized cannot score and are
// excluded from the ranking.
export function rankPlayers(players: Player[]): RankedPlayer[] {
  const eligible = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );

  const sorted = [...eligible].sort(
    (a, b) => b.minigame_score - a.minigame_score
  );

  return sorted.map((player) => {
    // Standard competition rank: 1 + how many players scored strictly higher.
    // Equal scores therefore get the same rank (and the same Soul Energy).
    const rank =
      sorted.filter((p) => p.minigame_score > player.minigame_score).length + 1;
    const cappedRank = Math.min(rank, 20);
    // computeScore() in Minigame.tsx returns 0 whenever the player had at least
    // one wrong V/V tag, so a zero (or negative) raw score earns 0 SE this round.
    // They still appear on the scoreboard with their rank + 0 SE.
    const soulEnergy =
      player.minigame_score <= 0
        ? 0
        : Math.round(100 * Math.pow(0.93, cappedRank - 1));
    return { player, rank, soulEnergy };
  });
}
