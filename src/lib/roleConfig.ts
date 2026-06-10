// Ranked role loadout: per side (Vice/Virtue) and per role tier (S/A/B/C/D),
// the role a player would rather be assigned in a ranked game. Stored on the
// account (account_role_config); consumed by ranked role assignment later.
//
// "Tier" here = the role tiers S–D (how roles are assigned), not the ranked
// ladder tiers. Tiers with a single role have no real choice yet; the loadout
// gets richer as more roles are added per tier.

import { supabase } from "./supabase";
import { ROLES, isPlayableRole, type Camp, type Tier } from "./roles";

export const TIER_ORDER: Tier[] = ["S", "A", "B", "C", "D"];

// tier -> role id, for one side.
export type SideConfig = Partial<Record<Tier, string>>;
export type RoleConfig = { vice: SideConfig; virtue: SideConfig };

// The roles available for a camp, grouped by tier (derived from ROLES).
export function rolesByTier(camp: Camp): Record<Tier, string[]> {
  const out: Record<Tier, string[]> = { S: [], A: [], B: [], C: [], D: [] };
  for (const r of Object.values(ROLES)) {
    // Only assignable (playable) roles belong in the ranked loadout.
    if (r.camp === camp && isPlayableRole(r.id)) out[r.tier].push(r.id);
  }
  return out;
}

// Default loadout: the first (currently only, for most tiers) role per tier.
export function defaultSideConfig(camp: Camp): SideConfig {
  const byTier = rolesByTier(camp);
  const cfg: SideConfig = {};
  for (const t of TIER_ORDER) {
    if (byTier[t].length > 0) cfg[t] = byTier[t][0];
  }
  return cfg;
}

export function defaultRoleConfig(): RoleConfig {
  return {
    vice: defaultSideConfig("vice"),
    virtue: defaultSideConfig("virtue"),
  };
}

// Overlay stored choices on the defaults, dropping any that aren't a valid
// role for that camp+tier (e.g. a role that was removed).
function sanitizeSide(camp: Camp, stored: SideConfig | undefined): SideConfig {
  const byTier = rolesByTier(camp);
  const def = defaultSideConfig(camp);
  const out: SideConfig = {};
  for (const t of TIER_ORDER) {
    if (byTier[t].length === 0) continue;
    const s = stored?.[t];
    out[t] = s && byTier[t].includes(s) ? s : def[t];
  }
  return out;
}

function sanitize(stored: Partial<RoleConfig> | null | undefined): RoleConfig {
  return {
    vice: sanitizeSide("vice", stored?.vice),
    virtue: sanitizeSide("virtue", stored?.virtue),
  };
}

// The current user's loadout (defaults when signed out or unset).
export async function getMyRoleConfig(): Promise<RoleConfig> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return defaultRoleConfig();

  const { data } = await supabase
    .from("account_role_config")
    .select("config")
    .eq("user_id", user.id)
    .maybeSingle();
  const stored = (data as { config: Partial<RoleConfig> } | null)?.config;
  return sanitize(stored);
}

// Persist the loadout (upsert one row per account).
export async function saveRoleConfig(config: RoleConfig): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("account_role_config")
    .upsert({ user_id: user.id, config }, { onConflict: "user_id" });
  if (error) throw error;
}
