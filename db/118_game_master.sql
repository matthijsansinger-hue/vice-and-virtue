-- Migration 118 — the Game Master (second anomaly) + anomaly picking
--
-- A second neutral anomaly, and with more than one the anomaly seat stops being
-- auto-assigned: the player picks which anomaly to play on the SAME role_select
-- screen where everyone else picks their role. More anomalies can be added by
-- extending vv_role_camp and the anomaly list — nothing else needs to change.
--
-- THE GAME MASTER wants the game to go the distance. He wins ALONE if the game
-- is still running at round 9 (both camps lose, like the Soul's escape). To get
-- there he has three lives and can pull people out of prison — including
-- himself — for 100 SE, once a day.
--
-- The 100 SE release deliberately UNDERCUTS the communal prison fund (500 SE
-- pooled, migration 092): he keeps players in the game cheaply, which is exactly
-- what a longer game needs. It runs in Role action rather than the Market so a
-- jailed Game Master can still use it — the same exception imprisoned Vengeance
-- already has.
--
-- His three lives reuse the extra-lives buffer (migration 066), so kills and
-- hospitalisations are absorbed by the machinery that already exists.

begin;

-- Once-a-day marker for the release, and which anomaly won (public: it's only
-- ever set as the game ends, and the victory screen needs to know which story
-- to tell).
alter table player_secrets add column if not exists gm_free_day int;
alter table rooms add column if not exists anomaly_win text;

-- The Game Master is neutral, like the Soul. Without this he counts for neither
-- camp in the win check, the Quiz's scoring, or conversion — which is exactly
-- what an anomaly should be, but it has to be stated.
create or replace function vv_role_camp(p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_role in
      ('murder','intoxication','envy','torment','vengeance','vice_worshipper',
       'wrath','gambling','fanaticism','pride','greed')
      then 'vice'
    when p_role in
      ('empathy','justice','truthfulness','certainty','sacrifice','virtue_seeker',
       'love','determination','generosity','diligence','sociability')
      then 'virtue'
    when p_role in ('wandering_soul','game_master') then 'neutral'
    else null
  end;
$$;

-- The anomaly seat is dealt empty so it can be chosen.
create or replace function assign_roles_and_start_impl(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_config jsonb;
  v_total int;
  v_soul int;     -- 1 on odd counts (the Wandering Soul), else 0
  v_rest int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_ids uuid[];
  v_vice_classes text[];
  v_virtue_classes text[];
  v_player record;
  v_i int := 1;
  v_j int;
  v_camp text;
  v_class text;
  v_filler text;
  -- Exterminator/Protector are dealt FIRST so every game has something that
  -- can kill and something that can save; the other three are shuffled for
  -- variety. A camp of 2-3 (small games) therefore always gets the guaranteed
  -- pair plus random extras, rather than risking a game nothing can end.
  c_vice_classes text[] := array['exterminator']
    || (select array_agg(c order by random())
        from unnest(array['troublemaker','obstructor','manipulator']) c);
  c_virtue_classes text[] := array['protector']
    || (select array_agg(c order by random())
        from unnest(array['communicator','seeker','catalyst']) c);
  -- Per-class defaults for the random deal, used when the host configured
  -- nothing for that slot. Every one is in the free starter set.
  c_vice_default jsonb := jsonb_build_object(
    'exterminator', 'murder', 'troublemaker', 'torment',
    'obstructor', 'intoxication', 'manipulator', 'envy');
  c_virtue_default jsonb := jsonb_build_object(
    'protector', 'generosity', 'communicator', 'truthfulness',
    'seeker', 'empathy', 'catalyst', 'justice');
begin
  select role_assign_mode, role_config into v_mode, v_config
  from rooms where id = p_room_id;

  select count(*) into v_total from players where room_id = p_room_id;
  -- Odd counts get one neutral Wandering Soul so the remainder splits evenly.
  v_soul := v_total % 2;
  v_rest := v_total - v_soul;
  v_vice := floor(v_rest / 2.0);
  v_virtue := v_rest - v_vice;

  if v_mode = 'choose' then
    -- Deal camps + tiers only; roles are picked live in role_select. The Soul
    -- (when present) is the first shuffled player: role auto-locked, no pick.
    select array_agg(id order by random()) into v_ids
    from players where room_id = p_room_id;

    -- One class per seat, in order, so the guaranteed pair lands first. Seats
    -- past the four classes get NULL and are dealt the filler role below.
    select array_agg(c_vice_classes[i] order by i) into v_vice_classes
    from generate_series(1, v_vice) i;
    select array_agg(c_virtue_classes[i] order by i) into v_virtue_classes
    from generate_series(1, v_virtue) i;

    for v_i in 1..v_total loop
      if v_soul = 1 and v_i = 1 then
        -- The anomaly seat is dealt EMPTY (migration 118): with more than one
        -- anomaly in the game the player chooses which to play, on the same
        -- role_select screen as everyone else. It used to be auto-locked to the
        -- Wandering Soul because he was the only one.
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_class,
                                    role_choice)
        values (v_ids[1], null, null, null, null, 'neutral', null, null)
        on conflict (player_id) do update
          set role = null, vote = null, pending_action = null,
              pending_target = null, role_choice = null,
              assigned_camp = 'neutral', assigned_class = null;
      else
        v_j := v_i - v_soul;  -- 1..v_rest
        v_camp := case when v_j <= v_vice then 'vice' else 'virtue' end;
        v_class := case when v_j <= v_vice then v_vice_classes[v_j]
                        else v_virtue_classes[v_j - v_vice] end;
        -- No class left for this seat: it's a filler. Deal the filler role
        -- outright and lock it (same shape as the Soul) instead of dropping the
        -- player into role_select with nothing they could possibly pick.
        v_filler := case when v_class is null then
          case when v_camp = 'virtue' then 'virtue_seeker' else 'vice_worshipper' end
        end;
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_class,
                                    role_choice)
        values (v_ids[v_i], v_filler, null, null, null, v_camp, v_class, v_filler)
        on conflict (player_id) do update
          set role = excluded.role, vote = null, pending_action = null,
              pending_target = null, role_choice = excluded.role_choice,
              assigned_camp = excluded.assigned_camp,
              assigned_class = excluded.assigned_class;
      end if;
      update players set soul_energy = 100, ready = false, has_voted = false
      where id = v_ids[v_i];
    end loop;

    update rooms set
      status = 'in_game', phase = 'role_select',
      phase_ends_at = now() + interval '30 seconds',
      role_pool = null, eye_uses_left = 1, free_uses_left = 1, winner = null
    where id = p_room_id;
    return;
  end if;

  -- 'random': secret deal. CLASS slots come from the host's config when valid.
  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'vice', c_vice_classes[1],
                       c_vice_default #>> array[c_vice_classes[1]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[2],
                       c_vice_default #>> array[c_vice_classes[2]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[3],
                       c_vice_default #>> array[c_vice_classes[3]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[4],
                       c_vice_default #>> array[c_vice_classes[4]])
      ])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'virtue', c_virtue_classes[1],
                       c_virtue_default #>> array[c_virtue_classes[1]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[2],
                       c_virtue_default #>> array[c_virtue_classes[2]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[3],
                       c_virtue_default #>> array[c_virtue_classes[3]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[4],
                       c_virtue_default #>> array[c_virtue_classes[4]])
      ])[i],
      'virtue_seeker'));
  end loop;
  -- Odd count: add the neutral Wandering Soul to the deal.
  if v_soul = 1 then
    -- Random mode has no picking, so the anomaly is chosen for them.
    v_roles := array_append(v_roles,
      (array['wandering_soul','game_master'])[1 + floor(random() * 2)::int]);
  end if;

  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action,
                                pending_target, assigned_camp, assigned_class,
                                role_choice)
    values (v_player.id, v_roles[v_i], null, null, null, null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null,
          assigned_camp = null, assigned_class = null, role_choice = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  update rooms set
    status = 'in_game', phase = 'role_overview', phase_ends_at = null,
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1, winner = null
  where id = p_room_id;
end;
$$;
revoke all on function assign_roles_and_start_impl(uuid) from public, anon, authenticated;

-- Picking: a neutral seat chooses among the anomalies.
create or replace function select_role_impl(p_player_id uuid, p_role text, p_lock boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_class text; v_locked boolean;
  v_user uuid;
  c_default text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker','generosity'];  -- generosity is free so Protectors has a
                                    -- free option like every other class
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_class,
         (s.role is not null), p.user_id
    into v_room, v_phase, v_camp, v_class, v_locked, v_user
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_locked then
    return false;
  end if;
  -- The anomaly seat (camp 'neutral') has no class: it picks among the anomaly
  -- roles instead. Anomalies are outside the unlock economy, so no ownership
  -- check applies to them.
  if v_camp = 'neutral' then
    if vv_role_camp(p_role) is distinct from 'neutral' then
      return false;
    end if;
    update player_secrets
    set role_choice = p_role,
        role = case when p_lock then p_role else role end,
        -- The Game Master's three lives are part of the role, so they're granted
        -- the moment it's locked in rather than at some later phase hook.
        extra_lives = case when p_lock and p_role = 'game_master'
                           then 3 else extra_lives end
    where player_id = p_player_id;
    return true;
  end if;

  -- Must be a real role matching the dealt camp + CLASS (an unknown id yields
  -- null from both lookups and fails either comparison). A filler seat has a
  -- null class and its role is already locked, so it never reaches here.
  if vv_role_camp(p_role) is distinct from v_camp
     or vv_role_class(p_role) is distinct from v_class then
    return false;
  end if;
  -- Beyond the default set, the player's account must have unlocked the role.
  if not (p_role = any(c_default)) then
    if v_user is null or not exists (
      select 1 from account_role_unlocks u
      where u.user_id = v_user and u.role = p_role
    ) then
      return false;
    end if;
  end if;

  update player_secrets
  set role_choice = p_role,
      role = case when p_lock then p_role else role end
  where player_id = p_player_id;
  return true;
end;
$$;
revoke all on function select_role_impl(uuid, text, boolean) from public, anon, authenticated;

create or replace function resolve_role_select_impl(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_role text;
  r record;
  c_playable text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker','generosity'];
begin
  select phase into v_phase from rooms where id = p_room_id;
  if v_phase is distinct from 'role_select' then return; end if;

  for r in
    select p.id, s.assigned_camp, s.assigned_class, s.role_choice
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is null
  loop
    v_role := r.role_choice;
    if v_role is null and r.assigned_camp = 'neutral' then
      -- An anomaly who never picked gets one at random.
      select x into v_role
      from unnest(array['wandering_soul','game_master']) x
      order by random() limit 1;
    end if;
    if v_role is null then
      select x into v_role from unnest(c_playable) x
      where vv_role_camp(x) = r.assigned_camp and vv_role_class(x) = r.assigned_class
      order by random() limit 1;
    end if;
    if v_role is null then
      v_role := case when r.assigned_camp = 'virtue'
                     then 'virtue_seeker' else 'vice_worshipper' end;
    end if;
    update player_secrets
    set role = v_role, role_choice = v_role,
        extra_lives = case when v_role = 'game_master' then 3 else extra_lives end
    where player_id = r.id;
  end loop;

  update rooms set role_pool = (
    select jsonb_agg(distinct s.role)
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is not null
  ) where id = p_room_id;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'role_overview', phase_ends_at = null
  where id = p_room_id;
end;
$$;
revoke all on function resolve_role_select_impl(uuid) from public, anon, authenticated;

-- Pull someone out of prison for 100 SE, once a day. Works on HIMSELF too,
-- which is the point of running it in Role action: a jailed Game Master would
-- otherwise be a spectator, and his whole plan is to keep the game alive.
create or replace function gm_free_prisoner(p_player_id uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_se numeric; v_day int; v_phase text;
  v_dead boolean; v_used int;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.soul_energy, r.day, r.phase, p.dead, s.gm_free_day
    into v_room, v_role, v_se, v_day, v_phase, v_dead, v_used
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'game_master' then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  -- Note: NOT blocked by in_prison. Being jailed is precisely when he needs it.
  if v_dead then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if v_used is not distinct from v_day then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', 100);
  end if;
  if not exists (select 1 from players
                 where id = p_target and room_id = v_room and in_prison and not dead) then
    return jsonb_build_object('ok', false, 'reason', 'not_imprisoned');
  end if;

  update players set in_prison = false where id = p_target;
  update players set soul_energy = soul_energy - 100 where id = p_player_id;
  update player_secrets set gm_free_day = v_day where player_id = p_player_id;

  -- Freeing only ever ADDS an active player, so it can't end the game and needs
  -- no win check (same reasoning as the communal release in migration 092).
  return jsonb_build_object('ok', true, 'freed', p_target);
end;
$$;
grant execute on function gm_free_prisoner(uuid, uuid) to anon, authenticated;

-- Round 9 and still playing: the Game Master has done what he set out to do and
-- wins alone. Called by the host right after the day advances — an OVERRIDE in
-- the same style as resolve_soul_escape / resolve_soul_last_standing, so none of
-- the big resolvers need to learn about a third winner.
create or replace function resolve_gm_endurance(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_day int; v_status text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;

  select day, status into v_day, v_status from rooms where id = p_room_id;
  if v_status is distinct from 'in_game' or coalesce(v_day, 1) < 9 then
    return false;
  end if;
  if not exists (
    select 1 from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role = 'game_master' and not p.dead
  ) then
    return false;
  end if;

  update rooms
     set winner = 'neutral', anomaly_win = 'gm_endurance',
         phase = 'soul_victory_intro', phase_ends_at = null
   where id = p_room_id;
  update players set ready = false where room_id = p_room_id;
  return true;
end;
$$;
grant execute on function resolve_gm_endurance(uuid) to anon, authenticated;

commit;
