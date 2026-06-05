// Worldwide leaderboard — the players with the most wins. Aggregated by the
// `leaderboard_top_wins` Postgres function (db/040) so it's one cheap query.

import { supabase } from "./supabase";

export type LeaderboardEntry = {
  user_id: string;
  username: string;
  avatar_url: string | null;
  featured_badges: string[];
  wins: number;
};

export async function getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc("leaderboard_top_wins", {
    p_limit: limit,
  });
  if (error) throw error;
  return ((data as LeaderboardEntry[] | null) ?? []).map((r) => ({
    user_id: r.user_id,
    username: r.username,
    avatar_url: r.avatar_url,
    featured_badges: r.featured_badges ?? [],
    wins: Number(r.wins), // count() comes back as bigint
  }));
}
