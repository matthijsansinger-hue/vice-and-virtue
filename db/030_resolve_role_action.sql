-- ============================================
-- Migration 030: server-side role-action resolution (Batch 3a)
-- ============================================
-- Ports endRoleAction + chooseMurderSuccessor + checkWinner from game.ts
-- into the database so the HOST's browser no longer reads every player's
-- secret to resolve the round. Reads secrets from player_secrets; writes
-- the public outcomes (deaths, hospital, events, phase) to players/rooms.
-- The old players.* secret columns are still kept in sync by the mirror
-- trigger, so the rest of the app keeps working until the lockdown batch.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- Win check (ports winConditions.checkWinner): 'vice' | 'virtue' | null.
-- "Out" = dead or imprisoned. Murder + exactly one other active => vice.
create or replace function vv_check_winner(p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active int;
  v_murder int;
  v_vices int;
  v_virtues int;
begin
  select
    count(*),
    count(*) filter (where s.role = 'murder'),
    count(*) filter (where vv_role_camp(s.role) = 'vice'),
    count(*) filter (where vv_role_camp(s.role) = 'virtue')
  into v_active, v_murder, v_vices, v_virtues
  from players p
  join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison;

  if v_active = 2 and v_murder >= 1 then
    return 'vice';
  end if;
  if v_vices = 0 and v_virtues > 0 then return 'virtue'; end if;
  if v_virtues = 0 and v_vices > 0 then return 'vice'; end if;
  return null;
end;
$$;

grant execute on function vv_check_winner(uuid) to anon, authenticated;

-- Resolve the role-action phase. Mirrors endRoleAction exactly:
-- protects -> kills/sacrifice -> hospital(intox + correct vengeance) ->
-- Murder succession check -> achievements -> apply state -> win/advance.
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

  -- Protected targets.
  select coalesce(array_agg(s.pending_target::uuid), '{}')
    into v_protected
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and s.pending_action = 'protect' and s.pending_target is not null;

  -- Deaths from kill + sacrifice (sacrifice kills source AND target,
  -- each sparable by its own protect).
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

  -- Envy / Torment day effects, only from sources that survived.
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

  -- Hospitalizations: intox (not protected) + correct vengeance guesses
  -- (protect does NOT block vengeance).
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

  -- Murder succession: if Murder is dying and an eligible Vice remains,
  -- defer Murder's death and enter the succession sub-phase.
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

  -- ===== Achievements (read pending BEFORE clearing it) =====
  -- Kills/sacrifices that landed: same-camp victim => kill_teammate;
  -- Murder kills increment murder_kills => murder_3 / murder_5.
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

  -- Murdered while hospitalised.
  insert into user_achievements (user_id, key)
  select p.user_id, 'murdered_hospital'
  from players p
  where p.id = any(v_dead) and p.in_hospital and p.user_id is not null
  on conflict do nothing;

  -- Justice protect that actually blocked a kill/sacrifice on its target.
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

  -- Envy escape: Envy swapped, survived, and the victim died.
  if v_envy_a is not null and v_envy_b is not null and v_envy_b::uuid = any(v_dead) then
    insert into user_achievements (user_id, key)
    select user_id, 'envy_escape' from players
    where id = v_envy_a::uuid and user_id is not null
    on conflict do nothing;
  end if;

  -- ===== Apply outcomes =====
  update players set dead = true where id = any(v_dead);
  update players set in_hospital = true
    where id = any(v_hospital) and not (id = any(v_dead));
  update players set pending_action = null, pending_target = null
    where room_id = p_room_id;

  v_events := coalesce(
    (select jsonb_agg(jsonb_build_object('type','killed','target_id', q.d))
       from (select distinct u as d from unnest(v_dead) u) q),
    '[]'::jsonb);
  v_events := v_events || coalesce(
    (select jsonb_agg(jsonb_build_object('type','hospitalized','target_id', q.h))
       from (select distinct u as h from unnest(v_hospital) u) q
       where not (q.h = any(v_dead))),
    '[]'::jsonb);

  -- Envy/Torment room effects (these fields are cleared each new day).
  update rooms
    set envy_swap_a = v_envy_a, envy_swap_b = v_envy_b, torment_target = v_torment
  where id = p_room_id;

  -- Succession sub-phase?
  if v_succession and v_dying_murder is not null then
    update rooms set
      phase = 'murder_succession', phase_ends_at = null,
      pending_murder_death = v_dying_murder::text, last_events = v_events
    where id = p_room_id;
    return;
  end if;

  -- Win check on the post-resolution state.
  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null, last_events = v_events
    where id = p_room_id;
    return;
  end if;

  -- Otherwise continue to the Event Summary screen.
  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'event_summary', phase_ends_at = null, last_events = v_events
  where id = p_room_id;
end;
$$;

grant execute on function resolve_role_action(uuid) to anon, authenticated;

-- The dying Murder picks a Vice successor (ports chooseMurderSuccessor).
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
  update players set role = 'murder' where id = p_successor_id;

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

grant execute on function choose_murder_successor(uuid, uuid) to anon, authenticated;
