-- ============================================
-- Migration 078 — Pride costs 50 SE + Gambling becomes a true dice gamble
-- ============================================
-- Pride: ability cost lowered 100 -> 50 SE.
--
-- Gambling: no longer "pick a number + target, roll to kill". Now you just
-- roll one die (100 SE) and the FACE decides the ability:
--   1 -> you are hospitalised yourself
--   2 -> you score nothing in this round's upcoming minigame
--   3 -> your minigame Soul Energy is doubled (reuses the Minigame x2 flag)
--   4 -> hospitalise a player of your choice
--   5 -> you gain a lasting extra life
--   6 -> kill a player of your choice
-- SE is charged whatever the face (it's a gamble). Faces 4 and 6 need a target,
-- chosen AFTER the roll via gambling_pick_target. The self-hospitalise (1) and
-- the kill/hospitalise (4/6) all flow through the normal role-action resolution
-- (so Justice protect + extra lives apply exactly as for any kill/intox).
-- ============================================

-- New per-player flag for Gambling's roll of 2 (score nothing this minigame).
alter table player_secrets add column if not exists minigame_no_score boolean not null default false;

-- ---- Pride: 100 -> 50 SE --------------------------------------------------
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
     or v_dead or v_prison or v_hosp or v_se < 50 then
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
  update players set soul_energy = soul_energy - 50, acted_this_day = true where id = p_player_id;
  return jsonb_build_object('ok', true, 'target_name', v_target_name);
end; $$;
grant execute on function pride_reveal(uuid) to anon, authenticated;

-- ---- Gambling: roll the die ------------------------------------------------
-- Old signature took a chosen number + target; the new one rolls blind.
drop function if exists gambling_roll(uuid, uuid, int);

create or replace function gambling_roll(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_roll int;
  v_kind text; v_needs boolean := false;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'gambling' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;

  v_roll := 1 + floor(random() * 6)::int;
  update players set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  if v_roll = 1 then
    -- Hospitalise yourself: queue like an intox so protect + extra lives apply.
    v_kind := 'self_hospital';
    update player_secrets set pending_action = 'intox', pending_target = p_player_id::text
    where player_id = p_player_id;
  elsif v_roll = 2 then
    v_kind := 'no_minigame';
    update player_secrets set minigame_no_score = true where player_id = p_player_id;
  elsif v_roll = 3 then
    v_kind := 'minigame_mult';
    update player_secrets set potion_minigame_mult = true where player_id = p_player_id;
  elsif v_roll = 4 then
    -- Hospitalise a chosen target: park a sentinel; gambling_pick_target arms it.
    v_kind := 'hospital'; v_needs := true;
    update player_secrets set pending_action = 'gamble_pick_hosp', pending_target = null
    where player_id = p_player_id;
  elsif v_roll = 5 then
    v_kind := 'extra_life';
    update player_secrets set extra_lives = extra_lives + 1 where player_id = p_player_id;
  else
    -- Kill a chosen target.
    v_kind := 'kill'; v_needs := true;
    update player_secrets set pending_action = 'gamble_pick_kill', pending_target = null
    where player_id = p_player_id;
  end if;

  return jsonb_build_object('ok', true, 'roll', v_roll, 'kind', v_kind, 'needs_target', v_needs);
end; $$;
grant execute on function gambling_roll(uuid) to anon, authenticated;

-- After a roll of 4 or 6, choose who to hospitalise / kill. Converts the
-- 'gamble_pick_*' sentinel into the real queued action (resolved like any
-- intox/kill). No extra SE — the roll already charged it. An unpicked sentinel
-- simply resolves to nothing (the SE is still spent).
create or replace function gambling_pick_target(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_role text; v_pending text; v_act text;
begin
  select p.room_id, r.phase, s.role, s.pending_action
    into v_room, v_phase, v_role, v_pending
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'gambling'
     or (v_pending is distinct from 'gamble_pick_hosp' and v_pending is distinct from 'gamble_pick_kill')
     or p_target_id = p_player_id
     or not exists (select 1 from players where id = p_target_id and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false);
  end if;
  v_act := case when v_pending = 'gamble_pick_kill' then 'kill' else 'intox' end;
  update player_secrets set pending_action = v_act, pending_target = p_target_id::text
  where player_id = p_player_id;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function gambling_pick_target(uuid, uuid) to anon, authenticated;

-- ---- Minigame scoring honours Gambling's roll of 2 -------------------------
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
  v_no_score boolean;
begin
  select p.room_id, s.role, r.pride_target, coalesce(s.minigame_no_score, false)
    into v_room_id, v_role, v_pride, v_no_score
  from players p
    join rooms r on r.id = p.room_id
    left join player_secrets s on s.player_id = p.id
  where p.id = p_player_id and not p.dead and not p.in_prison and not p.in_hospital;
  if v_room_id is null then
    return 0;
  end if;

  -- Pride dazzled this player, or Gambling rolled a 2: they score nothing.
  if (v_pride is not null and v_pride = p_player_id::text) or v_no_score then
    update players set minigame_score = 0, minigame_submitted_at = now(), ready = true
    where id = p_player_id;
    update player_secrets set minigame_guesses = p_guesses, minigame_correct = 0,
      minigame_no_score = false
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
      -- Diligence: a wrong tag scores 0 for this row but doesn't zero the round.
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

  -- minigame_correct is meaningful for Diligence (whose loop never exits early);
  -- for others it's the count up to their first wrong tag, which they never read.
  update player_secrets set minigame_guesses = p_guesses, minigame_correct = v_correct
  where player_id = p_player_id;

  return v_score;
end;
$$;

grant execute on function submit_minigame_guesses(uuid, jsonb) to anon, authenticated;

-- ---- Belt-and-braces clear of Gambling's roll-of-2 flag --------------------
-- submit_minigame_guesses clears minigame_no_score as it scores the player 0,
-- but a gambler who couldn't submit (dead / hospitalised at minigame time)
-- would keep a stale "score 0". consume_minigame_mult already runs room-wide
-- once per day right after the minigame (host's endMinigame), so clear it here
-- too — no stale flag ever survives into a later round.
create or replace function consume_minigame_mult(p_room_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(s.player_id), '{}')
    into v_ids
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.potion_minigame_mult = true;

  update player_secrets set potion_minigame_mult = false
  where player_id = any(v_ids);

  update player_secrets set minigame_no_score = false
  where player_id in (select id from players where room_id = p_room_id)
    and minigame_no_score;

  return v_ids;
end;
$$;
grant execute on function consume_minigame_mult(uuid) to anon, authenticated;
