-- Migration 122 — The Quiz becomes a three-way choice (no more tagging)
--
-- Design (Matthijs, 2026-09-28): the tag-everyone Quiz (Vice / Virtue / "?",
-- one wrong tag zeroes the round) is replaced by a single, deterministic choice
-- each round — no RNG in the scoring:
--
--   'points' → 100 Soul Energy.
--   'hint'   → 50 Soul Energy + a clue about two other living players, picked
--              at random by the server as EITHER
--                · "A and B are on opposite sides" (one Vice + one Virtue), OR
--                · "at least one of A and B is a <camp>" (they may both be).
--              Only Vice/Virtue players are ever used — never the neutral
--              anomalies (Wandering Soul, Game Master).
--   'peek'   → 0 Soul Energy; see one living player's CAMP (not their role).
--              Neutral anomalies read as 'neutral'.
--
-- Kept from the old Quiz: Pride's dazzle (rooms.pride_target) and Gambling's
-- roll-of-2 (minigame_no_score) zero the points; the x2 potion / Gambling's
-- roll-of-3 (potion_minigame_mult) doubles them. Choices are SECRET (stored in
-- player_secrets.quiz); nothing is written to the public players.minigame_score.
--
-- Soul Energy is awarded server-side when the round ends (apply_quiz_awards,
-- host-gated, phase-guarded, once per room per day — same pattern as migration
-- 120), so the host no longer computes awards in the browser.
--
-- The old tagging functions (submit_minigame_guesses, compute_minigame_clue,
-- apply_minigame_awards, consume_minigame_mult, diligence_count) are left in
-- place but are no longer called.
--
-- Depends on 120 (rooms.minigame_awarded_day — re-added here if missing).
-- Safe to re-run.

begin;

alter table player_secrets add column if not exists quiz jsonb;
alter table rooms add column if not exists minigame_awarded_day integer;

-- Random element of a uuid array (null when empty).
create or replace function vv_random_pick(p_ids uuid[])
returns uuid
language sql
volatile
as $$
  select case
    when coalesce(array_length(p_ids, 1), 0) = 0 then null
    else p_ids[1 + floor(random() * array_length(p_ids, 1))::int]
  end;
$$;

-- ---------------------------------------------------------------------------
-- The player's choice. Idempotent: a second call the same day returns the
-- choice already made (a double-tap or a retried request can't re-roll a hint).
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
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock my row so two simultaneous submits serialise (the second then sees
  -- the first's choice and returns it).
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
        -- "A and B are on opposite sides."
        v_a := vv_random_pick(v_vices);
        v_b := vv_random_pick(v_virtues);
        v_hint := jsonb_build_object('kind', 'opposite');
      else
        -- "At least one of A and B is a <camp>." The camp must have someone in
        -- it; the second player is anyone else (they may share the camp).
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
      -- Shuffle the pair so the order never gives the answer away.
      if random() < 0.5 then
        v_tmp := v_a; v_a := v_b; v_b := v_tmp;
      end if;
      v_hint := v_hint || jsonb_build_object('a', v_a, 'b', v_b);
    end if;
    -- (Fewer than two candidates: the 50 is still paid, the hint stays null.)

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

  -- Pride's dazzle / Gambling's roll-of-2: this round's points are lost (the
  -- information from a hint or peek is still given).
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
grant execute on function submit_quiz_choice(uuid, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- My choice for the CURRENT day (null if none) — restores the screen after a
-- refresh and feeds the results screen.
create or replace function my_quiz(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_quiz jsonb; v_day integer;
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select s.quiz, r.day into v_quiz, v_day
    from players p
    join rooms r on r.id = p.room_id
    left join player_secrets s on s.player_id = p.id
   where p.id = p_player_id;
  if v_quiz is null or (v_quiz->>'day')::int is distinct from v_day then
    return null;
  end if;
  return v_quiz;
end;
$$;
grant execute on function my_quiz(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Host, at the end of the round: pay everyone's chosen points (x2 for armed
-- multipliers), consume the multipliers + stale roll-of-2 flags. At most once
-- per room per day, and only while the room is still in the minigame.
create or replace function apply_quiz_awards(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text; v_day integer; v_awarded integer;
  r record;
  v_award integer;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  select phase, day, minigame_awarded_day
    into v_phase, v_day, v_awarded
    from rooms where id = p_room_id
    for update;
  if v_phase is distinct from 'minigame' then return; end if;
  if v_awarded is not distinct from v_day then return; end if; -- already paid

  for r in
    select s.player_id, s.quiz, coalesce(s.potion_minigame_mult, false) as mult
      from player_secrets s join players p on p.id = s.player_id
     where p.room_id = p_room_id
       and s.quiz is not null
       and (s.quiz->>'day')::int = v_day
  loop
    v_award := coalesce((r.quiz->>'points')::int, 0) * (case when r.mult then 2 else 1 end);
    if v_award > 0 then
      update players set soul_energy = soul_energy + v_award where id = r.player_id;
    end if;
    -- Recorded on the choice so the results screen can show what was paid.
    update player_secrets
       set quiz = r.quiz || jsonb_build_object('awarded', v_award,
                                              'doubled', r.mult and v_award > 0)
     where player_id = r.player_id;
  end loop;

  -- Multipliers are spent on this round whether or not their owner chose
  -- (as before); stale roll-of-2 flags are cleared the same way.
  update player_secrets set potion_minigame_mult = false
   where potion_minigame_mult
     and player_id in (select id from players where room_id = p_room_id);
  update player_secrets set minigame_no_score = false
   where minigame_no_score
     and player_id in (select id from players where room_id = p_room_id);

  update rooms set minigame_awarded_day = v_day where id = p_room_id;
end;
$$;
grant execute on function apply_quiz_awards(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dead spectators see each player's Quiz choice (was: their tags). Body is
-- migration 093's plus the 'quiz' field; the 098 caller-gate wrapper is kept.
create or replace function spectator_secrets_impl(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_dead boolean;
  v_players jsonb;
begin
  select room_id, dead into v_room, v_dead from players where id = p_player_id;
  if v_room is null or not coalesce(v_dead, false) then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id,
    'role', s.role,
    'soul_energy', p.soul_energy,
    'pending_action', s.pending_action,
    'pending_target', s.pending_target,
    'vote', s.vote,
    'guesses', s.minigame_guesses,
    'quiz', s.quiz,
    'potions', jsonb_build_object(
      'kill', s.potion_kill_target,
      'hosp', s.potion_hosp_target,
      'protect', coalesce(s.potion_protect, false),
      'mult', coalesce(s.potion_minigame_mult, false),
      'vote_reveal', coalesce(s.potion_vote_reveal, false),
      'iron_will', coalesce(s.potion_iron_will, false)
    )
  ) order by p.created_at), '[]'::jsonb)
  into v_players
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = v_room;

  return jsonb_build_object('ok', true, 'players', v_players);
end;
$$;
revoke all on function spectator_secrets_impl(uuid) from public, anon, authenticated;

commit;
