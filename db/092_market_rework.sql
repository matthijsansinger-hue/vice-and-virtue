-- ============================================
-- Migration 092 — fold the camp abilities into the market (store) phase
-- ============================================
-- The separate `group_action` phase is removed (client-side). Its two abilities
-- move into the store:
--   1. Revealing Eye → a 150 SE potion (instant, private to the buyer): returns
--      the count of still-active Vices and Virtues.
--   2. Free a prisoner → a communal pool. Active players contribute 100 SE at a
--      time toward a prisoner's 500 SE release (`players.release_pool`, persists
--      across market phases until they're freed).
-- Plus: entering the store grants +50 SE to every non-imprisoned, non-dead
-- player (hospital included), via the idempotent `enter_store` RPC.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

-- Communal release pool, accumulated on the imprisoned player's own row. Resets
-- to 0 when they reach 500 and are freed.
alter table players add column if not exists release_pool numeric not null default 0;

-- ---------------------------------------------------------------------------
-- buy_potion — add the Revealing Eye potion (150 SE, instant, private, no target).
-- (Recreated from migration 075 with the new branch + cost.)
-- ---------------------------------------------------------------------------
create or replace function buy_potion(
  p_player_id uuid,
  p_potion text,
  p_target uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_phase text;
  v_day int;
  v_se numeric;
  v_dead boolean; v_prison boolean; v_hospital boolean;
  v_cost numeric;
  v_target_role text;
  v_target_dead boolean;
  v_armed boolean;
begin
  select p.room_id, r.phase, r.day, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_phase, v_day, v_se, v_dead, v_prison, v_hospital
  from players p join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_phase is distinct from 'store' then
    return jsonb_build_object('ok', false, 'error', 'not_store');
  end if;
  if v_dead or v_prison or v_hospital then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;

  v_cost := case p_potion
    when 'kill'          then 300
    when 'hospitalise'   then 200
    when 'protect'       then 200
    when 'camp_reveal'   then 200
    when 'eye'           then 150
    when 'vote_reveal'   then 100
    when 'minigame_mult' then 60
    when 'iron_will'     then 200
    else null end;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion');
  end if;
  -- Iron Will is only sold from round 2 onwards (migration 075).
  if p_potion = 'iron_will' and coalesce(v_day, 1) < 2 then
    return jsonb_build_object('ok', false, 'error', 'not_round_2');
  end if;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;

  -- Minigame x2 (arm once).
  if p_potion = 'minigame_mult' then
    select potion_minigame_mult into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_minigame_mult = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Vote reveal (arm once): see who votes to imprison you this consultation.
  if p_potion = 'vote_reveal' then
    select potion_vote_reveal into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_vote_reveal = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Iron Will (arm once): your imprisonment vote counts double this consultation.
  if p_potion = 'iron_will' then
    select potion_iron_will into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_iron_will = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Protection (self, arm once).
  if p_potion = 'protect' then
    select potion_protect into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_protect = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Revealing Eye (instant info, repeatable): how many Vices/Virtues are still
  -- active. Returned to the BUYER only — no flag stored.
  if p_potion = 'eye' then
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object(
      'ok', true,
      'vices', (
        select count(*) from players p join player_secrets s on s.player_id = p.id
        where p.room_id = v_room_id and not p.dead and not p.in_prison and not p.in_hospital
          and vv_role_camp(s.role) = 'vice'
      ),
      'virtues', (
        select count(*) from players p join player_secrets s on s.player_id = p.id
        where p.room_id = v_room_id and not p.dead and not p.in_prison and not p.in_hospital
          and vv_role_camp(s.role) = 'virtue'
      )
    );
  end if;

  -- Camp reveal (instant info, repeatable).
  if p_potion = 'camp_reveal' then
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    select s.role into v_target_role
    from players p join player_secrets s on s.player_id = p.id
    where p.id = p_target and p.room_id = v_room_id;
    if v_target_role is null then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true, 'camp', vv_role_camp(v_target_role));
  end if;

  -- Kill / Hospitalise (arm a target; one of each).
  if p_potion in ('kill', 'hospitalise') then
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    select p.dead into v_target_dead
    from players p where p.id = p_target and p.room_id = v_room_id;
    if v_target_dead is null or v_target_dead then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    if p_potion = 'kill' then
      select potion_kill_target is not null into v_armed
      from player_secrets where player_id = p_player_id;
      if v_armed then
        return jsonb_build_object('ok', false, 'error', 'already_bought');
      end if;
      update player_secrets set potion_kill_target = p_target
      where player_id = p_player_id;
    else
      select potion_hosp_target is not null into v_armed
      from player_secrets where player_id = p_player_id;
      if v_armed then
        return jsonb_build_object('ok', false, 'error', 'already_bought');
      end if;
      update player_secrets set potion_hosp_target = p_target
      where player_id = p_player_id;
    end if;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_potion');
end;
$$;
grant execute on function buy_potion(uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- contribute_release — put 100 SE toward freeing a prisoner. Communal: the
-- prisoner's `release_pool` accumulates (across market phases) until it hits
-- 500, at which point they're freed and the pool resets.
-- ---------------------------------------------------------------------------
create or replace function contribute_release(p_player_id uuid, p_prisoner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_se numeric;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_pin boolean; v_pdead boolean; v_pool numeric; v_freed boolean := false;
  v_user uuid;
begin
  select p.room_id, r.phase, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_phase is distinct from 'store' then
    return jsonb_build_object('ok', false, 'error', 'not_store');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;

  -- Lock the prisoner row so two simultaneous contributions can't both cross 500.
  select in_prison, dead into v_pin, v_pdead
  from players where id = p_prisoner and room_id = v_room for update;
  if not found or v_pdead or not v_pin then
    return jsonb_build_object('ok', false, 'error', 'not_prisoner');
  end if;

  update players set soul_energy = soul_energy - 100 where id = p_player_id;
  update players set release_pool = release_pool + 100
  where id = p_prisoner returning release_pool into v_pool;

  if v_pool >= 500 then
    update players set in_prison = false, release_pool = 0 where id = p_prisoner;
    select user_id into v_user from players where id = p_prisoner;
    if v_user is not null then
      insert into user_achievements (user_id, key)
      values (v_user, 'freed_prison') on conflict do nothing;
    end if;
    v_freed := true;
    v_pool := 0;
  end if;

  return jsonb_build_object('ok', true, 'freed', v_freed, 'pool', v_pool);
end;
$$;
grant execute on function contribute_release(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- enter_store — open the store + grant +50 SE. Idempotent (guards against a
-- double grant if the host's transition is retried). +50 goes to every player
-- who is NOT imprisoned and NOT dead — hospital players included.
-- ---------------------------------------------------------------------------
create or replace function enter_store(p_room_id uuid, p_ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select phase from rooms where id = p_room_id) = 'store' then
    return;
  end if;
  update players set soul_energy = soul_energy + 50
  where room_id = p_room_id and not in_prison and not dead;
  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'store', phase_ends_at = p_ends_at where id = p_room_id;
end;
$$;
grant execute on function enter_store(uuid, timestamptz) to anon, authenticated;
