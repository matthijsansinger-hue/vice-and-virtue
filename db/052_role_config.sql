-- ============================================
-- Ranked role loadout (migration 052) — batch 3a of the meta-progression layer.
-- ============================================
-- Per-account role preferences: for each side (Vice/Virtue) and each role tier
-- (S/A/B/C/D), the role the player would rather be assigned. Consumed by ranked
-- role assignment (a later batch). Unlike currencies, the player edits this
-- freely, so it uses normal per-user RLS (no SECURITY DEFINER needed).

drop table if exists account_role_config cascade;

create table account_role_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,   -- { vice: {S,A,B,C,D -> role id}, virtue: {...} }
  created_at timestamptz not null default now()
);

alter table account_role_config enable row level security;

create policy "read own role config"
  on account_role_config for select using (auth.uid() = user_id);
create policy "insert own role config"
  on account_role_config for insert with check (auth.uid() = user_id);
create policy "update own role config"
  on account_role_config for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
