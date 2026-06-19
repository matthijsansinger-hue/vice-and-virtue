-- ============================================
-- Migration 080 — level-up Soul Fragments + earned name/banner colors
-- ============================================
-- (1) Every level-up now mints a Soul Fragment (on top of the existing per-
--     match XP/LP). Computed in grant_match_rewards from the level crossed.
-- (2) Cosmetic colors unlocked by account level and EQUIPPED by the player:
--       name color : Earthen 5 / Verdant 15 / Primal 25 / Noble 35 / Divine 45
--       banner col : Earthen 10 / Verdant 20 / Primal 30 / Noble 40 / Divine 50
--     The chosen tier ids live on `profiles` (publicly readable, like
--     featured_badges) so other players' banners render in-game. set_cosmetic_color
--     validates the pick against the account's level.
-- ============================================

alter table profiles add column if not exists name_color text;    -- tier id or null (default)
alter table profiles add column if not exists banner_color text;   -- tier id or null (default)

-- Account level from total XP — mirrors levelFromXp() in src/lib/economy.ts:
-- level L needs XP_LEVEL_STEP * L*(L-1)/2 cumulative XP (step = 100).
create or replace function vv_level_from_xp(p_xp int)
returns int language sql immutable as $$
  select greatest(1, floor((100 + sqrt(100.0 * 100 + 8 * 100 * greatest(0, p_xp))) / 200.0)::int);
$$;

-- Per-match rewards + a Soul Fragment for every level crossed this match.
create or replace function grant_match_rewards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_user uuid;
  v_won boolean;
  c_match_xp constant int := 30;
  c_win_bonus constant int := 20;
  c_le_win constant int := 9;
  c_le_loss constant int := 3;
begin
  for rec in select * from jsonb_array_elements(p_awards)
  loop
    v_user := (rec->>'u')::uuid;
    v_won := coalesce((rec->>'won')::boolean, false);
    if v_user is null then continue; end if;

    insert into account_match_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;

    if found then
      insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
      -- All CASEs read the OLD row values, so they stay consistent within the
      -- one UPDATE. Shards = first-three-wins-of-day (migration 077) + one per
      -- level crossed by this match's XP gain (migration 080).
      update account_economy set
        xp = xp + c_match_xp + case when v_won then c_win_bonus else 0 end,
        life_experience = life_experience + case when v_won then c_le_win else c_le_loss end,
        unopened_shards = unopened_shards
          + case
              when v_won and (last_first_win_date is null or last_first_win_date < current_date
                              or daily_win_count < 3)
              then 1 else 0 end
          + greatest(0, vv_level_from_xp(xp + c_match_xp + case when v_won then c_win_bonus else 0 end)
                        - vv_level_from_xp(xp)),
        daily_win_count = case
          when not v_won then daily_win_count
          when last_first_win_date is null or last_first_win_date < current_date then 1
          when daily_win_count < 3 then daily_win_count + 1
          else daily_win_count end,
        last_first_win_date = case when v_won then current_date else last_first_win_date end
      where user_id = v_user;
    end if;
  end loop;
end;
$$;

grant execute on function grant_match_rewards(uuid, jsonb) to anon, authenticated;

-- Equip (or clear) a name/banner color the caller has earned by level. p_kind
-- is 'name' or 'banner'; p_tier is a tier id (earthen..divine) or null to reset
-- to the default. Rejects a tier the account's level hasn't unlocked.
create or replace function set_cosmetic_color(p_kind text, p_tier text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_level int;
  v_needed int;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_kind not in ('name', 'banner') then return jsonb_build_object('ok', false, 'reason', 'kind'); end if;

  -- Clearing back to the default is always allowed.
  if p_tier is null then
    if p_kind = 'name' then update profiles set name_color = null where id = v_user;
    else update profiles set banner_color = null where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_tier not in ('earthen', 'verdant', 'primal', 'noble', 'divine') then
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
