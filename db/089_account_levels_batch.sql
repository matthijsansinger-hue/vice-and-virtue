-- ============================================
-- Migration 089 — batch account XP (levels in the lobby + outreach)
-- ============================================
-- The lobby and outreach phases show each account player's level in a star on
-- their banner. account_economy is read-own, so this SECURITY DEFINER function
-- returns the xp totals for a set of users in one call (level derived
-- client-side via levelFromXp). Only xp is exposed.

create or replace function get_account_levels(p_users uuid[])
returns table(user_id uuid, xp integer)
language sql
stable
security definer
set search_path = public
as $$
  select e.user_id, e.xp
  from account_economy e
  where e.user_id = any(p_users);
$$;

grant execute on function get_account_levels(uuid[]) to anon, authenticated;
