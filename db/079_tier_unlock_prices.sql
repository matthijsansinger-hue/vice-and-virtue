-- ============================================
-- Migration 079 — per-tier role unlock prices
-- ============================================
-- Was a flat 1000 LP for every unlockable role. Now the price scales with the
-- role's tier: S 2500 / A 1500 / B 1000 / C 600. (The D-tier roles are part of
-- the default set, so they're never purchased.) The cost is derived from
-- vv_role_tier(p_role) — mirror of ROLE_UNLOCK_COST_BY_TIER in economy.ts.
-- ============================================

create or replace function unlock_role(p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker',
    'wrath','love','gambling','determination',
    'fanaticism','generosity','pride','diligence'];
  c_default text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  v_cost int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if not (p_role = any(c_all_roles)) or (p_role = any(c_default)) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from account_role_unlocks where user_id = v_user and role = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  -- Per-tier price (mirror ROLE_UNLOCK_COST_BY_TIER in economy.ts).
  v_cost := case vv_role_tier(p_role)
    when 'S' then 2500
    when 'A' then 1500
    when 'B' then 1000
    when 'C' then 600
    else 1000 end;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.life_experience < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'le', v_row.life_experience);
  end if;

  update account_economy set life_experience = life_experience - v_cost where user_id = v_user
  returning * into v_row;
  insert into account_role_unlocks (user_id, role) values (v_user, p_role)
    on conflict do nothing;

  return jsonb_build_object('ok', true, 'role', p_role, 'le', v_row.life_experience);
end;
$$;

grant execute on function unlock_role(text) to authenticated;
