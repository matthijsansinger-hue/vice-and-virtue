// Account economy: the meta-progression currencies, account XP/level, and
// Soul Shards (the loot box). All mutations happen in SECURITY DEFINER RPCs
// (see db/050_account_economy.sql) so balances can't be edited from the
// client — this file is just typed wrappers + the shared tunable constants.
//
// Naming: the in-MATCH ability resource is "Soul Energy" (players.soul_energy,
// reset every game). THIS currency is "Souls" — account-level, earned from
// Soul Shards, spent to unlock roles. Different thing entirely.

import { supabase } from "./supabase";

// ---- Tunable economy config (mirror the SQL in db/050_account_economy.sql) -
export const SHARD_XP = 50; // guaranteed XP per Soul Shard
export const SHARD_SOULS = 25; // Souls when a shard rolls Souls
export const SHARD_MANO = 10; // Mano when a shard rolls Mano
export const SHARD_ODDS_ROLE = 0.001; // 0.1% — instant role unlock
export const SHARD_ODDS_MANO = 0.09; // 9% — Mano
// Souls is the remainder (~90.9%). The three stated rates (91% / 9% / 0.1%)
// sum to 100.1%, so Souls absorbs the 0.1% rounding to keep the total at 100%.
export const MATCH_XP = 30; // XP for playing a match
export const MATCH_WIN_BONUS_XP = 20; // extra XP for a win
export const ROLE_UNLOCK_COST = 500; // Souls to unlock a role (batch 1b shop)
export const XP_PER_LEVEL = 100; // flat curve for now (easy to swap later)

// Currency display names — single source so a rename is one edit.
export const SOULS_NAME = "Souls";
export const MANO_NAME = "Mano";

// Roles every account owns from the start; the rest (the 6 higher-impact
// S/A/B roles) are unlocked with Souls or via the rare Soul Shard drop.
// MUST mirror c_default in the SQL RPCs (open_soul_shard / unlock_role).
export const DEFAULT_UNLOCKED_ROLES = [
  "truthfulness",
  "torment",
  "vengeance",
  "sacrifice",
  "vice_worshipper",
  "virtue_seeker",
];

export type AccountEconomy = {
  souls: number;
  mano: number;
  xp: number;
  unopened_shards: number;
  unlockedRoles: string[]; // default starter set ∪ unlocked
};

// Balances returned alongside every shard outcome, so the UI can refresh
// without a second round-trip.
type RewardBalances = {
  xp_gained: number;
  souls: number;
  mano: number;
  xp: number;
  unopened_shards: number;
};

export type ShardReward =
  | { kind: "none" }
  | ({ kind: "souls"; amount: number } & RewardBalances)
  | ({ kind: "mano"; amount: number } & RewardBalances)
  | ({ kind: "role"; role: string } & RewardBalances);

// Derive the account level + progress from total XP (flat curve for now).
export function levelFromXp(xp: number): {
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  progress: number;
} {
  const safe = Math.max(0, Math.floor(xp || 0));
  const level = Math.floor(safe / XP_PER_LEVEL) + 1;
  const xpIntoLevel = safe % XP_PER_LEVEL;
  return {
    level,
    xpIntoLevel,
    xpForNext: XP_PER_LEVEL,
    progress: xpIntoLevel / XP_PER_LEVEL,
  };
}

// The current user's economy + unlocked roles, or null when signed out.
export async function getMyEconomy(): Promise<AccountEconomy | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: econ } = await supabase
    .from("account_economy")
    .select("souls, mano, xp, unopened_shards")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: unlocks } = await supabase
    .from("account_role_unlocks")
    .select("role")
    .eq("user_id", user.id);

  const purchased = (unlocks ?? []).map((u) => (u as { role: string }).role);
  const e = econ as
    | { souls: number; mano: number; xp: number; unopened_shards: number }
    | null;
  return {
    souls: e?.souls ?? 0,
    mano: e?.mano ?? 0,
    xp: e?.xp ?? 0,
    unopened_shards: e?.unopened_shards ?? 0,
    unlockedRoles: Array.from(
      new Set([...DEFAULT_UNLOCKED_ROLES, ...purchased])
    ),
  };
}

// Open one Soul Shard; the server rolls + applies the reward and returns it.
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

// Spend Souls to unlock a role (used by the batch 1b shop UI).
export async function unlockRoleWithSouls(role: string): Promise<{
  ok: boolean;
  reason?: string;
  souls?: number;
  role?: string;
}> {
  const { data, error } = await supabase.rpc("unlock_role", { p_role: role });
  if (error) throw error;
  return data as {
    ok: boolean;
    reason?: string;
    souls?: number;
    role?: string;
  };
}

// Host-side, on game-over: grant per-match XP (+ a first-win-of-the-day shard)
// to every account player. Mirrors grant_achievements — bypasses RLS so the
// host can reward everyone. Idempotent per (user, room) server-side.
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
