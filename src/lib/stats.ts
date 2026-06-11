// Recording game results when a game ends. Called once by the host as
// the game transitions to the game_over screen. Writes one game_results
// row per account-linked player (guests are skipped), marking a win for
// everyone on the winning camp — alive, dead, or imprisoned alike.

import { supabase } from "./supabase";
import { ROLES } from "./roles";
import { grantMatchRewards } from "./economy";
import { applyRankedResults } from "./ranked";
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
  // first-win-of-the-day Soul Fragment for winners. Idempotent per (user, room)
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

  // Ranked ladder: if this was a ranked room, move each account player's rank.
  // diff = |Vices remaining − Virtues remaining| at game end (the win margin):
  // a dominant win (more of your camp still standing) moves rank more.
  try {
    const { data: roomRow } = await supabase
      .from("rooms")
      .select("is_ranked")
      .eq("id", roomId)
      .maybeSingle();
    if ((roomRow as { is_ranked?: boolean } | null)?.is_ranked && awards.length > 0) {
      const { data: pstates } = await supabase
        .from("players")
        .select("id, dead, in_prison")
        .eq("room_id", roomId);
      const stateById = new Map(
        (pstates ?? []).map((p) => {
          const row = p as { id: string; dead: boolean; in_prison: boolean };
          return [row.id, row] as const;
        })
      );
      let vices = 0;
      let virtues = 0;
      for (const p of revealed) {
        const roleId = p.role as string | null;
        if (!roleId || !ROLES[roleId]) continue;
        const st = stateById.get(p.player_id);
        if (!st || st.dead || st.in_prison) continue;
        if (ROLES[roleId].camp === "vice") vices += 1;
        else virtues += 1;
      }
      const diff = Math.abs(vices - virtues);
      await applyRankedResults(
        roomId,
        awards.map((a) => ({ u: a.u, won: a.won, diff }))
      );
    }
  } catch {
    /* ranked update is non-critical; results are already recorded */
  }
}
