// Worldwide leaderboard — the players with the most wins. Aggregated by the
// `leaderboard_top_wins` Postgres function (db/040) so it's one cheap query.

import { supabase } from "./supabase";
import { normalizeCharacter, type CharacterConfig } from "./character";

export type LeaderboardEntry = {
  user_id: string;
  username: string;
  appearance: CharacterConfig | null;
  featured_badges: string[];
  name_color: string | null; // equipped name-color tier id (or null)
  banner_color: string | null; // equipped banner-color tier id (or null)
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
    appearance: r.appearance ? normalizeCharacter(r.appearance) : null,
    featured_badges: r.featured_badges ?? [],
    name_color: r.name_color ?? null,
    banner_color: r.banner_color ?? null,
    wins: Number(r.wins), // count() comes back as bigint
  }));
}
