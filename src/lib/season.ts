// Season pass "The First Souls" (migration 083). Tiers come from season XP
// (account XP since launch); rewards are claimed per tier on the free + premium
// tracks. All mutations go through SECURITY DEFINER RPCs.

import { supabase } from "./supabase";

export const SEASON_NAME = "The First Souls";
export const SEASON_TIERS = 50;
export const SEASON_XP_PER_TIER = 300;
export const SEASON_PREMIUM_PRICE = 1000; // Mano

export type SeasonRewardKind =
  | "fragment"
  | "lp"
  | "mano"
  | "cosmetic"
  | "badge"
  | "divine_fragment"; // free tier 50 — a guaranteed Divine Soul Fragment

export type SeasonState = {
  tier: number; // 0..50
  premium: boolean;
  seasonXp: number;
  claimedFree: number[];
  claimedPremium: number[];
};

// The reward at a 1-based tier. Rotation fragment -> lp -> mano, except the
// premium track's tier 1 (Spirit banner + name color) and tier 50 (First Soul
// badge).
export function tierReward(tier: number, premium: boolean): SeasonRewardKind {
  if (premium && tier === 1) return "cosmetic";
  if (premium && tier === SEASON_TIERS) return "badge";
  if (!premium && tier === SEASON_TIERS) return "divine_fragment";
  return (["fragment", "lp", "mano"] as const)[(tier - 1) % 3];
}

// Short label for a reward kind.
export function rewardLabel(kind: SeasonRewardKind): string {
  switch (kind) {
    case "fragment":
      return "Soul Fragment";
    case "lp":
      return "100 LP";
    case "mano":
      return "10 Mano";
    case "cosmetic":
      return "Spirit banner + name";
    case "badge":
      return "First Soul badge";
    case "divine_fragment":
      return "Divine Soul Fragment";
  }
}

export async function getSeason(): Promise<SeasonState | null> {
  const { data } = await supabase.rpc("get_season");
  const d = data as
    | {
        ok: boolean;
        tier?: number;
        premium?: boolean;
        season_xp?: number;
        claimed_free?: number[];
        claimed_premium?: number[];
      }
    | null;
  if (!d || !d.ok) return null;
  return {
    tier: d.tier ?? 0,
    premium: !!d.premium,
    seasonXp: d.season_xp ?? 0,
    claimedFree: d.claimed_free ?? [],
    claimedPremium: d.claimed_premium ?? [],
  };
}

export async function claimSeasonTier(
  tier: number,
  premium: boolean
): Promise<{ ok: boolean; reason?: string; kind?: SeasonRewardKind }> {
  const { data } = await supabase.rpc("claim_season_tier", {
    p_tier: tier,
    p_premium: premium,
  });
  return (data as { ok: boolean; reason?: string; kind?: SeasonRewardKind } | null) ?? { ok: false };
}

export async function buySeasonPremium(): Promise<{ ok: boolean; reason?: string; mano?: number }> {
  const { data } = await supabase.rpc("buy_season_premium");
  return (data as { ok: boolean; reason?: string; mano?: number } | null) ?? { ok: false };
}
