// Ranked ladder: five tiers (Earthen < Verdant < Primal < Noble < Divine),
// three divisions each (Division 1 highest), 100 points per division. Point
// changes + promotion/demotion happen server-side in apply_ranked_results
// (see db/051_ranked.sql); this file is typed wrappers, the tier mapping, and
// the shared tunable constants.

import { supabase } from "./supabase";

// ---- Tunable point math (mirror the SQL in db/051_ranked.sql) -------------
export const RANK_WIN_BASE = 20; // base points for a win
export const RANK_LOSS_BASE = 15; // base points lost on a loss
export const RANK_PER_DIFF = 2.5; // ± per 1-player Vice/Virtue remaining gap
export const RANK_DEMOTE_LANDING = 75; // points you land on after a demotion

// Tiers low -> high. Keys match BadgeTier in badges.ts so the rank emblem can
// reuse TIER_META art. tier_index in the DB is the array index (0..4).
export const RANK_TIER_KEYS = [
  "earthen",
  "verdant",
  "primal",
  "noble",
  "divine",
] as const;
export type RankTierKey = (typeof RANK_TIER_KEYS)[number];
export const RANK_TIER_NAMES = [
  "Earthen",
  "Verdant",
  "Primal",
  "Noble",
  "Divine",
];

export type RankedState = {
  tierIndex: number; // 0 Earthen .. 4 Divine
  division: number; // 1 (top) .. 3 (bottom)
  points: number; // 0..100 within the division
  games: number;
  wins: number;
};

function clampTier(i: number): number {
  return Math.max(0, Math.min(RANK_TIER_KEYS.length - 1, Math.floor(i || 0)));
}

export function tierKey(tierIndex: number): RankTierKey {
  return RANK_TIER_KEYS[clampTier(tierIndex)];
}

export function tierName(tierIndex: number): string {
  return RANK_TIER_NAMES[clampTier(tierIndex)];
}

// "Primal · Division 2"
export function formatRank(state: RankedState): string {
  return `${tierName(state.tierIndex)} · Division ${state.division}`;
}

// Point change previews (the server is authoritative; these are for UI copy).
export function rankWinDelta(diff: number): number {
  return RANK_WIN_BASE + RANK_PER_DIFF * Math.max(0, diff);
}
export function rankLossDelta(diff: number): number {
  return -(RANK_LOSS_BASE + RANK_PER_DIFF * Math.max(0, diff));
}

const DEFAULT_RANK: RankedState = {
  tierIndex: 0,
  division: 3,
  points: 0,
  games: 0,
  wins: 0,
};

// Read a given account's ladder position (account_ranked is world-readable).
export async function getRankedFor(userId: string): Promise<RankedState> {
  const { data } = await supabase
    .from("account_ranked")
    .select("tier_index, division, points, games, wins")
    .eq("user_id", userId)
    .maybeSingle();
  const r = data as {
    tier_index: number;
    division: number;
    points: number;
    games: number;
    wins: number;
  } | null;
  if (!r) return { ...DEFAULT_RANK };
  return {
    tierIndex: r.tier_index ?? 0,
    division: r.division ?? 3,
    points: Number(r.points ?? 0),
    games: r.games ?? 0,
    wins: r.wins ?? 0,
  };
}

// The current user's ladder position, or null when signed out.
export async function getMyRanked(): Promise<RankedState | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getRankedFor(user.id);
}

// Host-side, on game-over of a ranked room: move each account player's rank.
// Mirrors grant_match_rewards — bypasses RLS, idempotent per (user, room).
export async function applyRankedResults(
  roomId: string,
  results: { u: string; won: boolean; diff: number }[]
): Promise<void> {
  if (results.length === 0) return;
  const { error } = await supabase.rpc("apply_ranked_results", {
    p_room_id: roomId,
    p_results: results,
  });
  if (error) throw error;
}
