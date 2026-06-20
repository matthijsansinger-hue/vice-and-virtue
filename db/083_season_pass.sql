-- ============================================
-- Migration 083 — Season pass: "The First Souls" (season 1)
-- ============================================
-- A perpetual (no end) battle pass. 50 tiers, 300 season-XP each. Season XP is
-- account XP earned SINCE launch: account_season.start_xp snapshots each
-- account's xp at launch (backfilled here; lazily for accounts created later),
-- so everyone climbs from tier 0. Tier = clamp(floor((xp - start_xp)/300), 0,50).
--
-- Free + Premium tracks. Each tier's reward rotates Soul Fragment -> 100 LP ->
-- 10 Mano (tier 1 = fragment). Premium owners claim BOTH tracks. Premium (1000
-- Mano, one-time) also grants the noble 'First Soul' badge; premium tier 50
-- grants the 'spirit' banner + 'firstsouls' name color instead of a rotation
-- reward. Rewards are claimed per tier (claimed_free / claimed_premium).
-- ============================================

create table account_season (
  user_id uuid primary key references auth.users(id) on delete cascade,
  start_xp integer not null default 0,           -- xp snapshot at season start
  premium boolean not null default false,
  claimed_free integer[] not null default '{}',  -- claimed free tier numbers
  claimed_premium integer[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table account_season enable row level security;
create policy "read own season" on account_season for select using (auth.uid() = user_id);

-- Backfill existing accounts: start at tier 0 from their current xp.
insert into account_season (user_id, start_xp)
  select user_id, xp from account_economy
on conflict (user_id) do nothing;

-- Pass tier from xp + start_xp (0..50, 300 xp each).
create or replace function vv_season_tier(p_xp int, p_start int)
returns int language sql immutable as $$
  select least(50, greatest(0, floor((greatest(0, p_xp - p_start)) / 300.0)::int));
$$;

-- Read (and lazily initialise) the caller's season state.
create or replace function get_season()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_xp int; v_start int; v_premium boolean; v_cf int[]; v_cp int[];
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select coalesce(xp, 0) into v_xp from account_economy where user_id = v_user;
  insert into account_season (user_id, start_xp) values (v_user, v_xp) on conflict (user_id) do nothing;
  select start_xp, premium, claimed_free, claimed_premium
    into v_start, v_premium, v_cf, v_cp
  from account_season where user_id = v_user;
  return jsonb_build_object(
    'ok', true,
    'tier', vv_season_tier(v_xp, v_start),
    'premium', v_premium,
    'season_xp', greatest(0, v_xp - v_start),
    'claimed_free', to_jsonb(v_cf),
    'claimed_premium', to_jsonb(v_cp)
  );
end; $$;
grant execute on function get_season() to authenticated;

-- Buy the premium pass (1000 Mano, one-time). Unlocks the premium track;
-- premium rewards then become claimable up to your tier (the banner is tier 1,
-- the 'First Soul' badge is tier 50).
create or replace function buy_season_premium()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_mano int; c_price constant int := 1000;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  insert into account_season (user_id, start_xp)
    values (v_user, (select coalesce(xp, 0) from account_economy where user_id = v_user))
  on conflict (user_id) do nothing;
  if (select premium from account_season where user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  select mano into v_mano from account_economy where user_id = v_user for update;
  if coalesce(v_mano, 0) < c_price then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'mano', coalesce(v_mano, 0));
  end if;
  update account_economy set mano = mano - c_price where user_id = v_user returning mano into v_mano;
  update account_season set premium = true where user_id = v_user;
  return jsonb_build_object('ok', true, 'mano', v_mano);
end; $$;
grant execute on function buy_season_premium() to authenticated;

-- Claim one tier's reward on the free (p_premium=false) or premium track.
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
    -- Tier-1 premium: the cosmetic banner + name color.
    insert into account_color_unlocks (user_id, color)
    values (v_user, 'spirit'), (v_user, 'firstsouls')
    on conflict do nothing;
    v_kind := 'cosmetic';
  elsif p_premium and p_tier = 50 then
    -- Tier-50 premium: the noble 'First Soul' badge.
    insert into user_achievements (user_id, key) values (v_user, 'pass_s1_premium') on conflict do nothing;
    v_kind := 'badge';
  else
    -- Rotation reward.
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

-- Extend set_cosmetic_color to also equip the season cosmetics: 'firstsouls'
-- (name) and 'spirit' (banner), once owned.
create or replace function set_cosmetic_color(p_kind text, p_tier text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_level int;
  v_needed int;
  c_tiers text[] := array['earthen','verdant','primal','noble','divine'];
  c_colors text[] := array['red','orange','yellow','green','blue','indigo','violet','grey','white','black'];
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_kind not in ('name', 'banner') then return jsonb_build_object('ok', false, 'reason', 'kind'); end if;

  if p_tier is null then
    if p_kind = 'name' then update profiles set name_color = null where id = v_user;
    else update profiles set banner_color = null where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Special owned cosmetics (Founder pack + season pass), slot-specific.
  if p_tier in ('founder', 'pioneer', 'firstsouls', 'spirit') then
    if (p_tier in ('founder', 'firstsouls') and p_kind <> 'name')
       or (p_tier in ('pioneer', 'spirit') and p_kind <> 'banner') then
      return jsonb_build_object('ok', false, 'reason', 'slot');
    end if;
    if not exists (select 1 from account_color_unlocks where user_id = v_user and color = p_tier) then
      return jsonb_build_object('ok', false, 'reason', 'unowned');
    end if;
    if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
    else update profiles set banner_color = p_tier where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_tier = any(c_colors) then
    if not exists (select 1 from account_color_unlocks where user_id = v_user and color = p_tier) then
      return jsonb_build_object('ok', false, 'reason', 'unowned');
    end if;
    if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
    else update profiles set banner_color = p_tier where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  if not (p_tier = any(c_tiers)) then
    return jsonb_build_object('ok', false, 'reason', 'tier');
  end if;
  select vv_level_from_xp(coalesce(xp, 0)) into v_level
  from account_economy where user_id = v_user;
  v_level := coalesce(v_level, 1);
  v_needed := case when p_kind = 'name' then
      case p_tier when 'earthen' then 5 when 'verdant' then 15 when 'primal' then 25
                  when 'noble' then 35 when 'divine' then 45 end
    else
      case p_tier when 'earthen' then 10 when 'verdant' then 20 when 'primal' then 30
                  when 'noble' then 40 when 'divine' then 50 end
    end;
  if v_level < v_needed then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'level', v_level, 'needed', v_needed);
  end if;
  if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
  else update profiles set banner_color = p_tier where id = v_user; end if;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function set_cosmetic_color(text, text) to authenticated;
