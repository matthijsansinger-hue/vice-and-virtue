-- ============================================
-- Migration 056: card ability rework
-- ============================================
-- Reworks six abilities. Run this whole file once in the Supabase SQL Editor.
--   * Certainty: reveal cost 100 -> 125 SE.
--   * Empathy: gains a 2nd ability (reveal one player's camp for 100 SE).
--   * Vengeance: normal ability = hospitalise a target for 150 SE (reuses the
--     'intox' action). Once imprisoned, may kill — one per day, 150 SE, protect
--     can block — a player who voted to jail her. The room permanently
--     remembers her jailers in rooms.vengeance_imprisoners.
--   * Vice Worshipper / Virtue Seeker: replace the camp broadcast with two
--     abilities — reveal yourself privately to a player (100 SE), or guess the
--     counterpart (100 SE): a correct worshipper_guess kills the Virtue Seeker
--     (protect blocks); a correct seeker_guess imprisons the Vice Worshipper.
--   * Sacrifice: take multiple players — first free, each extra costs 200 SE
--     (paid at sacrifice time). pending_target holds a JSON array of ids.
--     Cannot be used while imprisoned (enforced client-side + in instant_sacrifice).
-- ============================================

-- ---- New state -----------------------------------------------------------

-- Who voted to imprison Vengeance, accumulated for the whole game. SECRET:
-- read only by the SECURITY DEFINER revenge RPCs, never exposed in
-- PUBLIC_ROOM_COLS or realtime.
alter table rooms add column if not exists vengeance_imprisoners jsonb not null default '[]'::jsonb;

-- Private per-player notices (e.g. "X revealed themselves: Vice Worshipper").
-- Locked: no RLS policies, so reachable only through get_my_secrets +
-- reveal_self (both SECURITY DEFINER). Not in the realtime publication.
create table if not exists player_notices (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  recipient_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
alter table player_notices enable row level security;
create index if not exists player_notices_recipient_idx on player_notices (recipient_id);

-- ---- Certainty: 100 -> 125 SE --------------------------------------------
create or replace function reveal_role(p_player_id uuid, p_target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_caller_role text;
  v_target_role text;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_caller_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_caller_role is distinct from 'certainty'
     or v_acted or v_se < 125 then
    return null;
  end if;

  select s.role into v_target_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_target_id and p.room_id = v_room_id;

  if v_target_role is null then
    return null;
  end if;

  update players
  set soul_energy = soul_energy - 125, acted_this_day = true
  where id = p_player_id;

  return v_target_role;
end;
$$;
grant execute on function reveal_role(uuid, uuid) to anon, authenticated;

-- ---- Empathy 2nd ability: reveal one player's camp (100 SE) --------------
create or replace function reveal_camp(p_player_id uuid, p_target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_caller_role text;
  v_target_role text;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_caller_role
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_caller_role is distinct from 'empathy'
     or v_acted or v_se < 100 then
    return null;
  end if;

  select s.role into v_target_role
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_target_id and p.room_id = v_room_id;

  if v_target_role is null then
    return null;
  end if;

  update players
  set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  return vv_role_camp(v_target_role); -- 'vice' | 'virtue'
end;
$$;
grant execute on function reveal_camp(uuid, uuid) to anon, authenticated;

-- ---- Worshipper / Seeker: reveal yourself to a player (100 SE) -----------
create or replace function reveal_self(p_player_id uuid, p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_role text;
  v_name text;
  v_role_name text;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role, p.name
    into v_room_id, v_se, v_acted, v_role, v_name
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_role not in ('vice_worshipper','virtue_seeker')
     or v_acted or v_se < 100 then
    return false;
  end if;

  if not exists (select 1 from players where id = p_target_id and room_id = v_room_id) then
    return false;
  end if;

  v_role_name := case v_role when 'vice_worshipper' then 'Vice Worshipper'
                             else 'Virtue Seeker' end;

  update players
  set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  insert into player_notices (room_id, recipient_id, text)
  values (v_room_id, p_target_id, v_name || ' revealed themselves to you: ' || v_role_name);

  return true;
end;
$$;
grant execute on function reveal_self(uuid, uuid) to anon, authenticated;

-- ---- Vengeance revenge (while imprisoned) --------------------------------
-- Alive jailers she may still kill, for her UI (keeps the secret list server-side).
create or replace function vengeance_revenge_targets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_role text;
  v_prison boolean;
  v_list jsonb;
begin
  select p.room_id, s.role, p.in_prison into v_room, v_role, v_prison
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'vengeance' or not v_prison then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name)), '[]'::jsonb)
    into v_list
  from rooms rm
  join players pl on pl.room_id = rm.id and not pl.dead
  where rm.id = v_room and rm.vengeance_imprisoners ? pl.id::text;

  return v_list;
end;
$$;
grant execute on function vengeance_revenge_targets(uuid) to anon, authenticated;

-- Queue a revenge kill (validated). Reuses the normal 'kill' resolution, so
-- Justice protect can block it.
create or replace function queue_vengeance_revenge(p_player_id uuid, p_target uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_se numeric;
  v_role text;
  v_prison boolean;
  v_acted boolean;
begin
  select p.room_id, p.soul_energy, s.role, p.in_prison, p.acted_this_day
    into v_room, v_se, v_role, v_prison, v_acted
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'vengeance'
     or not v_prison or v_acted or v_se < 150 then
    return false;
  end if;

  if not exists (select 1 from rooms where id = v_room and vengeance_imprisoners ? p_target::text)
     or not exists (select 1 from players where id = p_target and room_id = v_room and not dead) then
    return false;
  end if;

  update player_secrets set pending_action = 'kill', pending_target = p_target::text
  where player_id = p_player_id;
  update players set soul_energy = soul_energy - 150, acted_this_day = true
  where id = p_player_id;

  return true;
end;
$$;
grant execute on function queue_vengeance_revenge(uuid, uuid) to anon, authenticated;

-- ---- resolve_role_action (adds worshipper/seeker guesses + multi-sacrifice)
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

  -- Kills + sacrifices. 'kill' targets one player; 'sacrifice' kills the actor
  -- plus a JSON array of targets (each protect-checked).
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

  -- Worshipper / Seeker counterpart guesses.
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
grant execute on function resolve_role_action(uuid) to anon, authenticated;

-- ---- resolve_consultation (capture Vengeance's jailers) ------------------
create or replace function resolve_consultation(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skip int := 0;
  v_imprisoned text;
  v_winner text;
begin
  select count(*) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, count(*) as c
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.in_prison and not p.dead and not p.in_hospital
      and s.vote is not null and s.vote <> 'skip'
    group by s.vote
  ),
  mx as (select coalesce(max(c), 0) as m from tally)
  select case
    when (select m from mx) > 0
     and (select m from mx) > v_skip
     and (select count(*) from tally, mx where tally.c = mx.m) = 1
    then (select target from tally, mx where tally.c = mx.m limit 1)
    else null
  end
  into v_imprisoned;

  if v_imprisoned is not null then
    update players set in_prison = true where id = v_imprisoned::uuid;
    -- If the imprisoned player is Vengeance, permanently remember her jailers.
    if exists (select 1 from player_secrets where player_id = v_imprisoned::uuid and role = 'vengeance') then
      update rooms set vengeance_imprisoners = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
        from (
          select jsonb_array_elements_text(vengeance_imprisoners) as e
            from rooms where id = p_room_id
          union
          select p.id::text
          from players p join player_secrets s on s.player_id = p.id
          where p.room_id = p_room_id
            and not p.in_prison and not p.dead and not p.in_hospital
            and s.vote = v_imprisoned
        ) u
      )
      where id = p_room_id;
    end if;
  end if;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null,
      last_imprisoned_player = v_imprisoned
    where id = p_room_id;
    return;
  end if;

  update rooms set
    phase = 'new_day',
    phase_ends_at = now() + interval '4 seconds',
    last_imprisoned_player = v_imprisoned
  where id = p_room_id;
end;
$$;
grant execute on function resolve_consultation(uuid) to anon, authenticated;

-- ---- instant_sacrifice (multi-target, pay 200/extra, no prison) ----------
drop function if exists instant_sacrifice(uuid, uuid, uuid);
create or replace function instant_sacrifice(
  p_room_id uuid, p_player_id uuid, p_targets jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner text;
  v_se numeric;
  v_prison boolean;
  v_count int;
  v_cost numeric;
begin
  select soul_energy, in_prison into v_se, v_prison from players where id = p_player_id;
  if v_prison then return; end if; -- cannot sacrifice while imprisoned
  v_count := jsonb_array_length(coalesce(p_targets, '[]'::jsonb));
  if v_count < 1 then return; end if;
  v_cost := greatest(0, v_count - 1) * 200;
  if v_se < v_cost then return; end if; -- can't afford the extra kills

  update players set dead = true, acted_this_day = true,
    soul_energy = soul_energy - v_cost
  where id = p_player_id;
  update players set dead = true
  where room_id = p_room_id
    and id in (select e::uuid from jsonb_array_elements_text(p_targets) e);

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = p_room_id;
  end if;
end;
$$;
grant execute on function instant_sacrifice(uuid, uuid, jsonb) to anon, authenticated;

-- ---- get_my_secrets (adds notices) ---------------------------------------
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
  v_notices jsonb;
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

  select coalesce(
    jsonb_agg(jsonb_build_object('id', n.id, 'text', n.text) order by n.created_at),
    '[]'::jsonb)
    into v_notices
  from player_notices n where n.recipient_id = p_player_id;

  select jsonb_build_object(
    'role', ps.role, 'vote', ps.vote,
    'pending_action', ps.pending_action, 'pending_target', ps.pending_target,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'notices', v_notices)
  into v
  from player_secrets ps where ps.player_id = p_player_id;

  return coalesce(v, jsonb_build_object(
    'role', null, 'vote', null, 'pending_action', null, 'pending_target', null,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'notices', v_notices));
end;
$$;
grant execute on function get_my_secrets(uuid) to anon, authenticated;
