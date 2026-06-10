-- ============================================
-- Eight new roles become unlockable (migration 062).
-- ============================================
-- Adds the 8 new roles (Wrath, Love, Gambling, Determination, Fanaticism,
-- Generosity, Pride, Diligence) to the economy's c_all_roles so they can be
-- unlocked — by spending 1000 Life Proficiency (unlock_role) or via the rare
-- 0.1% Soul Shard drop (open_soul_shard). c_default stays the original 12, so
-- the new roles are LOCKED by default. (Gameplay for the new roles isn't wired
-- yet — they're collection/unlock entries; assignment still uses the old set.)
--
-- Redefines open_soul_shard() + unlock_role(p_role) with the expanded
-- c_all_roles. Mirrored into db/schema.sql.

create or replace function open_soul_shard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  v_roll numeric;
  v_kind text;
  v_amount int := 0;
  v_role text := null;
  v_locked text[];
  -- mirror roles.ts (ROLES) + economy.ts DEFAULT_UNLOCKED_ROLES
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker',
    'wrath','love','gambling','determination',
    'fanaticism','generosity','pride','diligence'];
  c_default text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_xp constant int := 50;
  c_le constant int := 10;
  c_mano constant int := 10;
  c_odds_role constant numeric := 0.001;
  c_odds_mano constant numeric := 0.09;
begin
  if v_user is null then
    return jsonb_build_object('kind', 'none');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.unopened_shards <= 0 then
    return jsonb_build_object('kind', 'none');
  end if;

  v_roll := random();

  if v_roll < c_odds_role then
    select array_agg(r) into v_locked
    from unnest(c_all_roles) r
    where not (r = any(c_default))
      and not exists (
        select 1 from account_role_unlocks u
        where u.user_id = v_user and u.role = r
      );
    if v_locked is null or array_length(v_locked, 1) is null then
      v_kind := 'le'; v_amount := c_le;                  -- nothing left to unlock
    else
      v_role := v_locked[1 + floor(random() * array_length(v_locked, 1))::int];
      insert into account_role_unlocks (user_id, role) values (v_user, v_role)
        on conflict do nothing;
      v_kind := 'role';
    end if;
  elsif v_roll < c_odds_role + c_odds_mano then
    v_kind := 'mano'; v_amount := c_mano;
  else
    v_kind := 'le'; v_amount := c_le;
  end if;

  update account_economy set
    unopened_shards = unopened_shards - 1,
    xp = xp + c_xp,
    life_experience = life_experience + case when v_kind = 'le' then v_amount else 0 end,
    mano = mano + case when v_kind = 'mano' then v_amount else 0 end
  where user_id = v_user
  returning * into v_row;

  return jsonb_build_object(
    'kind', v_kind,
    'amount', v_amount,
    'role', v_role,
    'xp_gained', c_xp,
    'le', v_row.life_experience,
    'mano', v_row.mano,
    'xp', v_row.xp,
    'unopened_shards', v_row.unopened_shards
  );
end;
$$;
grant execute on function open_soul_shard() to authenticated;

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
  c_cost constant int := 1000;
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

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.life_experience < c_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'le', v_row.life_experience);
  end if;

  update account_economy set life_experience = life_experience - c_cost where user_id = v_user
  returning * into v_row;
  insert into account_role_unlocks (user_id, role) values (v_user, p_role)
    on conflict do nothing;

  return jsonb_build_object('ok', true, 'role', p_role, 'le', v_row.life_experience);
end;
$$;
grant execute on function unlock_role(text) to authenticated;
