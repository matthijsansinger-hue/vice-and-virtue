-- ============================================
-- Migration 088 — read any account's XP (for showing another player's level)
-- ============================================
-- account_economy is read-own only, so a friend's level isn't visible. This
-- SECURITY DEFINER function exposes ONLY the xp total for a given user (the
-- account level is derived from it client-side via levelFromXp) so a visited
-- profile can show that player's current level. Nothing else leaks.

create or replace function get_account_xp(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(xp, 0) from account_economy where user_id = p_user;
$$;

grant execute on function get_account_xp(uuid) to anon, authenticated;
