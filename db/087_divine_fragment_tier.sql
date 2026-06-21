-- ============================================
-- Migration 087 — Free season tier 50 = a guaranteed Divine Soul Fragment
-- ============================================
-- The free pass's tier 50 now grants a Soul Fragment that's guaranteed to open
-- as DIVINE. Mechanism: a per-account `guaranteed_divine_shards` counter — while
-- it's > 0, the next opened fragment is forced to Divine rarity (and the counter
-- decrements). schema.sql mirrors all three changes.

alter table account_economy
  add column if not exists guaranteed_divine_shards int not null default 0;

-- open_soul_shard: honour the guaranteed-divine counter before rolling.
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
  v_pick numeric;
  v_rarity text;
  v_kind text;
  v_amount int := 0;
  v_mano_amt int;
  v_le_amt int;
  v_role text := null;
  v_locked text[];
  v_has_locked boolean;
  v_forced_divine boolean := false;
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker',
    'wrath','love','gambling','determination',
    'fanaticism','generosity','pride','diligence'];
  c_default text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_xp constant int := 50;
begin
  if v_user is null then
    return jsonb_build_object('kind', 'none');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.unopened_shards <= 0 then
    return jsonb_build_object('kind', 'none');
  end if;

  if v_row.guaranteed_divine_shards > 0 then
    -- A pass-granted guaranteed Divine fragment: skip the roll.
    v_forced_divine := true;
    v_rarity := 'divine'; v_mano_amt := 50; v_le_amt := 1000;
  else
    -- Roll the rarity tier (Earthen 50 / Verdant 28 / Primal 15 / Noble 6 / Divine 1).
    v_roll := random();
    if v_roll < 0.50 then
      v_rarity := 'earthen'; v_mano_amt := 1;  v_le_amt := 10;
    elsif v_roll < 0.78 then
      v_rarity := 'verdant'; v_mano_amt := 3;  v_le_amt := 30;
    elsif v_roll < 0.93 then
      v_rarity := 'primal';  v_mano_amt := 8;  v_le_amt := 80;
    elsif v_roll < 0.99 then
      v_rarity := 'noble';   v_mano_amt := 19; v_le_amt := 190;
    else
      v_rarity := 'divine';  v_mano_amt := 50; v_le_amt := 1000;
    end if;
  end if;

  -- Still-locked roles a role-unlock could grant (Divine's third option only).
  select array_agg(r) into v_locked
  from unnest(c_all_roles) r
  where not (r = any(c_default))
    and not exists (
      select 1 from account_role_unlocks u
      where u.user_id = v_user and u.role = r
    );
  v_has_locked := v_locked is not null and array_length(v_locked, 1) is not null;

  -- Server picks the reward at random from the rarity's options. Divine offers a
  -- third option (role unlock) at equal weight, but only when something's locked.
  v_pick := random();
  if v_rarity = 'divine' and v_has_locked then
    if v_pick < 1.0/3.0 then
      v_kind := 'role';
    elsif v_pick < 2.0/3.0 then
      v_kind := 'mano'; v_amount := v_mano_amt;
    else
      v_kind := 'le'; v_amount := v_le_amt;
    end if;
  elsif v_pick < 0.5 then
    v_kind := 'mano'; v_amount := v_mano_amt;
  else
    v_kind := 'le'; v_amount := v_le_amt;
  end if;

  if v_kind = 'role' then
    v_role := v_locked[1 + floor(random() * array_length(v_locked, 1))::int];
    insert into account_role_unlocks (user_id, role) values (v_user, v_role)
      on conflict do nothing;
  end if;

  update account_economy set
    unopened_shards = unopened_shards - 1,
    guaranteed_divine_shards = guaranteed_divine_shards - (case when v_forced_divine then 1 else 0 end),
    xp = xp + c_xp,
    life_experience = life_experience + case when v_kind = 'le' then v_amount else 0 end,
    mano = mano + case when v_kind = 'mano' then v_amount else 0 end
  where user_id = v_user
  returning * into v_row;

  return jsonb_build_object(
    'kind', v_kind, 'amount', v_amount, 'role', v_role, 'rarity', v_rarity,
    'xp_gained', c_xp, 'le', v_row.life_experience, 'mano', v_row.mano,
    'xp', v_row.xp, 'unopened_shards', v_row.unopened_shards
  );
end;
$$;
grant execute on function open_soul_shard() to authenticated;

-- claim_season_tier: free tier 50 grants the guaranteed Divine fragment.
create or replace function claim_season_tier(p_tier int, p_premium boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_xp int; v_start int; v_premium boolean; v_cf int[]; v_cp int[]; v_tier int; v_kind text;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_tier < 1 or p_tier > 50 then return jsonb_build_object('ok', false, 'reason', 'tier'); end if;
  select coalesce(xp, 0) into v_xp from account_economy where user_id = v_user;
  insert into account_season (user_id, start_xp) values (v_user, v_xp) on conflict (user_id) do nothing;
  select start_xp, premium, claimed_free, claimed_premium
    into v_start, v_premium, v_cf, v_cp
  from account_season where user_id = v_user for update;

  v_tier := vv_season_tier(v_xp, v_start);
  if p_tier > v_tier then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if p_premium and not v_premium then return jsonb_build_object('ok', false, 'reason', 'no_premium'); end if;
  if (p_premium and p_tier = any(v_cp)) or (not p_premium and p_tier = any(v_cf)) then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;

  if p_premium and p_tier = 1 then
    insert into account_color_unlocks (user_id, color)
    values (v_user, 'spirit'), (v_user, 'firstsouls')
    on conflict do nothing;
    v_kind := 'cosmetic';
  elsif p_premium and p_tier = 50 then
    insert into user_achievements (user_id, key) values (v_user, 'pass_s1_premium') on conflict do nothing;
    v_kind := 'badge';
  elsif (not p_premium) and p_tier = 50 then
    -- Free tier 50: a fragment guaranteed to open as Divine.
    update account_economy
      set unopened_shards = unopened_shards + 1,
          guaranteed_divine_shards = guaranteed_divine_shards + 1
    where user_id = v_user;
    v_kind := 'divine_fragment';
  else
    v_kind := (array['fragment','lp','mano'])[((p_tier - 1) % 3) + 1];
    if v_kind = 'fragment' then
      update account_economy set unopened_shards = unopened_shards + 1 where user_id = v_user;
    elsif v_kind = 'lp' then
      update account_economy set life_experience = life_experience + 100 where user_id = v_user;
    else
      update account_economy set mano = mano + 10 where user_id = v_user;
    end if;
  end if;

  if p_premium then
    update account_season set claimed_premium = array_append(claimed_premium, p_tier) where user_id = v_user;
  else
    update account_season set claimed_free = array_append(claimed_free, p_tier) where user_id = v_user;
  end if;

  return jsonb_build_object('ok', true, 'kind', v_kind);
end; $$;
grant execute on function claim_season_tier(int, boolean) to authenticated;
