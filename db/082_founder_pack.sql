-- ============================================
-- Migration 082 — Founder Pack (1000 Mano bundle)
-- ============================================
-- A one-time premium bundle: 1000 Mano grants 4000 LP + unlocks two special
-- cosmetics — the 'pioneer' banner (an ornate gold banner image) and the
-- 'founder' name color (ivory/white-gold, Cinzel Decorative font, dark-brown
-- shadow). Both are tracked in account_color_unlocks like shop colors; the
-- 'pioneer' row doubles as the pack-ownership marker (so the LP can't be farmed).
-- set_cosmetic_color now also equips these two — each only in its own slot.
-- ============================================

create or replace function buy_founder_pack()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_mano int;
  v_le int;
  c_price constant int := 1000;
  c_lp constant int := 4000;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;

  -- One-time: the 'pioneer' unlock marks pack ownership.
  if exists (select 1 from account_color_unlocks where user_id = v_user and color = 'pioneer') then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  select mano into v_mano from account_economy where user_id = v_user for update;
  if coalesce(v_mano, 0) < c_price then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'mano', coalesce(v_mano, 0));
  end if;

  update account_economy
    set mano = mano - c_price, life_experience = life_experience + c_lp
  where user_id = v_user
  returning mano, life_experience into v_mano, v_le;

  insert into account_color_unlocks (user_id, color)
  values (v_user, 'pioneer'), (v_user, 'founder')
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'mano', v_mano, 'le', v_le, 'lp_granted', c_lp);
end; $$;
grant execute on function buy_founder_pack() to authenticated;

-- Equip a name/banner color: a level tier (level-gated), an owned shop color
-- (either slot), or an owned founder-pack cosmetic ('founder' name / 'pioneer'
-- banner, slot-specific). Null clears to the default.
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

  -- Founder-pack cosmetics: slot-specific, require ownership.
  if p_tier in ('founder', 'pioneer') then
    if (p_tier = 'founder' and p_kind <> 'name') or (p_tier = 'pioneer' and p_kind <> 'banner') then
      return jsonb_build_object('ok', false, 'reason', 'slot');
    end if;
    if not exists (select 1 from account_color_unlocks where user_id = v_user and color = p_tier) then
      return jsonb_build_object('ok', false, 'reason', 'unowned');
    end if;
    if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
    else update profiles set banner_color = p_tier where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Shop colors: equippable for either slot once bought.
  if p_tier = any(c_colors) then
    if not exists (select 1 from account_color_unlocks where user_id = v_user and color = p_tier) then
      return jsonb_build_object('ok', false, 'reason', 'unowned');
    end if;
    if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
    else update profiles set banner_color = p_tier where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Level tiers: gated by account level.
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
