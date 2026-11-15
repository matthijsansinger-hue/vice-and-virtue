-- 149_playtest_rules_spectating.sql — 2026-11-15, Matthijs's second round of
-- playtest changes. Every function below is the live version (as mirrored in
-- schema.sql) with only the marked lines changed.
--
-- Court
--   * Objecting to proof or counterproof costs 100 (was 50). A forged ruling
--     pays the objector their 100 back + the filer's 50; an upheld one sends
--     the 100 to the filer (or the defendant, for counterproof) — unchanged
--     rules, new amount (vv_court_n('objection')).
--   * Each half of the trial (case against, defence) lasts 60 s (was 30).
--   * The dead see whether proof is genuine only in private lobbies.
-- Quiz
--   * 40 s in server rooms (vv_srv_start_minigame; private lobbies: the
--     client's MINIGAME_SECONDS).
--   * Two options: 100 Soul Energy, or the whisper (a clue about two players)
--     for 0. Reading a soul (peek) is refused; bots that wanted it whisper.
-- Gambling
--   * Roll 2: no Quiz that day (submit_quiz_choice refuses with 'no_quiz' and
--     marks them done; quiz_sit_out tells the screen up front).
--   * Roll 3: +150 Soul Energy at once (was: double the next Quiz).
-- Spectating
--   * Private lobbies: the dead still see everything.
--   * Public / ranked games (server-hosted): the dead see only their friends —
--     spectator_secrets returns themselves + accepted friends (scope
--     'friends'), and the dead may read only DMs involving a friend.
--
-- Needs 142 (court abilities) live. Safe to run more than once.

begin;


-- ---------------------------------------------------------------------------
-- Friends (accepted, either direction) — for the spectating rules above.
create or replace function vv_are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (select 1 from friendships f
                  where f.status = 'accepted'
                    and ((f.requester_id = p_a and f.addressee_id = p_b)
                      or (f.requester_id = p_b and f.addressee_id = p_a)));
$$;
revoke all on function vv_are_friends(uuid, uuid) from public;
grant execute on function vv_are_friends(uuid, uuid) to anon, authenticated;

-- May a dead viewer (account p_viewer) read a DM between players p_a and p_b
-- in room p_room? Private lobbies: yes. Public / ranked: only if one of the
-- two is the viewer's friend.
create or replace function vv_dead_may_watch(p_room uuid, p_viewer uuid, p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce((select server_hosted from rooms where id = p_room), false)
      or exists (select 1 from players p
                  where p.id in (p_a, p_b) and vv_are_friends(p_viewer, p.user_id));
$$;
revoke all on function vv_dead_may_watch(uuid, uuid, uuid, uuid) from public;
grant execute on function vv_dead_may_watch(uuid, uuid, uuid, uuid) to anon, authenticated;

drop policy if exists "dm readable by participants or dead spectators" on dm_messages;
create policy "dm readable by participants or dead spectators" on dm_messages
  for select using (
    exists (select 1 from players p
            where p.user_id = auth.uid()
              and (p.id = dm_messages.sender_id or p.id = dm_messages.recipient_id))
    or exists (select 1 from players p
               where p.room_id = dm_messages.room_id and p.user_id = auth.uid() and p.dead
                 and vv_dead_may_watch(dm_messages.room_id, auth.uid(),
                                       dm_messages.sender_id, dm_messages.recipient_id))
  );

-- Gambling's roll of 2: is today's Quiz closed to me? If so (and the Quiz is
-- on), I count as done, so the round doesn't wait for me.
create or replace function quiz_sit_out(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_blocked boolean; v_phase text;
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(s.minigame_no_score, false), r.phase into v_blocked, v_phase
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_player_id;
  if coalesce(v_blocked, false) and v_phase = 'minigame' then
    update players set ready = true, minigame_submitted_at = now()
     where id = p_player_id and not ready;
  end if;
  return jsonb_build_object('blocked', coalesce(v_blocked, false));
end;
$$;
grant execute on function quiz_sit_out(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace function vv_court_n(p_key text)
returns integer language sql immutable as $$
  select case p_key
    when 'stake_step'       then 10     -- backing step; press stakes 10, 20 … 100
    when 'cap'              then 100    -- per player per charge (press stake counts)
    when 'exhibit'          then 50
    when 'counterproof'     then 50
    when 'objection'        then 100    -- (149) was 50
    when 'extend'           then 10     -- seconds an exhibit/counterproof adds
    when 'extend_cap'       then 30     -- per trial
    when 'witness_window'   then 15     -- seconds to answer a call
    when 'docket'           then 75
    when 'half'             then 60     -- (149) was 30: a minute to file, each side
    when 'verdict'          then 45
    when 'max_text'         then 200    -- a quoted free-text message
    when 'guilty_floor'     then 2      -- distinct Guilty jurors needed
    when 'payout_pct'       then 200    -- prosecutors on an imprisonment (×2; 150 if rich)
    when 'counterproof_pct' then 200    -- a standing counterproof on a spared verdict
    when 'countdown'        then 10     -- majority Done / Continue countdown
    when 'bots_grace'       then 5      -- a step with no human to wait for still shows this long
    when 'power'            then 100    -- Diligence / Truthfulness / Justice / Pride's shield
    when 'broadcast'        then 200    -- Pride's global chat
    when 'chat_max'         then 60     -- messages in one chat exhibit
  end;
$$;

-- ---------------------------------------------------------------------------
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

  -- Two options since 2026-11-15 (migration 149): Soul Energy, or the
  -- whisper for nothing. Reading a soul (peek) is gone.
  if p_choice = 'peek' then
    return jsonb_build_object('ok', false, 'reason', 'bad_choice');
  end if;
  -- Gambling's roll of 2 (149): no Quiz at all today. Counts as done, so
  -- nobody waits on them.
  if v_no_score then
    update players set ready = true, minigame_submitted_at = now() where id = p_player_id;
    return jsonb_build_object('ok', false, 'reason', 'no_quiz');
  end if;

  if p_choice = 'points' then
    v_points := 100;

  elsif p_choice = 'hint' then
    v_points := 0;                      -- (149) was 50
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

-- ---------------------------------------------------------------------------
create or replace function vv_bot_quiz(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_se numeric; v_camp text; v_unknown uuid; v_choice text := 'points';
  v_res jsonb; v_quiz jsonb; r numeric; v_saving boolean; v_has_target boolean;
  v_check uuid;
begin
  select p.soul_energy, vv_role_camp(s.role) into v_se, v_camp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_unknown := vv_bot_unknown(p_bot);
  v_saving := vv_bot_reserve(p_bot) > 0;
  v_has_target := vv_bot_target(p_bot) is not null;
  -- Something it was told and hasn't checked (migration 130).
  v_check := vv_bot_claim_to_check(p_bot);

  -- Saving up, already holding a target, short on Soul Energy, or nothing left
  -- to learn → bank the 100.
  if v_check is not null and random() < (case when v_saving then 0.4 else 0.8 end) then
    -- Check a claim: read the soul of the player it was about. vv_bot_learn
    -- then settles every claim about them (sender trusted, or a liar).
    v_choice := 'peek';
    v_unknown := v_check;
  elsif not v_saving and v_unknown is not null and v_se >= 100 then
    r := random();
    if v_has_target then
      v_choice := case when r < 0.2 then 'hint' else 'points' end;
    elsif v_camp = 'virtue' then
      v_choice := case when r < 0.55 then 'peek' when r < 0.8 then 'hint' else 'points' end;
    else
      v_choice := case when r < 0.4 then 'peek' when r < 0.65 then 'hint' else 'points' end;
    end if;
  end if;

  -- No more reading a soul in the Quiz (149): a bot that wanted to look
  -- takes the whisper instead.
  if v_choice = 'peek' then
    v_choice := 'hint';
  end if;

  v_res := submit_quiz_choice_impl(p_bot, v_choice,
             case when v_choice = 'peek' then v_unknown end);
  if coalesce((v_res->>'ok')::boolean, false) then
    v_quiz := v_res->'quiz';
    if v_quiz->>'choice' = 'peek' and jsonb_typeof(v_quiz->'peek') = 'object' then
      perform vv_bot_learn(p_bot, (v_quiz->'peek'->>'target')::uuid, v_quiz->'peek'->>'camp');
    elsif v_quiz->>'choice' = 'hint' and jsonb_typeof(v_quiz->'hint') = 'object' then
      perform vv_bot_hint(p_bot, v_quiz->'hint');
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function gambling_roll_impl(p_player_id uuid)
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
    -- (149) was: double the next Quiz. Now 150 Soul Energy, right away.
    v_kind := 'soul_energy';
    update players set soul_energy = soul_energy + 150 where id = p_player_id;
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

-- ---------------------------------------------------------------------------
create or replace function vv_srv_start_minigame(p_room_id uuid)
returns void language sql security definer set search_path = public as $$
  update players set ready = false, minigame_score = 0, minigame_submitted_at = null
   where room_id = p_room_id;
  update rooms set phase = 'minigame', phase_ends_at = now() + interval '40 seconds',
                   minigame_clue = null
   where id = p_room_id;
$$;

-- ---------------------------------------------------------------------------
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
  v_user uuid;
  v_hosted boolean;
  v_players jsonb;
begin
  select p.room_id, p.dead, p.user_id, coalesce(r.server_hosted, false)
    into v_room, v_dead, v_user, v_hosted
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player_id;
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
  where p.room_id = v_room
    -- (149) Public / ranked games: only yourself and your friends.
    and (not v_hosted or p.id = p_player_id or vv_are_friends(v_user, p.user_id));

  return jsonb_build_object('ok', true,
                            'scope', case when v_hosted then 'friends' else 'all' end,
                            'players', v_players);
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function court_state(p_room_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r rooms%rowtype; v_dead boolean; v_open boolean; v_sees boolean;
begin
  if not vv_is_me(p_viewer_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select dead into v_dead from players where id = p_viewer_id and room_id = p_room_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from rooms where id = p_room_id;
  v_open := r.phase in ('consultation', 'new_day', 'vice_victory_intro',
                        'virtue_victory_intro', 'soul_victory_intro', 'game_over');

  -- Genuineness: the filer, the dead, and a Diligence who paid today (142).
  -- (149) The dead only in private lobbies; in public / ranked games the
  -- dead watch their friends, not the truth.
  v_sees := (v_dead and not coalesce(r.server_hosted, false)) or exists (select 1 from day_powers
                               where room_id = p_room_id and day = r.day
                                 and player_id = p_viewer_id and power = 'diligence');

  return jsonb_build_object(
    'day', r.day,
    'sworn', exists (select 1 from day_powers
                      where room_id = p_room_id and day = r.day and power = 'truth'),
    'step', r.court_step,
    'defendant_id', r.court_defendant_id,
    'trial', (select to_jsonb(d) - 'room_id' from court_days d
               where d.room_id = p_room_id and d.day = r.day),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'defendant_id', c.defendant_id, 'kind', c.kind,
               'victim_id', c.victim_id, 'pressed_by', c.pressed_by, 'status', c.status,
               'created_at', c.created_at,
               'stakes', coalesce((
                 select jsonb_agg(jsonb_build_object('player_id', s.player_id,
                                                     'amount', s.amount, 'at', s.created_at)
                                  order by s.created_at)
                   from court_stakes s where s.charge_id = c.id), '[]'::jsonb))
             order by c.created_at)
        from court_charges c where c.room_id = p_room_id and c.day = r.day), '[]'::jsonb),
    'exhibits', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'number', e.number, 'side', e.side, 'filer_id', e.filer_id,
               'kind', e.kind, 'payload', e.payload, 'cost', e.cost, 'status', e.status,
               'created_at', e.created_at,
               'genuine', case when v_sees or e.filer_id = p_viewer_id then t.genuine end)
             order by e.created_at)
        from court_exhibits e left join court_exhibit_truth t on t.exhibit_id = e.id
       where e.room_id = p_room_id and e.day = r.day), '[]'::jsonb),
    'witness', (select jsonb_build_object('witness_id', w.witness_id, 'status', w.status,
                                          'called_at', w.called_at, 'answered_at', w.answered_at)
                  from court_witness w where w.room_id = p_room_id and w.day = r.day),
    'objections', coalesce((
      select jsonb_agg(jsonb_build_object('exhibit_id', o.exhibit_id, 'objector_id', o.objector_id,
                                          'ruling', o.ruling, 'at', o.created_at)
                       order by o.created_at)
        from court_objections o
        join court_exhibits e on e.id = o.exhibit_id
       where o.room_id = p_room_id and e.day = r.day), '[]'::jsonb),
    'ledger', coalesce((
      select jsonb_agg(jsonb_build_object('player_id', l.player_id, 'amount', l.amount,
                                          'reason', l.reason, 'ref_id', l.ref_id, 'at', l.created_at)
                       order by l.created_at)
        from court_ledger l where l.room_id = p_room_id and l.day = r.day), '[]'::jsonb),
    'reputation', coalesce((
      select jsonb_object_agg(cr.player_id, cr.counters)
        from court_reputation cr where cr.room_id = p_room_id), '{}'::jsonb),
    'victims', to_jsonb(vv_court_victims(p_room_id)),
    'record', jsonb_build_object(
      'quiz', coalesce((
        select jsonb_agg(jsonb_build_object('day', q.day, 'player_id', q.player_id, 'kind', q.kind)
                         order by q.day)
          from quiz_log q
         where q.room_id = p_room_id and (q.day < r.day or (q.day = r.day and v_open))), '[]'::jsonb),
      'dms', coalesce((
        select jsonb_agg(jsonb_build_object('day', x.day, 'from', x.sender_id, 'to', x.recipient_id)
                         order by x.day)
          from (select distinct m.day, m.sender_id, m.recipient_id
                  from dm_messages m
                 where m.room_id = p_room_id and m.day is not null
                   and (m.day < r.day or (m.day = r.day and v_open))) x), '[]'::jsonb)),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', d.day, 'defendant_id', d.defendant_id, 'outcome', d.outcome,
               'guilty', d.guilty, 'not_guilty', d.not_guilty,
               'charges', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'kind', c.kind, 'victim_id', c.victim_id,
                          'total', (select coalesce(sum(s.amount), 0) from court_stakes s
                                     where s.charge_id = c.id))
                        order by c.created_at)
                   from court_charges c
                  where c.room_id = p_room_id and c.day = d.day and c.status = 'tried'), '[]'::jsonb),
               'witness', (select jsonb_build_object('witness_id', w.witness_id, 'status', w.status)
                             from court_witness w where w.room_id = p_room_id and w.day = d.day),
               'exhibits', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'number', e.number, 'side', e.side, 'kind', e.kind,
                          'filer_id', e.filer_id, 'payload', e.payload, 'status', e.status)
                        order by e.side desc, e.number)
                   from court_exhibits e where e.room_id = p_room_id and e.day = d.day), '[]'::jsonb))
             order by d.day)
        from court_days d where d.room_id = p_room_id and d.day < r.day), '[]'::jsonb)
  );
end;
$$;

commit;
