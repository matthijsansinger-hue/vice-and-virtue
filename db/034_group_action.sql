-- ============================================
-- Migration 034: server-side group action + camp counts (Batch 3b-iv)
-- ============================================
-- Ports endGroupAction (reads votes + roles to tally the Eye / free-a-
-- prisoner) into resolve_group_action. group_action_ready answers the
-- host's "everyone eligible has voted?" early-advance without exposing
-- camps. count_active_camps backs the Eye reveal banner, gated so it only
-- returns counts once the Eye has actually fired.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- Tally the two camp actions, apply them, then open the consultation.
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

  -- Revealing Eye: active Vices, yes vs no.
  select
    count(*) filter (where s.vote = 'eye_yes'),
    count(*) filter (where s.vote = 'eye_no')
  into v_eye_yes, v_eye_no
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.dead and not p.in_prison and not p.in_hospital
    and vv_role_camp(s.role) = 'vice';
  v_eye_fires := v_eye_left > 0 and v_eye_yes > v_eye_no;

  -- Free a prisoner: active Virtues, most votes wins (unique, not
  -- 'no_free', and the winner is still imprisoned).
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

  -- Open the consultation (ports startConsultation).
  update players set vote = null where room_id = p_room_id;
  update rooms set
    phase = 'consultation', vote_reveal = false,
    phase_ends_at = now() + interval '95 seconds'
  where id = p_room_id;
end;
$$;

grant execute on function resolve_group_action(uuid) to anon, authenticated;

-- True when every eligible group-action voter has voted (or none are
-- eligible) — drives the host's early advance without exposing camps.
create or replace function group_action_ready(p_room_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eye_avail boolean;
  v_free_avail boolean;
  v_eligible int;
  v_voted int;
begin
  select
    (eye_uses_left > 0),
    (free_uses_left > 0 and exists (
      select 1 from players where room_id = p_room_id and in_prison and not dead))
  into v_eye_avail, v_free_avail
  from rooms where id = p_room_id;

  select
    count(*) filter (where (v_eye_avail and vv_role_camp(s.role) = 'vice')
                        or (v_free_avail and vv_role_camp(s.role) = 'virtue')),
    count(*) filter (where ((v_eye_avail and vv_role_camp(s.role) = 'vice')
                         or (v_free_avail and vv_role_camp(s.role) = 'virtue'))
                        and s.vote is not null)
  into v_eligible, v_voted
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison and not p.in_hospital;

  return v_eligible = 0 or v_voted >= v_eligible;
end;
$$;

grant execute on function group_action_ready(uuid) to anon, authenticated;

-- Active camp counts for the Eye reveal banner — only returned once the
-- Eye has fired this round (else null), so camp sizes stay secret.
create or replace function count_active_camps(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vices int;
  v_virtues int;
begin
  if not coalesce((select eye_revealed from rooms where id = p_room_id), false) then
    return null;
  end if;

  select
    count(*) filter (where vv_role_camp(s.role) = 'vice'),
    count(*) filter (where vv_role_camp(s.role) = 'virtue')
  into v_vices, v_virtues
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison;

  return jsonb_build_object('vices', v_vices, 'virtues', v_virtues);
end;
$$;

grant execute on function count_active_camps(uuid) to anon, authenticated;
