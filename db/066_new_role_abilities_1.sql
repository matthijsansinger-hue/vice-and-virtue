-- ============================================
-- New-role abilities, batch 1 (migration 066).
-- ============================================
-- Wires the five reusable new roles + the shared "extra lives" system:
--   * Determination — buy stackable extra lives (100 SE each).
--   * Generosity    — gift 100 SE, or grant a player an extra life (200 SE).
--   * Gambling       — pick 1-6 + a target, roll a die, kill on a match (100 SE).
--   * Pride          — reveal yourself to a random player who then scores 0 in
--                      the minigame (100 SE).
--   * Diligence      — passive: a wrong minigame tag won't zero the round; pay
--                      100 SE on the result screen to count your correct reads.
--
-- An extra life is a stored buffer that absorbs a would-be kill (then a
-- hospitalisation), spending one each — handled in resolve_role_action.
-- (Consultation instant-Sacrifice bypasses it, like it bypasses protect.)

alter table player_secrets
  add column if not exists extra_lives integer not null default 0,
  add column if not exists minigame_correct integer;

alter table rooms add column if not exists pride_target text;

-- Pride's private "X is Pride" reveal uses the player_notices table (migration
-- 056). Safe no-op if it already exists.
create table if not exists player_notices (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  recipient_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
alter table player_notices enable row level security;
create index if not exists player_notices_recipient_idx on player_notices (recipient_id);

-- ---- resolve_role_action: extra-life absorption ---------------------------
create or replace function resolve_role_action(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_imprisoned text;
  v_protected uuid[] := '{}';
  v_dead uuid[] := '{}';
  v_hospital uuid[] := '{}';
  v_imprison uuid[] := '{}';
  v_envy_a text;
  v_envy_b text;
  v_torment text;
  v_events jsonb;
  v_winner text;
  r record;
  v_newtotal int;
begin
  select last_imprisoned_player into v_last_imprisoned from rooms where id = p_room_id;

  select coalesce(array_agg(s.pending_target::uuid), '{}')
    into v_protected
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and s.pending_action = 'protect' and s.pending_target is not null;

  v_protected := v_protected || coalesce((
    select array_agg(s.player_id)
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.potion_protect and not p.dead
  ), '{}'::uuid[]);

  for r in
    select p.id, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('kill','sacrifice') and s.pending_target is not null
  loop
    if r.act = 'kill' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    else
      if not (r.id = any(v_protected)) then
        v_dead := array_append(v_dead, r.id);
      end if;
      v_dead := v_dead || coalesce((
        select array_agg(e::uuid)
        from jsonb_array_elements_text(r.tgt::jsonb) e
        where not (e::uuid = any(v_protected))
      ), '{}'::uuid[]);
    end if;
  end loop;

  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s
      join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_kill_target
    where p.room_id = p_room_id and s.potion_kill_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_dead := array_append(v_dead, r.tgt);
    end if;
  end loop;

  for r in
    select p.id, p.dead as wasdead, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('envy_swap','torment') and s.pending_target is not null
  loop
    if not r.wasdead and not (r.id = any(v_dead)) then
      if r.act = 'envy_swap' then
        v_envy_a := r.id::text;
        v_envy_b := r.tgt;
      else
        v_torment := r.tgt;
      end if;
    end if;
  end loop;

  for r in
    select p.id, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('intox','vengeance_guess') and s.pending_target is not null
  loop
    if r.act = 'intox' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_hospital := array_append(v_hospital, r.tgt::uuid);
      end if;
    else
      if v_last_imprisoned is not null and exists (
        select 1 from player_secrets gs
        where gs.player_id = r.tgt::uuid and gs.vote = v_last_imprisoned
      ) then
        v_hospital := array_append(v_hospital, r.tgt::uuid);
      end if;
    end if;
  end loop;

  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s
      join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_hosp_target
    where p.room_id = p_room_id and s.potion_hosp_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_hospital := array_append(v_hospital, r.tgt);
    end if;
  end loop;

  for r in
    select s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('worshipper_guess','seeker_guess') and s.pending_target is not null
  loop
    if r.act = 'worshipper_guess' then
      if not (r.tgt::uuid = any(v_protected)) and exists (
        select 1 from player_secrets gs where gs.player_id = r.tgt::uuid and gs.role = 'virtue_seeker'
      ) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    else
      if exists (
        select 1 from player_secrets gs where gs.player_id = r.tgt::uuid and gs.role = 'vice_worshipper'
      ) then
        v_imprison := array_append(v_imprison, r.tgt::uuid);
      end if;
    end if;
  end loop;

  -- Extra lives (migration 066): a stored extra life absorbs a would-be kill
  -- first, then a would-be hospitalisation, spending one each. Done before
  -- kill-counting / achievements / win check so an absorbed kill counts as none.
  for r in
    select s.player_id as id
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.extra_lives > 0 and s.player_id = any(v_dead)
  loop
    v_dead := array_remove(v_dead, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;
  for r in
    select s.player_id as id
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.extra_lives > 0
      and s.player_id = any(v_hospital) and not (s.player_id = any(v_dead))
  loop
    v_hospital := array_remove(v_hospital, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;

  -- Murder kill counting + kill_teammate (single-target kills only).
  for r in
    select p.id, p.user_id, p.murder_kills, s.role, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action = 'kill' and s.pending_target is not null
  loop
    if r.tgt::uuid = any(v_dead) then
      if r.user_id is not null and vv_role_camp(r.role) is not null
         and vv_role_camp(r.role) = (
           select vv_role_camp(s2.role) from player_secrets s2 where s2.player_id = r.tgt::uuid
         ) then
        insert into user_achievements (user_id, key)
        values (r.user_id, 'kill_teammate') on conflict do nothing;
      end if;
      if r.role = 'murder' then
        v_newtotal := coalesce(r.murder_kills, 0) + 1;
        update players set murder_kills = v_newtotal where id = r.id;
        if r.user_id is not null then
          if v_newtotal >= 3 then
            insert into user_achievements (user_id, key)
            values (r.user_id, 'murder_3') on conflict do nothing;
          end if;
          if v_newtotal >= 5 then
            insert into user_achievements (user_id, key)
            values (r.user_id, 'murder_5') on conflict do nothing;
          end if;
        end if;
      end if;
    end if;
  end loop;

  insert into user_achievements (user_id, key)
  select p.user_id, 'murdered_hospital'
  from players p
  where p.id = any(v_dead) and p.in_hospital and p.user_id is not null
  on conflict do nothing;

  insert into user_achievements (user_id, key)
  select prot.user_id, 'justice_protect'
  from players prot join player_secrets ps on ps.player_id = prot.id
  where prot.room_id = p_room_id and ps.pending_action = 'protect'
    and ps.pending_target is not null and prot.user_id is not null
    and exists (
      select 1 from player_secrets k join players kp on kp.id = k.player_id
      where kp.room_id = p_room_id and (
        (k.pending_action = 'kill' and k.pending_target = ps.pending_target)
        or (k.pending_action = 'sacrifice' and k.player_id::text = ps.pending_target)
      )
    )
  on conflict do nothing;

  if v_envy_a is not null and v_envy_b is not null and v_envy_b::uuid = any(v_dead) then
    insert into user_achievements (user_id, key)
    select user_id, 'envy_escape' from players
    where id = v_envy_a::uuid and user_id is not null
    on conflict do nothing;
  end if;

  update players set dead = true where id = any(v_dead);
  update players set in_hospital = true
    where id = any(v_hospital) and not (id = any(v_dead));
  update players set in_prison = true
    where id = any(v_imprison) and not (id = any(v_dead));
  update player_secrets set pending_action = null, pending_target = null,
    potion_kill_target = null, potion_hosp_target = null, potion_protect = false
    where player_id in (select id from players where room_id = p_room_id);

  v_events := coalesce(
    (select jsonb_agg(jsonb_build_object('type','killed','target_id', q.d))
       from (select distinct u as d from unnest(v_dead) u) q),
    '[]'::jsonb);
  v_events := v_events || coalesce(
    (select jsonb_agg(jsonb_build_object('type','hospitalized','target_id', q.h))
       from (select distinct u as h from unnest(v_hospital) u) q
       where not (q.h = any(v_dead))),
    '[]'::jsonb);

  update rooms
    set envy_swap_a = v_envy_a, envy_swap_b = v_envy_b, torment_target = v_torment
  where id = p_room_id;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null, last_events = v_events
    where id = p_room_id;
    return;
  end if;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'event_summary', phase_ends_at = null, last_events = v_events
  where id = p_room_id;
end;
$$;
grant execute on function resolve_role_action(uuid) to anon, authenticated;

-- ---- submit_minigame_guesses: Diligence + Pride + correct-count -----------
create or replace function submit_minigame_guesses(
  p_player_id uuid,
  p_guesses jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_score numeric := 0;
  v_correct int := 0;
  v_target record;
  v_guess text;
  v_truth text;
  v_role text;
  v_pride text;
  v_diligent boolean;
begin
  select p.room_id, s.role, r.pride_target
    into v_room_id, v_role, v_pride
  from players p
    join rooms r on r.id = p.room_id
    left join player_secrets s on s.player_id = p.id
  where p.id = p_player_id and not p.dead and not p.in_prison and not p.in_hospital;
  if v_room_id is null then
    return 0;
  end if;

  if v_pride is not null and v_pride = p_player_id::text then
    update players set minigame_score = 0, minigame_submitted_at = now(), ready = true
    where id = p_player_id;
    update player_secrets set minigame_guesses = p_guesses, minigame_correct = 0
    where player_id = p_player_id;
    return 0;
  end if;

  v_diligent := (v_role = 'diligence');

  for v_target in
    select p.id, s.role
    from players p
    left join player_secrets s on s.player_id = p.id
    where p.room_id = v_room_id
      and p.id <> p_player_id
      and not p.dead
      and not p.in_prison
  loop
    v_guess := p_guesses ->> v_target.id::text;
    v_truth := vv_role_camp(v_target.role);
    if v_guess is null or v_guess = 'unknown' or v_truth is null then
      v_score := v_score + 0.4;
    elsif v_guess = v_truth then
      v_score := v_score + 1;
      v_correct := v_correct + 1;
    elsif v_diligent then
      null;
    else
      v_score := 0;
      exit;
    end if;
  end loop;

  update players
  set minigame_score = v_score,
      minigame_submitted_at = now(),
      ready = true
  where id = p_player_id;

  update player_secrets set minigame_guesses = p_guesses, minigame_correct = v_correct
  where player_id = p_player_id;

  return v_score;
end;
$$;
grant execute on function submit_minigame_guesses(uuid, jsonb) to anon, authenticated;

-- ---- get_my_secrets: surface extra_lives ----------------------------------
create or replace function get_my_secrets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_room_id uuid;
  v_dying boolean := false;
  v_succ boolean := false;
  v_torment boolean := false;
begin
  select room_id into v_room_id from players where id = p_player_id;
  if v_room_id is not null then
    select
      coalesce(pending_murder_death = p_player_id::text, false),
      coalesce(recent_successor_id = p_player_id::text, false),
      coalesce(torment_target = p_player_id::text, false)
    into v_dying, v_succ, v_torment
    from rooms where id = v_room_id;
  end if;

  select jsonb_build_object(
    'role', ps.role, 'vote', ps.vote,
    'pending_action', ps.pending_action, 'pending_target', ps.pending_target,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'extra_lives', coalesce(ps.extra_lives, 0))
  into v
  from player_secrets ps where ps.player_id = p_player_id;

  return coalesce(v, jsonb_build_object(
    'role', null, 'vote', null, 'pending_action', null, 'pending_target', null,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'extra_lives', 0));
end;
$$;
grant execute on function get_my_secrets(uuid) to anon, authenticated;

-- ---- The five abilities ----------------------------------------------------
create or replace function buy_extra_life(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_lives int;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'determination'
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;
  update player_secrets set extra_lives = extra_lives + 1
  where player_id = p_player_id returning extra_lives into v_lives;
  return jsonb_build_object('ok', true, 'extra_lives', v_lives);
end; $$;
grant execute on function buy_extra_life(uuid) to anon, authenticated;

create or replace function gift_soul_energy(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'generosity' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 or p_target_id = p_player_id
     or not exists (select 1 from players where id = p_target_id and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  update players set soul_energy = soul_energy + 100 where id = p_target_id;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function gift_soul_energy(uuid, uuid) to anon, authenticated;

create or replace function grant_extra_life(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'generosity' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 200
     or not exists (select 1 from players where id = p_target_id and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 200, acted_this_day = true where id = p_player_id;
  update player_secrets set extra_lives = extra_lives + 1 where player_id = p_target_id;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function grant_extra_life(uuid, uuid) to anon, authenticated;

create or replace function gambling_roll(p_player_id uuid, p_target_id uuid, p_guess int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_roll int; v_hit boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'gambling' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100
     or p_guess < 1 or p_guess > 6 or p_target_id = p_player_id
     or not exists (select 1 from players where id = p_target_id and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false);
  end if;
  v_roll := 1 + floor(random() * 6)::int;
  v_hit := (v_roll = p_guess);
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  if v_hit then
    update player_secrets set pending_action = 'kill', pending_target = p_target_id::text
    where player_id = p_player_id;
  end if;
  return jsonb_build_object('ok', true, 'roll', v_roll, 'hit', v_hit);
end; $$;
grant execute on function gambling_roll(uuid, uuid, int) to anon, authenticated;

create or replace function pride_reveal(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_target uuid; v_target_name text; v_my_name text;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, p.name
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp, v_my_name
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'pride' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  select p.id, p.name into v_target, v_target_name
  from players p where p.room_id = v_room and p.id <> p_player_id
    and not p.dead and not p.in_prison and not p.in_hospital
  order by random() limit 1;
  if v_target is null then return jsonb_build_object('ok', false); end if;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, v_target,
          v_my_name || ' revealed themselves to you as Pride — you will score nothing in this minigame.');
  update rooms set pride_target = v_target::text where id = v_room;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  return jsonb_build_object('ok', true, 'target_name', v_target_name);
end; $$;
grant execute on function pride_reveal(uuid) to anon, authenticated;

create or replace function diligence_count(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean; v_correct int;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day, s.minigame_correct
    into v_room, v_phase, v_se, v_role, v_acted, v_correct
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'result'
     or v_role is distinct from 'diligence' or v_acted or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  return jsonb_build_object('ok', true, 'correct', coalesce(v_correct, 0));
end; $$;
grant execute on function diligence_count(uuid) to anon, authenticated;
