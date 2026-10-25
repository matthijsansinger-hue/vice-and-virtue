-- Migration 124 — Bots, batch A: bots fill PUBLIC games and take safe moves
--
-- Design (Matthijs, 2026-10-25):
--   * Bots exist ONLY in public queue games — never ranked, never private code
--     lobbies.
--   * They fill the remaining seats once a human has searched for a minute
--     without a full game forming.
--   * They are labeled ("Name (bot)"), never chat, and play every other phase.
--   * Full rewards (unchanged — bots have no account, so they never earn stats,
--     badges or rewards themselves).
--
-- This batch (A) is the plumbing:
--   1. players.is_bot, and form_match('public') seats bots in the empty seats
--      once any waiting human has passed the 60s grace period. Every waiting
--      human is seated (no one is left behind for a bot). The host is always a
--      human. Each bot is dealt a random default role of its seat's class,
--      already locked, so role select never waits on a bot.
--   2. run_bots(room): host-gated; the host's client calls it at the start of
--      every phase. It acts for every bot SERVER-SIDE (bots' roles are secret —
--      deciding in the host's browser would leak them) and is idempotent per
--      phase/day/re-vote via rooms.bots_acted_key. Batch A moves are the safe
--      ones: Quiz → 100 Soul Energy, vote → skip, everything else → ready.
--      Batch B replaces these with real, camp-aware play.
--   3. submit_quiz_choice is split into an internal _impl (no caller gate, so
--      run_bots can choose for a bot) + the same gated wrapper for players.
--
-- Pacing is client-side: "majority ready" / "everyone ready" count humans
-- only (falling back to the bots when no human is active), so bots acting
-- instantly never rush a human.
--
-- Depends on 117 (form_match), 122 (submit_quiz_choice). Safe to re-run.

begin;

alter table players add column if not exists is_bot boolean not null default false;
alter table rooms add column if not exists bots_acted_key text;

-- ---------------------------------------------------------------------------
-- 3) Quiz choice: internal body (identical to migration 122's, minus the
--    vv_is_me gate) + the gated wrapper players call.
create or replace function submit_quiz_choice_impl(
  p_player_id uuid,
  p_choice text,
  p_target uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_phase text; v_day integer; v_pride text;
  v_quiz jsonb; v_no_score boolean;
  v_points integer;
  v_dazzled boolean := false;
  v_hint jsonb;
  v_peek jsonb;
  v_vices uuid[]; v_virtues uuid[]; v_all uuid[];
  v_a uuid; v_b uuid; v_tmp uuid;
  v_camp text;
  v_target_role text;
begin
  select room_id, dead, in_prison, in_hospital
    into v_room, v_dead, v_prison, v_hosp
    from players where id = p_player_id
    for update;
  if v_room is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select phase, day, pride_target into v_phase, v_day, v_pride
    from rooms where id = v_room;
  if v_phase is distinct from 'minigame' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;

  select quiz, coalesce(minigame_no_score, false)
    into v_quiz, v_no_score
    from player_secrets where player_id = p_player_id;
  if v_quiz is not null and (v_quiz->>'day')::int = v_day then
    return jsonb_build_object('ok', true, 'quiz', v_quiz);
  end if;

  if p_choice = 'points' then
    v_points := 100;

  elsif p_choice = 'hint' then
    v_points := 50;
    select coalesce(array_agg(p.id) filter (where vv_role_camp(s.role) = 'vice'), '{}'),
           coalesce(array_agg(p.id) filter (where vv_role_camp(s.role) = 'virtue'), '{}')
      into v_vices, v_virtues
      from players p join player_secrets s on s.player_id = p.id
     where p.room_id = v_room and p.id <> p_player_id and not p.dead;
    v_all := v_vices || v_virtues;

    if coalesce(array_length(v_all, 1), 0) >= 2 then
      if coalesce(array_length(v_vices, 1), 0) > 0
         and coalesce(array_length(v_virtues, 1), 0) > 0
         and random() < 0.5 then
        v_a := vv_random_pick(v_vices);
        v_b := vv_random_pick(v_virtues);
        v_hint := jsonb_build_object('kind', 'opposite');
      else
        if coalesce(array_length(v_vices, 1), 0) = 0 then
          v_camp := 'virtue';
        elsif coalesce(array_length(v_virtues, 1), 0) = 0 then
          v_camp := 'vice';
        elsif random() < 0.5 then
          v_camp := 'vice';
        else
          v_camp := 'virtue';
        end if;
        v_a := vv_random_pick(case when v_camp = 'vice' then v_vices else v_virtues end);
        v_b := vv_random_pick(array_remove(v_all, v_a));
        v_hint := jsonb_build_object('kind', 'at_least', 'camp', v_camp);
      end if;
      if random() < 0.5 then
        v_tmp := v_a; v_a := v_b; v_b := v_tmp;
      end if;
      v_hint := v_hint || jsonb_build_object('a', v_a, 'b', v_b);
    end if;

  elsif p_choice = 'peek' then
    v_points := 0;
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    select s.role into v_target_role
      from players p left join player_secrets s on s.player_id = p.id
     where p.id = p_target and p.room_id = v_room and not p.dead;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    v_camp := vv_role_camp(v_target_role);
    if v_camp is null or v_camp not in ('vice', 'virtue') then
      v_camp := 'neutral';
    end if;
    v_peek := jsonb_build_object('target', p_target, 'camp', v_camp);

  else
    return jsonb_build_object('ok', false, 'reason', 'bad_choice');
  end if;

  if v_points > 0 and ((v_pride is not null and v_pride = p_player_id::text) or v_no_score) then
    v_points := 0;
    v_dazzled := true;
  end if;

  v_quiz := jsonb_build_object(
    'day', v_day,
    'choice', p_choice,
    'points', v_points,
    'dazzled', v_dazzled,
    'hint', v_hint,
    'peek', v_peek
  );

  update player_secrets set quiz = v_quiz, minigame_no_score = false
   where player_id = p_player_id;
  update players set ready = true, minigame_submitted_at = now()
   where id = p_player_id;

  return jsonb_build_object('ok', true, 'quiz', v_quiz);
end;
$$;
-- Internal: only the gated wrapper below and run_bots may call this.
revoke all on function submit_quiz_choice_impl(uuid, text, uuid) from public, anon, authenticated;

create or replace function submit_quiz_choice(
  p_player_id uuid,
  p_choice text,
  p_target uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return submit_quiz_choice_impl(p_player_id, p_choice, p_target);
end;
$$;
grant execute on function submit_quiz_choice(uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) The matchmaker. Migration 117's form_match, plus the public bot fill:
--    when fewer than 8 humans are waiting but someone has waited out the grace
--    period, seat EVERY waiting human (preference first, then any free seat)
--    and give the remaining seats to bots.
create or replace function form_match(p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c_seats constant int := 4;                 -- per camp; 4v4
  c_patience constant interval := interval '60 seconds';
  c_vice_classes constant text[] :=
    array['exterminator','troublemaker','obstructor','manipulator'];
  c_virtue_classes constant text[] :=
    array['protector','communicator','seeker','catalyst'];
  -- Roles a bot may be dealt: the same default set role select hands to a
  -- straggler (resolve_role_select_impl), so a bot never holds an unlockable.
  c_bot_roles constant text[] := array['murder','intoxication','envy','torment',
    'vengeance','vice_worshipper','empathy','justice','certainty','truthfulness',
    'sacrifice','virtue_seeker','generosity'];
  c_bot_names constant text[] := array['Aldric','Brienne','Cedric','Darra',
    'Edmund','Fiora','Godric','Hilde','Isolde','Jorah','Kestrel','Leofric',
    'Maren','Niall','Osric','Perrin','Quenna','Rowan','Seren','Tamsin',
    'Ulric','Vesna','Wystan','Yselde'];
  v_taken uuid[] := '{}';
  v_pick uuid;
  v_assign jsonb := '[]'::jsonb;   -- [{user, camp, class}]  (user null = a bot seat)
  v_camp text; v_class text; v_i int;
  v_code text; v_room_id uuid; v_player_id uuid; v_name text;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bot_mode boolean := false;
  v_host_seated boolean := false;
  v_is_bot boolean;
  v_role text;
  r record;
begin
  if (select count(*) from ranked_queue
      where mode = p_kind and status = 'waiting') < 2 * c_seats then
    -- Not enough humans for a full game. Public only: once anyone has waited
    -- out the grace period, the empty seats go to bots.
    if p_kind = 'public' and exists (
         select 1 from ranked_queue
         where mode = 'public' and status = 'waiting'
           and joined_at <= now() - c_patience) then
      v_bot_mode := true;
    else
      return null;
    end if;
  end if;

  -- Pass 1: give people the class they asked for. Longest wait wins a contested
  -- slot, so patience is rewarded rather than arbitrary.
  for v_i in 1..(2 * c_seats) loop
    if v_i <= c_seats then
      v_camp := 'vice';  v_class := c_vice_classes[v_i];
    else
      v_camp := 'virtue'; v_class := c_virtue_classes[v_i - c_seats];
    end if;

    select user_id into v_pick
    from ranked_queue
    where mode = p_kind and status = 'waiting'
      and not (user_id = any(v_taken))
      and (case when v_camp = 'vice' then pref_vice else pref_virtue end) = v_class
    order by joined_at
    limit 1;

    if v_pick is not null then
      v_taken := array_append(v_taken, v_pick);
      v_assign := v_assign || jsonb_build_object(
        'user', v_pick, 'camp', v_camp, 'class', v_class);
    end if;
  end loop;

  -- Pass 2: fill the remaining seats. Normally only with players who have
  -- waited out the grace period; in bot mode with ANY waiting human (nobody
  -- who is searching gets left behind for a bot), and a bot once no human is
  -- left.
  for v_i in 1..(2 * c_seats) loop
    if v_i <= c_seats then
      v_camp := 'vice';  v_class := c_vice_classes[v_i];
    else
      v_camp := 'virtue'; v_class := c_virtue_classes[v_i - c_seats];
    end if;
    if exists (select 1 from jsonb_array_elements(v_assign) as t(elem)
               where t.elem ->> 'camp' = v_camp
                 and t.elem ->> 'class' = v_class) then
      continue;
    end if;

    select user_id into v_pick
    from ranked_queue
    where mode = p_kind and status = 'waiting'
      and not (user_id = any(v_taken))
      and (v_bot_mode or joined_at <= now() - c_patience)
    order by joined_at
    limit 1;

    if v_pick is null then
      if v_bot_mode then
        v_assign := v_assign || jsonb_build_object(
          'user', null, 'camp', v_camp, 'class', v_class);
        continue;
      end if;
      return null;   -- can't fill this slot yet; try again next poll
    end if;
    v_taken := array_append(v_taken, v_pick);
    v_assign := v_assign || jsonb_build_object(
      'user', v_pick, 'camp', v_camp, 'class', v_class);
  end loop;

  -- Every seat is spoken for: build the room.
  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, phase_ends_at,
                         role_assign_mode, eye_uses_left, free_uses_left)
      values (v_code, false, p_kind = 'ranked', 'in_game', 'role_select',
              now() + interval '30 seconds', 'choose', 1, 1)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  -- Humans first, so the host (the first human seated) is never a bot.
  for r in
    select elem from jsonb_array_elements(v_assign) as t(elem)
    order by (t.elem ->> 'user') is null
  loop
    v_is_bot := (r.elem ->> 'user') is null;

    if v_is_bot then
      select n into v_name from unnest(c_bot_names) n
      where n || ' (bot)' not in (select name from players where room_id = v_room_id)
      order by random() limit 1;
      v_name := coalesce(v_name, 'Shade') || ' (bot)';

      insert into players (room_id, user_id, auth_uid, name, is_host, is_bot)
      values (v_room_id, null, null, v_name, false, true)
      returning id into v_player_id;

      -- Dealt and locked now, so role select never waits on a bot.
      select x into v_role from unnest(c_bot_roles) x
      where vv_role_camp(x) = r.elem ->> 'camp'
        and vv_role_class(x) = r.elem ->> 'class'
      order by random() limit 1;
      v_role := coalesce(v_role, case when r.elem ->> 'camp' = 'virtue'
                                      then 'virtue_seeker' else 'vice_worshipper' end);

      insert into player_secrets (player_id, role, role_choice, assigned_camp, assigned_class)
      values (v_player_id, v_role, v_role, r.elem ->> 'camp', r.elem ->> 'class');
    else
      select name into v_name from ranked_queue
      where user_id = (r.elem ->> 'user')::uuid;

      -- Two identity columns, and both matter here (migration 106):
      --   user_id  = ACCOUNT identity. Only set when the queuer actually has a
      --              profile — a guest's anonymous uid must NOT go here.
      --   auth_uid = SESSION identity, what vv_is_me matches on. Set explicitly
      --              per seat (its default would be the POLLER's uid).
      insert into players (room_id, user_id, auth_uid, name, is_host)
      values (v_room_id,
              case when exists (select 1 from profiles pr
                                where pr.id = (r.elem ->> 'user')::uuid)
                   then (r.elem ->> 'user')::uuid end,
              (r.elem ->> 'user')::uuid,
              coalesce(v_name, 'Player'), not v_host_seated)
      returning id into v_player_id;
      v_host_seated := true;

      insert into player_secrets (player_id, role, assigned_camp, assigned_class)
      values (v_player_id, null, r.elem ->> 'camp', r.elem ->> 'class');
    end if;

    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_taken);

  return v_code;
end;
$$;
grant execute on function form_match(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) The bot runner. Host-gated; called by the host's client whenever the
--    phase / day / re-vote changes. Runs once per such state.
create or replace function run_bots(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text; v_day integer; v_revote jsonb; v_done text; v_key text;
  r record;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  select phase, day, revote_candidates, bots_acted_key
    into v_phase, v_day, v_revote, v_done
    from rooms where id = p_room_id
    for update;
  if v_phase is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_key := v_phase || ':' || v_day || ':' || coalesce(md5(v_revote::text), '-');
  if v_done is not distinct from v_key then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if not exists (select 1 from players where room_id = p_room_id and is_bot) then
    return jsonb_build_object('ok', true, 'bots', 0);
  end if;

  for r in
    select p.id from players p
    where p.room_id = p_room_id and p.is_bot
      and not p.dead and not p.in_prison and not p.in_hospital
  loop
    if v_phase = 'minigame' then
      perform submit_quiz_choice_impl(r.id, 'points', null);
    elsif v_phase = 'consultation' then
      perform submit_vote_impl(r.id, 'skip');
    end if;
  end loop;

  -- Bots are always "ready" — they never hold up a gate. (The clients count
  -- humans only, so this matters just when no human is left active.)
  update players set ready = true
   where room_id = p_room_id and is_bot and not dead;

  update rooms set bots_acted_key = v_key where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function run_bots(uuid) to anon, authenticated;

commit;
