-- ============================================
-- Migration 081 — Mano shop: buyable name/banner colors
-- ============================================
-- The first Mano sink. Ten flat colors (7 rainbow + grey/white/black), each a
-- single 200-Mano purchase that unlocks the color for BOTH the name and the
-- banner slot. Ownership lives in account_color_unlocks; set_cosmetic_color now
-- also accepts an owned shop color for either slot (level tiers stay level-gated).
-- ============================================

create table if not exists account_color_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  color text not null,                            -- shop color id (red..black)
  created_at timestamptz not null default now(),
  primary key (user_id, color)
);

alter table account_color_unlocks enable row level security;

-- World-readable so other players' equipped colors resolve in-game (the equip
-- itself is validated by set_cosmetic_color; ownership rows are harmless to read).
do $$ begin
  create policy "read color unlocks" on account_color_unlocks for select using (true);
exception when duplicate_object then null; end $$;

-- Spend 200 Mano to unlock a shop color (both slots). Rejects an unknown color,
-- one already owned, or insufficient Mano.
create or replace function buy_color(p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_mano int;
  c_price constant int := 200;
  c_colors text[] := array['red','orange','yellow','green','blue','indigo','violet','grey','white','black'];
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not (p_color = any(c_colors)) then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if exists (select 1 from account_color_unlocks where user_id = v_user and color = p_color) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select mano into v_mano from account_economy where user_id = v_user for update;
  if coalesce(v_mano, 0) < c_price then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'mano', coalesce(v_mano, 0));
  end if;

  update account_economy set mano = mano - c_price where user_id = v_user returning mano into v_mano;
  insert into account_color_unlocks (user_id, color) values (v_user, p_color) on conflict do nothing;
  return jsonb_build_object('ok', true, 'color', p_color, 'mano', v_mano);
end; $$;
grant execute on function buy_color(text) to authenticated;

-- Equip a name/banner color: a level tier (gated by level) OR an owned shop
-- color (either slot). Null clears to the default.
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
  select vv_level_from_xp(coalesce(xp, 0)) into v_level from account_economy where user_id = v_user;
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
