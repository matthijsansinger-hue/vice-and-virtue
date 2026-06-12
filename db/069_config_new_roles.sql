-- ============================================
-- Migration 069 — allow the 8 unlockable roles in the random-mode host config
-- ============================================
-- The random-deal slot validator hardcoded an allowlist of the 12 original
-- roles, so a host who configured a new role (Wrath/Love/Gambling/Determination/
-- Fanaticism/Generosity/Pride/Diligence) had it silently dropped to the default.
-- All 8 abilities are now implemented (migrations 066-068), so drop the
-- allowlist and rely on the camp + tier check: vv_role_camp / vv_role_tier know
-- all 20 roles and return null for an unknown id, so a bad value still falls
-- back to p_default. (Client: RoleConfigModal lists every role of the slot's
-- camp + tier, not just the playable-12.)
-- ============================================

create or replace function vv_config_slot(
  p_config jsonb, p_camp text, p_tier text, p_default text
)
returns text
language sql
stable
as $$
  -- Any KNOWN role whose camp + tier match the slot is a valid fill (this now
  -- includes the 8 unlockable roles — migration 069). vv_role_camp/vv_role_tier
  -- return null for an unknown id, so a bad value falls back to p_default.
  select case
    when (p_config #>> array[p_camp, p_tier]) is not null
     and vv_role_camp(p_config #>> array[p_camp, p_tier]) = p_camp
     and vv_role_tier(p_config #>> array[p_camp, p_tier]) = p_tier
    then p_config #>> array[p_camp, p_tier]
    else p_default
  end;
$$;
