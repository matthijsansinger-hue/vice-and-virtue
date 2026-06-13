// Account economy: the meta-progression currencies, account XP/level, and
// Soul Fragments (the loot box; internal names still say "shard"). All
// mutations happen in SECURITY DEFINER RPCs
// (see db/050_account_economy.sql) so balances can't be edited from the
// client — this file is just typed wrappers + the shared tunable constants.
//
// Naming: the in-MATCH ability resource is "Soul Energy" (players.soul_energy,
// reset every game). THIS currency is "Life Proficiency" (LP) — account-level,
// earned from Soul Fragments + matches, spent to unlock roles. Different thing.
// (The internal storage key stays `le`/life_experience — display name only.)

import { supabase } from "./supabase";

// ---- Tunable economy config (mirror the SQL in db/050_account_economy.sql) -
export const SHARD_XP = 50; // guaranteed XP per Soul Fragment
export const SHARD_LE = 10; // LE when a shard rolls Life Experience
export const SHARD_MANO = 10; // Mano when a shard rolls Mano
export const SHARD_ODDS_ROLE = 0.001; // 0.1% — instant role unlock
export const SHARD_ODDS_MANO = 0.09; // 9% — Mano
// LE is the remainder (~90.9%). The three stated rates (91% / 9% / 0.1%) sum
// to 100.1%, so LE absorbs the 0.1% rounding to keep the total at 100%.
export const MATCH_XP = 30; // account XP for playing a match
export const MATCH_WIN_BONUS_XP = 20; // extra account XP for a win
export const MATCH_LE_WIN = 9; // LE for a win
export const MATCH_LE_LOSS = 3; // LE for a loss
export const XP_LEVEL_STEP = 100; // level L -> L+1 costs XP_LEVEL_STEP * L

// LP cost to unlock a role, by tier (migration 079; mirror the CASE in the
// `unlock_role` SQL RPC). D-tier roles are part of the default set, so they're
// never purchased.
export const ROLE_UNLOCK_COST_BY_TIER: Record<string, number> = {
  S: 2500,
  A: 1500,
  B: 1000,
  C: 600,
  D: 0,
};

// LP needed to unlock a role of the given tier (falls back to 1000 for an
// unknown tier, matching the SQL).
export function roleUnlockCost(tier: string): number {
  return ROLE_UNLOCK_COST_BY_TIER[tier] ?? 1000;
}

// Currency display names — single source so a rename is one edit. (The
// internal field/column is still `le`/life_experience; only the label changed.)
export const LE_NAME = "Life Proficiency";
export const LE_ABBR = "LP";
export const MANO_NAME = "Mano";

// Roles every account owns from the start. Currently ALL 12 roles are free;
// roles added later that are NOT in this list become unlockable (with LE or
// the rare Soul Fragment drop). MUST mirror c_default in the SQL RPCs.
export const DEFAULT_UNLOCKED_ROLES = [
  "murder",
  "empathy",
  "intoxication",
  "justice",
  "envy",
  "truthfulness",
  "torment",
  "vengeance",
  "certainty",
  "sacrifice",
  "vice_worshipper",
  "virtue_seeker",
];

export type AccountEconomy = {
  le: number; // Life Experience
  mano: number;
  xp: number;
  unopened_shards: number;
  unlockedRoles: string[]; // default starter set ∪ unlocked
  dailyClaimed: boolean; // today's daily-login shard already claimed
  dailyWins: number; // wins counted today (0–3) toward the daily win shards
};

// Balances returned alongside every shard outcome, so the UI can refresh
// without a second round-trip.
type RewardBalances = {
  xp_gained: number;
  le: number;
  mano: number;
  xp: number;
  unopened_shards: number;
};

export type ShardReward =
  | { kind: "none" }
  | ({ kind: "le"; amount: number } & RewardBalances)
  | ({ kind: "mano"; amount: number } & RewardBalances)
  | ({ kind: "role"; role: string } & RewardBalances);

// Derive the account level + progress from total XP. Each level L costs
// XP_LEVEL_STEP * L to clear (level 1->2 = 100, 2->3 = 200, ...), so the
// cumulative XP to BE at level L is XP_LEVEL_STEP * L*(L-1)/2.
export function levelFromXp(xp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
} {
  const safe = Math.max(0, Math.floor(xp || 0));
  const step = XP_LEVEL_STEP;
  const level = Math.max(
    1,
    Math.floor((step + Math.sqrt(step * step + 8 * step * safe)) / (2 * step))
  );
  const cumulative = (step * level * (level - 1)) / 2;
  const xpIntoLevel = safe - cumulative;
  const xpForNext = step * level;
  return { level, xpIntoLevel, xpForNext, progress: xpIntoLevel / xpForNext };
}

// The current user's economy + unlocked roles, or null when signed out.
export async function getMyEconomy(): Promise<AccountEconomy | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: econ } = await supabase
    .from("account_economy")
    .select(
      "life_experience, mano, xp, unopened_shards, last_daily_shard_date, last_first_win_date, daily_win_count"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: unlocks } = await supabase
    .from("account_role_unlocks")
    .select("role")
    .eq("user_id", user.id);

  const purchased = (unlocks ?? []).map((u) => (u as { role: string }).role);
  const e = econ as {
    life_experience: number;
    mano: number;
    xp: number;
    unopened_shards: number;
    last_daily_shard_date: string | null;
    last_first_win_date: string | null;
    daily_win_count: number;
  } | null;
  // Postgres date columns come back as "YYYY-MM-DD" strings; compare to today.
  const today = new Date().toISOString().slice(0, 10);
  return {
    le: e?.life_experience ?? 0,
    mano: e?.mano ?? 0,
    xp: e?.xp ?? 0,
    unopened_shards: e?.unopened_shards ?? 0,
    unlockedRoles: Array.from(
      new Set([...DEFAULT_UNLOCKED_ROLES, ...purchased])
    ),
    dailyClaimed: (e?.last_daily_shard_date ?? null) === today,
    dailyWins: (e?.last_first_win_date ?? null) === today ? e?.daily_win_count ?? 0 : 0,
  };
}

// Open one Soul Fragment; the server rolls + applies the reward and returns it.
export async function openSoulShard(): Promise<ShardReward> {
  const { data, error } = await supabase.rpc("open_soul_shard");
  if (error) throw error;
  return data as ShardReward;
}

// Grant today's daily-login shard if it hasn't been granted yet. The server
// is authoritative (date-gated); a localStorage day-guard just avoids a
// redundant RPC on every mount. Fail-silent — a login reward is non-critical.
export async function claimDailyLogin(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const KEY = "vv_daily_shard_claimed";
  try {
    if (typeof window !== "undefined" && localStorage.getItem(KEY) === today) {
      return;
    }
  } catch {
    /* storage unavailable — fall through and just call the RPC */
  }
  const { error } = await supabase.rpc("claim_daily_login");
  if (error) return;
  try {
    if (typeof window !== "undefined") localStorage.setItem(KEY, today);
  } catch {
    /* ignore */
  }
}

// Spend LE to unlock a role (used by the roles collection / shop UI).
export async function unlockRoleWithLe(role: string): Promise<{
  ok: boolean;
  reason?: string;
  le?: number;
  role?: string;
}> {
  const { data, error } = await supabase.rpc("unlock_role", { p_role: role });
  if (error) throw error;
  return data as {
    ok: boolean;
    reason?: string;
    le?: number;
    role?: string;
  };
}

// Host-side, on game-over: grant per-match XP + LE (and a first-win-of-the-day
// shard) to every account player. Mirrors grant_achievements — bypasses RLS so
// the host can reward everyone. Idempotent per (user, room) server-side.
export async function grantMatchRewards(
  roomId: string,
  awards: { u: string; won: boolean }[]
): Promise<void> {
  if (awards.length === 0) return;
  const { error } = await supabase.rpc("grant_match_rewards", {
    p_room_id: roomId,
    p_awards: awards,
  });
  if (error) throw error;
}
