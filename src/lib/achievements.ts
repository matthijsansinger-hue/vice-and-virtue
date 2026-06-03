// Reading/writing one-off achievement keys, and assembling the full set
// of earned badge ids for a user (badges = derived stats + achievement
// keys + account age).

import { supabase } from "./supabase";
import { BADGES, computeEarnedBadgeIds, type BadgeDef } from "./badges";
import type { UserStats } from "./stats";
import type { GameResult } from "./types";

// Roll a set of game_results rows up into the stats shape badges need.
function rollupStats(rows: GameResult[]): UserStats {
  const totalGames = rows.length;
  const totalWins = rows.filter((r) => r.won).length;
  const byRole = new Map<string, { played: number; won: number }>();
  for (const r of rows) {
    if (!r.role) continue;
    const e = byRole.get(r.role) ?? { played: 0, won: 0 };
    e.played += 1;
    if (r.won) e.won += 1;
    byRole.set(r.role, e);
  }
  return {
    totalGames,
    totalWins,
    winRate: totalGames ? totalWins / totalGames : 0,
    perRole: [...byRole.entries()].map(([role, v]) => ({ role, ...v })),
    recent: rows.slice(0, 5),
  };
}

// Achievement keys a user has recorded.
export async function getAchievementKeys(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_achievements")
    .select("key")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.key as string);
}

// Host-side: grant achievement keys to any players (used when resolving
// in-game events). Goes through a SECURITY DEFINER function since normal
// RLS only lets a user write their own. Best-effort — never throws so it
// can't block game resolution.
export async function grantAchievements(
  awards: { userId: string; key: string }[]
): Promise<void> {
  if (awards.length === 0) return;
  const { error } = await supabase.rpc("grant_achievements", {
    p_awards: awards.map((a) => ({ u: a.userId, k: a.key })),
  });
  if (error) console.error("grant_achievements failed", error);
}

// Record an achievement key for the current user (idempotent). No-op if
// signed out.
export async function awardAchievement(key: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("user_achievements")
    .upsert({ user_id: user.id, key }, { onConflict: "user_id,key", ignoreDuplicates: true });
}

// How many accounts were created before this one (for the "first 95"
// Founder badge).
export async function getAccountOlderCount(
  createdAt: string
): Promise<number> {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .lt("created_at", createdAt);
  if (error) throw error;
  return count ?? 0;
}

// Does this user have at least one accepted friendship? (RLS lets you
// read only your own friendships, so this is meaningful for the logged-in
// user.)
export async function hasAnyAcceptedFriend(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("friendships")
    .select("id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

// Badges newly earned because of one specific game (this room). Diffs
// the current earned set against what it would be WITHOUT this game:
// excludes this room's game_results, and excludes achievement keys
// recorded after the room was created (i.e. earned during this game).
// Returns [] for guests or on error.
export async function getNewlyEarnedBadges(
  userId: string,
  accountCreatedAt: string,
  roomId: string,
  roomCreatedAt: string
): Promise<BadgeDef[]> {
  const [resultsRes, achievementsRes, olderCount] = await Promise.all([
    supabase.from("game_results").select("*").eq("user_id", userId),
    supabase
      .from("user_achievements")
      .select("key, created_at")
      .eq("user_id", userId),
    getAccountOlderCount(accountCreatedAt),
  ]);
  if (resultsRes.error) throw resultsRes.error;
  if (achievementsRes.error) throw achievementsRes.error;

  const allRows = (resultsRes.data ?? []) as GameResult[];
  const beforeRows = allRows.filter((r) => r.room_id !== roomId);
  const allKeys = new Set((achievementsRes.data ?? []).map((a) => a.key));
  const beforeKeys = new Set(
    (achievementsRes.data ?? [])
      .filter((a) => a.created_at < roomCreatedAt)
      .map((a) => a.key)
  );

  const current = computeEarnedBadgeIds({
    stats: rollupStats(allRows),
    achievementKeys: allKeys,
    accountOlderCount: olderCount,
  });
  const before = computeEarnedBadgeIds({
    stats: rollupStats(beforeRows),
    achievementKeys: beforeKeys,
    accountOlderCount: olderCount,
  });

  return BADGES.filter((b) => current.has(b.id) && !before.has(b.id));
}

// Assemble the earned-badge set for a user.
export async function getEarnedBadges(
  userId: string,
  createdAt: string,
  stats: UserStats
): Promise<Set<string>> {
  const [keys, olderCount] = await Promise.all([
    getAchievementKeys(userId),
    getAccountOlderCount(createdAt),
  ]);
  return computeEarnedBadgeIds({
    stats,
    achievementKeys: new Set(keys),
    accountOlderCount: olderCount,
  });
}
