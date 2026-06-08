// Recording game results when a game ends. Called once by the host as
// the game transitions to the game_over screen. Writes one game_results
// row per account-linked player (guests are skipped), marking a win for
// everyone on the winning camp — alive, dead, or imprisoned alike.

import { supabase } from "./supabase";
import { ROLES } from "./roles";
import { grantMatchRewards } from "./economy";
import type { WinningCamp } from "./winConditions";
import type { GameResult } from "./types";

// Aggregated lifetime stats for one account, computed from game_results.
export type UserStats = {
  totalGames: number;
  totalWins: number;
  winRate: number; // 0..1 (0 when no games yet)
  perRole: { role: string; played: number; won: number }[]; // sorted, most-played first
  recent: GameResult[]; // most recent games first (capped by the caller's slice)
};

// Reads every game_results row for a user (newest first) and rolls it up
// into totals, per-role wins, and a recent-games list.
export async function getUserStats(userId: string): Promise<UserStats> {
  const { data, error } = await supabase
    .from("game_results")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const results = (data ?? []) as GameResult[];
  const totalGames = results.length;
  const totalWins = results.filter((r) => r.won).length;
  const winRate = totalGames ? totalWins / totalGames : 0;

  const byRole = new Map<string, { played: number; won: number }>();
  for (const r of results) {
    if (!r.role) continue;
    const entry = byRole.get(r.role) ?? { played: 0, won: 0 };
    entry.played += 1;
    if (r.won) entry.won += 1;
    byRole.set(r.role, entry);
  }
  const perRole = [...byRole.entries()]
    .map(([role, v]) => ({ role, ...v }))
    .sort((a, b) => b.played - a.played);

  return {
    totalGames,
    totalWins,
    winRate,
    perRole,
    recent: results.slice(0, 5),
  };
}

export async function recordGameResults(
  roomId: string,
  winner: WinningCamp
): Promise<void> {
  // Roles come from the server (only revealed once the game has ended).
  const { data, error } = await supabase.rpc("reveal_all_roles", {
    p_room_id: roomId,
  });
  if (error) throw error;
  const revealed = (data ?? []) as {
    player_id: string;
    user_id: string | null;
    role: string | null;
  }[];

  const rows = revealed
    .filter((p) => p.user_id && p.role && ROLES[p.role as string])
    .map((p) => {
      const camp = ROLES[p.role as string].camp;
      return {
        user_id: p.user_id as string,
        room_id: roomId,
        role: p.role as string,
        camp,
        won: camp === winner,
      };
    });

  // Idempotent: clear any prior results for this room before inserting,
  // so a re-trigger of game_over can't double-count.
  await supabase.from("game_results").delete().eq("room_id", roomId);

  if (rows.length > 0) {
    const { error: insertError } = await supabase
      .from("game_results")
      .insert(rows);
    if (insertError) throw insertError;
  }

  // Account meta-progression: per-match XP for every account player + a
  // first-win-of-the-day Soul Shard for winners. Idempotent per (user, room)
  // server-side. Non-critical — never let a reward hiccup block game-over
  // recording. Dedup to one award per account.
  const seen = new Set<string>();
  const awards: { u: string; won: boolean }[] = [];
  for (const r of rows) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    awards.push({ u: r.user_id, won: r.won });
  }
  await grantMatchRewards(roomId, awards).catch(() => {
    /* rewards are non-critical; results are already recorded */
  });
}
