// Profile editing: update profile fields, equip name/banner colors, and save the
// customizable character (the layered avatar that replaced uploaded photos).

import { supabase } from "./supabase";
import { normalizeCharacter, type CharacterConfig } from "./character";

// Update the current user's profile fields (only the ones provided). The
// per-user "update own row" RLS policy (db/020_profiles.sql) makes a plain
// update safe — no RPC needed.
export async function updateProfile(fields: {
  favorite_role?: string | null;
  appearance?: CharacterConfig | null;
  featured_badges?: string[];
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { error } = await supabase
    .from("profiles")
    .update(fields)
    .eq("id", user.id);
  if (error) throw error;
}

// Persist the player's customized character. Normalized first so the stored
// jsonb is always a complete, valid config (every reader can trust it).
export async function saveCharacter(character: CharacterConfig): Promise<void> {
  await updateProfile({ appearance: normalizeCharacter(character) });
}

// Equip (or clear) an earned name/banner color. The server validates the pick
// against the account's level (set_cosmetic_color); pass tier = null to reset to
// the default. Returns whether it stuck.
export async function setCosmeticColor(
  kind: "name" | "banner",
  tier: string | null
): Promise<{ ok: boolean; reason?: string; level?: number; needed?: number }> {
  const { data, error } = await supabase.rpc("set_cosmetic_color", {
    p_kind: kind,
    p_tier: tier,
  });
  if (error) throw error;
  return (data as { ok: boolean; reason?: string; level?: number; needed?: number } | null) ?? {
    ok: false,
  };
}
