-- ============================================
-- Migration 036: the lockdown (Batch 4, step 2)  ***the actual hide***
-- ============================================
-- Moves the remaining WRITES into the database (so secrets are written to
-- player_secrets, never players.*), then DROPS the players.role/vote/
-- pending_action/pending_target columns — the moment roles/votes stop
-- being sent to any browser (including over realtime).
--
-- player_secrets already holds all this data, so if a write path was
-- missed the symptom is a loud "column ... does not exist" error, and you
-- can recover by re-adding a column and backfilling from player_secrets:
--   alter table players add column role text;
--   update players p set role = s.role from player_secrets s where s.player_id = p.id;
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- ---- New write RPCs (write player_secrets; keep public fields on players) ----

-- Cast a vote (consultation or group action). Sets the public has_voted.
create or replace function submit_vote(p_player_id uuid, p_vote text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets set vote = p_vote where player_id = p_player_id;
  update players set has_voted = (p_vote is not null) where id = p_player_id;
end;
$$;

grant execute on function submit_vote(uuid, text) to anon, authenticated;

-- Queue a role-action ability, spending Soul Energy.
create or replace function queue_action(
  p_player_id uuid, p_cost numeric, p_action text, p_target text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets
    set pending_action = p_action, pending_target = p_target
  where player_id = p_player_id;
  update players
    set soul_energy = soul_energy - p_cost, acted_this_day = true
  where id = p_player_id;
end;
$$;

grant execute on function queue_action(uuid, numeric, text, text) to anon, authenticated;

-- Clear every vote in a room (start of a voting phase).
create or replace function clear_room_votes(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets set vote = null
  where player_id in (select id from players where room_id = p_room_id);
  update players set has_voted = false where room_id = p_room_id;
end;
$$;

grant execute on function clear_room_votes(uuid) to anon, authenticated;

-- Assign roles + start the game, entirely server-side, so even the host
-- never receives the role list (ports assignRoles + startGame).
create or replace function assign_roles_and_start(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_player record;
  v_i int := 1;
begin
  select count(*) into v_total from players where room_id = p_room_id;
  v_vice := floor(v_total / 2.0);
  v_virtue := v_total - v_vice;

  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array['murder','intoxication','envy','torment','vengeance'])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array['empathy','justice','certainty','truthfulness','sacrifice'])[i],
      'virtue_seeker'));
  end loop;

  -- Shuffle the role list; players are taken in their natural order.
  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action, pending_target)
    values (v_player.id, v_roles[v_i], null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  update rooms set
    status = 'in_game', phase = 'game_overview',
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1
  where id = p_room_id;
end;
$$;

grant execute on function assign_roles_and_start(uuid) to anon, authenticated;

-- ---- Update existing functions to clear/write player_secrets ----

-- Murder succession: write the new Murder's role to player_secrets.
create or replace function choose_murder_successor(p_room_id uuid, p_successor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dying text;
  v_events jsonb;
  v_winner text;
begin
  select pending_murder_death into v_dying from rooms where id = p_room_id;
  if v_dying is null then return; end if;

  update players set dead = true where id = v_dying::uuid;
  update player_secrets set role = 'murder' where player_id = p_successor_id;

  select coalesce(last_events, '[]'::jsonb)
         || jsonb_build_object('type','killed','target_id', v_dying)
    into v_events from rooms where id = p_room_id;

  update rooms set
    pending_murder_death = null,
    recent_successor_id = p_successor_id::text,
    last_events = v_events
  where id = p_room_id;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = p_room_id;
    return;
  end if;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'event_summary', phase_ends_at = null where id = p_room_id;
end;
$$;

-- Tie-breaker re-vote: clear votes in player_secrets + has_voted.
create or replace function start_revote(p_room_id uuid, p_candidate_ids jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets set vote = null
  where player_id in (select id from players where room_id = p_room_id);
  update players set has_voted = false where room_id = p_room_id;
  update rooms set
    revote_candidates = p_candidate_ids,
    phase_ends_at = now() + interval '95 seconds'
  where id = p_room_id;
end;
$$;

-- Role-action resolution: clear queued actions in player_secrets.
-- (Only the action-clear line changed from migration 030.)
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
  v_envy_a text;
  v_envy_b text;
  v_torment text;
  v_dying_murder uuid;
  v_succession boolean := false;
  v_candidates int;
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
      if not (r.tgt::uuid = any(v_protected)) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
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

  select p.id into v_dying_murder
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and s.role = 'murder' and p.id = any(v_dead)
  limit 1;

  if v_dying_murder is not null then
    select count(*) into v_candidates
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and p.id <> v_dying_murder
      and vv_role_camp(s.role) = 'vice'
      and not p.dead and not p.in_prison and not p.in_hospital
      and not (p.id = any(v_dead));
    if v_candidates > 0 then
      v_succession := true;
      v_dead := array_remove(v_dead, v_dying_murder);
    end if;
  end if;

  for r in
    select p.id, p.user_id, p.murder_kills, s.role,
           s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('kill','sacrifice') and s.pending_target is not null
  loop
    if r.tgt::uuid = any(v_dead) then
      if r.user_id is not null and vv_role_camp(r.role) is not null
         and vv_role_camp(r.role) = (
           select vv_role_camp(s2.role) from player_secrets s2 where s2.player_id = r.tgt::uuid
         ) then
        insert into user_achievements (user_id, key)
        values (r.user_id, 'kill_teammate') on conflict do nothing;
      end if;
      if r.act = 'kill' and r.role = 'murder' then
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
        or (k.pending_action = 'sacrifice'
            and (k.pending_target = ps.pending_target
                 or k.player_id::text = ps.pending_target))
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
  -- Clear queued actions in player_secrets (was players.* before lockdown).
  update player_secrets set pending_action = null, pending_target = null
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

  if v_succession and v_dying_murder is not null then
    update rooms set
      phase = 'murder_succession', phase_ends_at = null,
      pending_murder_death = v_dying_murder::text, last_events = v_events
    where id = p_room_id;
    return;
  end if;

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

-- Group action resolution: clear votes in player_secrets when opening the
-- consultation. (Only the vote-clear lines changed from migration 034.)
create or replace function resolve_group_action(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eye_left int;
  v_free_left int;
  v_eye_yes int;
  v_eye_no int;
  v_eye_fires boolean;
  v_freed text;
  v_free_topn int;
  v_freed_user uuid;
begin
  select eye_uses_left, free_uses_left into v_eye_left, v_free_left
  from rooms where id = p_room_id;

  select
    count(*) filter (where s.vote = 'eye_yes'),
    count(*) filter (where s.vote = 'eye_no')
  into v_eye_yes, v_eye_no
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.dead and not p.in_prison and not p.in_hospital
    and vv_role_camp(s.role) = 'vice';
  v_eye_fires := v_eye_left > 0 and v_eye_yes > v_eye_no;

  v_freed := null;
  if v_free_left > 0 then
    with fv as (
      select s.vote as target, count(*) as c
      from players p join player_secrets s on s.player_id = p.id
      where p.room_id = p_room_id
        and not p.dead and not p.in_prison and not p.in_hospital
        and vv_role_camp(s.role) = 'virtue' and s.vote is not null
      group by s.vote
    ), mx as (select coalesce(max(c), 0) as m from fv)
    select
      (select count(*) from fv, mx where fv.c = mx.m and mx.m > 0),
      (select target from fv, mx where fv.c = mx.m and mx.m > 0 limit 1)
    into v_free_topn, v_freed;

    if v_free_topn = 1 and v_freed is not null and v_freed <> 'no_free' then
      if not exists (
        select 1 from players where id = v_freed::uuid and in_prison and not dead
      ) then
        v_freed := null;
      end if;
    else
      v_freed := null;
    end if;
  end if;

  if v_freed is not null then
    update players set in_prison = false where id = v_freed::uuid;
    select user_id into v_freed_user from players where id = v_freed::uuid;
    if v_freed_user is not null then
      insert into user_achievements (user_id, key)
      values (v_freed_user, 'freed_prison') on conflict do nothing;
    end if;
  end if;

  update rooms set
    eye_revealed = v_eye_fires,
    eye_uses_left = case when v_eye_fires then greatest(0, v_eye_left - 1) else v_eye_left end,
    group_action_freed_id = v_freed,
    free_uses_left = case when v_freed is not null then greatest(0, v_free_left - 1) else v_free_left end
  where id = p_room_id;

  -- Open the consultation: clear votes in player_secrets + has_voted.
  update player_secrets set vote = null
  where player_id in (select id from players where room_id = p_room_id);
  update players set has_voted = false where room_id = p_room_id;
  update rooms set
    phase = 'consultation', vote_reveal = false,
    phase_ends_at = now() + interval '95 seconds'
  where id = p_room_id;
end;
$$;

-- ---- Drop the bridge triggers, then the secret columns ----
drop trigger if exists trg_mirror_player_secrets on players;
drop trigger if exists trg_sync_has_voted on players;

alter table players drop column if exists role;
alter table players drop column if exists vote;
alter table players drop column if exists pending_action;
alter table players drop column if exists pending_target;
