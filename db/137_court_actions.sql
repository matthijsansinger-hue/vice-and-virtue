-- 137: The Trial, batch 2 — what players do in court (docs/trial-build-spec.md).
--
--   press_charge · back_charge                     the docket
--   file_exhibit                                   prosecution, "against" half
--   call_witness · answer_witness                  either half
--   file_counterproof                              the accepted witness, "defence" half
--   object_exhibit                                 either half
--
-- Each is a gated wrapper (vv_is_me) over an _impl that bots will call too.
-- Every Soul Energy movement goes through vv_court_pay, which writes the
-- public ledger line. Genuineness is decided at filing (vv_court_check_exhibit)
-- and stored locked. An exhibit or counterproof adds 10 s to the current half
-- (max +30 s per trial).
--
-- The step machine that sets rooms.court_step (and closes the docket, runs the
-- verdict and settles) is batch 3 — until then every call here answers
-- 'wrong_step'. Requires 136. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Tunables
create or replace function vv_court_n(p_key text)
returns integer language sql immutable as $$
  select case p_key
    when 'stake_step'      then 25     -- backing step; press stakes are 25/50/75/100
    when 'cap'             then 100    -- per player per charge (press stake counts)
    when 'exhibit'         then 50
    when 'counterproof'    then 50
    when 'objection'       then 50
    when 'extend'          then 10     -- seconds an exhibit/counterproof adds
    when 'extend_cap'      then 30     -- per trial
    when 'witness_window'  then 15     -- seconds to answer a call
    when 'docket'          then 75
    when 'half'            then 30
    when 'verdict'         then 45
    when 'max_text'        then 200    -- a quoted free-text message
  end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers

-- Move Soul Energy for the court and write the ledger line. Negative = the
-- player pays; refused (false) when they can't afford it. Positive = paid in.
create or replace function vv_court_pay(
  p_room uuid, p_day integer, p_player uuid, p_amount integer, p_reason text, p_ref uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount = 0 then return true; end if;
  if p_amount < 0 then
    update players set soul_energy = soul_energy + p_amount
     where id = p_player and soul_energy >= -p_amount;
    if not found then return false; end if;
  else
    update players set soul_energy = soul_energy + p_amount where id = p_player;
  end if;
  insert into court_ledger (room_id, day, player_id, amount, reason, ref_id)
  values (p_room, p_day, p_player, p_amount, p_reason, p_ref);
  return true;
end;
$$;
revoke all on function vv_court_pay(uuid, integer, uuid, integer, text, uuid) from public, anon, authenticated;

create or replace function vv_court_rep(p_room uuid, p_player uuid, p_key text, p_delta integer default 1)
returns void
language sql
security definer
set search_path = public
as $$
  insert into court_reputation (room_id, player_id, counters)
  values (p_room, p_player, jsonb_build_object(p_key, p_delta))
  on conflict (room_id, player_id) do update
     set counters = court_reputation.counters || jsonb_build_object(p_key,
           coalesce((court_reputation.counters->>p_key)::integer, 0) + p_delta);
$$;
revoke all on function vv_court_rep(uuid, uuid, text, integer) from public, anon, authenticated;

-- An exhibit or counterproof buys the room 10 s more of the current half, up
-- to 30 s per trial.
create or replace function vv_court_extend(p_room uuid, p_day integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update court_days set extend_s = extend_s + vv_court_n('extend')
   where room_id = p_room and day = p_day
     and extend_s + vv_court_n('extend') <= vv_court_n('extend_cap');
  if found then
    update rooms set phase_ends_at = phase_ends_at + make_interval(secs => vv_court_n('extend'))
     where id = p_room and phase_ends_at is not null;
  end if;
end;
$$;
revoke all on function vv_court_extend(uuid, integer) from public, anon, authenticated;

-- A uuid from a jsonb field, or null if it isn't one.
create or replace function vv_court_uuid(p_value text)
returns uuid language plpgsql immutable as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- Check an exhibit against the public record and the filer's real data.
-- Returns {ok:false, reason} for anything the record makes impossible (a Quiz
-- exhibit for a day they didn't take that choice, a message between two
-- players who didn't message that day), else {ok:true, genuine, payload} with
-- the payload normalised:
--   quiz_peek     {day, target, camp}
--   quiz_hint     {day, a, b, form: opposite|at_least_one, camp?}
--   msg_received  {day, from, message: {s, about?, role?} | {text}}
--   msg_sent      {day, to,   message: …}
create or replace function vv_court_check_exhibit(
  p_filer uuid, p_room uuid, p_today integer, p_kind text, p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day integer; v_q quiz_log%rowtype; v_hint jsonb; v_genuine boolean;
  v_t uuid; v_a uuid; v_b uuid; v_camp text; v_form text;
  v_other uuid; v_from uuid; v_to uuid; v_msg jsonb; v_norm jsonb;
  v_s text; v_about uuid; v_role text; v_text text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'bad_payload');
  end if;
  begin
    v_day := (p_payload->>'day')::integer;
  exception when others then
    v_day := null;
  end;
  if v_day is null or v_day < 1 or v_day > p_today then
    return jsonb_build_object('ok', false, 'reason', 'bad_day');
  end if;

  if p_kind in ('quiz_peek', 'quiz_hint') then
    select * into v_q from quiz_log
     where room_id = p_room and day = v_day and player_id = p_filer;
  end if;

  if p_kind = 'quiz_peek' then
    v_t := vv_court_uuid(p_payload->>'target');
    v_camp := p_payload->>'camp';
    if v_t is null or v_t = p_filer
       or not exists (select 1 from players where id = v_t and room_id = p_room) then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    if v_camp is null or v_camp not in ('vice', 'virtue', 'neutral') then
      return jsonb_build_object('ok', false, 'reason', 'bad_camp');
    end if;
    if v_q.kind is distinct from 'peek' then
      return jsonb_build_object('ok', false, 'reason', 'implausible');
    end if;
    v_genuine := v_q.target_id is not distinct from v_t
                 and (v_q.result->'peek'->>'camp') is not distinct from v_camp;
    v_norm := jsonb_build_object('day', v_day, 'target', v_t, 'camp', v_camp);

  elsif p_kind = 'quiz_hint' then
    v_a := vv_court_uuid(p_payload->>'a');
    v_b := vv_court_uuid(p_payload->>'b');
    v_form := p_payload->>'form';
    v_camp := p_payload->>'camp';
    if v_a is null or v_b is null or v_a = v_b or p_filer in (v_a, v_b)
       or (select count(*) from players where room_id = p_room and id in (v_a, v_b)) <> 2 then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    if v_form is null or v_form not in ('opposite', 'at_least_one') then
      return jsonb_build_object('ok', false, 'reason', 'bad_form');
    end if;
    if v_form = 'opposite' then
      v_camp := null;
    elsif v_camp is null or v_camp not in ('vice', 'virtue') then
      return jsonb_build_object('ok', false, 'reason', 'bad_camp');
    end if;
    if v_q.kind is distinct from 'hint' then
      return jsonb_build_object('ok', false, 'reason', 'implausible');
    end if;
    v_hint := v_q.result->'hint';
    v_genuine := jsonb_typeof(v_hint) = 'object'
      and least(v_hint->>'a', v_hint->>'b') = least(v_a::text, v_b::text)
      and greatest(v_hint->>'a', v_hint->>'b') = greatest(v_a::text, v_b::text)
      and ((v_form = 'opposite' and v_hint->>'kind' = 'opposite')
           or (v_form = 'at_least_one' and v_hint->>'kind' = 'at_least'
               and v_hint->>'camp' = v_camp));
    v_genuine := coalesce(v_genuine, false);
    v_norm := jsonb_strip_nulls(jsonb_build_object('day', v_day, 'a', v_a, 'b', v_b,
                                                   'form', v_form, 'camp', v_camp));

  elsif p_kind in ('msg_received', 'msg_sent') then
    v_other := vv_court_uuid(p_payload->>(case when p_kind = 'msg_received' then 'from' else 'to' end));
    if v_other is null or v_other = p_filer
       or not exists (select 1 from players where id = v_other and room_id = p_room) then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    if p_kind = 'msg_received' then
      v_from := v_other; v_to := p_filer;
    else
      v_from := p_filer; v_to := v_other;
    end if;

    v_msg := p_payload->'message';
    if jsonb_typeof(v_msg) <> 'object' then
      return jsonb_build_object('ok', false, 'reason', 'bad_message');
    end if;
    if v_msg ? 's' then
      -- A premade sentence (any, including a bot's).
      v_s := v_msg->>'s';
      if vv_sentence_text(v_s, null) is null then
        return jsonb_build_object('ok', false, 'reason', 'bad_message');
      end if;
      if vv_sentence_needs_about(v_s) then
        v_about := vv_court_uuid(v_msg->>'about');
        if v_about is null
           or not exists (select 1 from players where id = v_about and room_id = p_room) then
          return jsonb_build_object('ok', false, 'reason', 'bad_message');
        end if;
      end if;
      if v_s = 'self_role' then
        v_role := v_msg->>'role';
        if v_role is null or vv_role_camp(v_role) is null then
          return jsonb_build_object('ok', false, 'reason', 'bad_message');
        end if;
      end if;
      v_norm := jsonb_strip_nulls(jsonb_build_object('s', v_s, 'about', v_about, 'role', v_role));
    else
      v_text := btrim(coalesce(v_msg->>'text', ''));
      if length(v_text) = 0 or length(v_text) > vv_court_n('max_text') then
        return jsonb_build_object('ok', false, 'reason', 'bad_message');
      end if;
      v_norm := jsonb_build_object('text', v_text);
    end if;

    -- The record must show they messaged that day, in that direction.
    if not exists (select 1 from dm_messages
                    where room_id = p_room and day = v_day
                      and sender_id = v_from and recipient_id = v_to) then
      return jsonb_build_object('ok', false, 'reason', 'implausible');
    end if;
    if v_s is not null then
      v_genuine := exists (
        select 1 from dm_messages m
         where m.room_id = p_room and m.day = v_day
           and m.sender_id = v_from and m.recipient_id = v_to
           and m.payload->>'s' = v_s
           and vv_court_uuid(m.payload->>'about') is not distinct from v_about
           and (m.payload->>'role') is not distinct from v_role);
    else
      v_genuine := exists (
        select 1 from dm_messages m
         where m.room_id = p_room and m.day = v_day
           and m.sender_id = v_from and m.recipient_id = v_to
           and m.payload is null and btrim(m.text) = v_text);
    end if;
    v_norm := jsonb_build_object('day', v_day,
                                 case when p_kind = 'msg_received' then 'from' else 'to' end, v_other,
                                 'message', v_norm);
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;

  return jsonb_build_object('ok', true, 'genuine', v_genuine, 'payload', v_norm);
end;
$$;
revoke all on function vv_court_check_exhibit(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;

-- Put Soul Energy on an open charge (a press stake or a +25), within the cap.
create or replace function vv_court_stake(p_player uuid, p_charge uuid, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_day integer; v_def uuid; v_total integer;
begin
  select room_id, day, defendant_id into v_room, v_day, v_def
    from court_charges where id = p_charge and status = 'open';
  if v_room is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_charge');
  end if;
  if v_def = p_player then
    return jsonb_build_object('ok', false, 'reason', 'own_charge');
  end if;
  select coalesce(sum(amount), 0) into v_total
    from court_stakes where charge_id = p_charge and player_id = p_player;
  if v_total + p_amount > vv_court_n('cap') then
    return jsonb_build_object('ok', false, 'reason', 'cap');
  end if;
  if not vv_court_pay(v_room, v_day, p_player, -p_amount, p_reason, p_charge) then
    return jsonb_build_object('ok', false, 'reason', 'cant_afford');
  end if;
  insert into court_stakes (room_id, charge_id, player_id, amount)
  values (v_room, p_charge, p_player, p_amount);
  return jsonb_build_object('ok', true, 'charge_id', p_charge);
end;
$$;
revoke all on function vv_court_stake(uuid, uuid, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The docket

-- Press a charge (once a day). An identical charge (defendant + kind + victim)
-- is backed with the stake instead, and the press isn't used up.
create or replace function press_charge_impl(
  p_player uuid, p_defendant uuid, p_kind text, p_victim uuid, p_stake integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_se integer;
  v_victim uuid := p_victim; v_charge uuid; v_res jsonb;
begin
  select p.room_id, p.dead, p.in_prison, p.in_hospital, p.soul_energy, r.day, r.phase, r.court_step
    into v_room, v_dead, v_prison, v_hosp, v_se, v_day, v_phase, v_step
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player
     for update of p;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'consultation' or v_step is distinct from 'docket' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_step');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if p_stake is null or p_stake not in (25, 50, 75, 100) then
    return jsonb_build_object('ok', false, 'reason', 'bad_stake');
  end if;
  if p_defendant is null or p_defendant = p_player
     or not exists (select 1 from players where id = p_defendant and room_id = v_room
                                            and not dead and not in_prison) then
    return jsonb_build_object('ok', false, 'reason', 'bad_defendant');
  end if;

  if p_kind = 'vice' then
    v_victim := null;
  elsif p_kind = 'murder' then
    if v_victim is null or not (v_victim = any(vv_court_victims(v_room))) then
      return jsonb_build_object('ok', false, 'reason', 'bad_victim');
    end if;
  elsif p_kind = 'false_witness' then
    v_victim := null;
    if not exists (select 1 from dm_messages
                    where room_id = v_room and day = v_day
                      and sender_id = p_defendant and recipient_id = p_player) then
      return jsonb_build_object('ok', false, 'reason', 'no_message');
    end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;

  select id into v_charge from court_charges
   where room_id = v_room and day = v_day and defendant_id = p_defendant
     and kind = p_kind and victim_id is not distinct from v_victim;
  if v_charge is null then
    if exists (select 1 from court_charges
                where room_id = v_room and day = v_day and pressed_by = p_player) then
      return jsonb_build_object('ok', false, 'reason', 'already_pressed');
    end if;
    if v_se < p_stake then
      return jsonb_build_object('ok', false, 'reason', 'cant_afford');
    end if;
    insert into court_charges (room_id, day, defendant_id, kind, victim_id, pressed_by)
    values (v_room, v_day, p_defendant, p_kind, v_victim, p_player)
    on conflict do nothing
    returning id into v_charge;
    if v_charge is not null then
      return vv_court_stake(p_player, v_charge, p_stake, 'press') || jsonb_build_object('pressed', true);
    end if;
    -- Pressed by someone else a moment ago: back theirs.
    select id into v_charge from court_charges
     where room_id = v_room and day = v_day and defendant_id = p_defendant
       and kind = p_kind and victim_id is not distinct from v_victim;
  end if;
  v_res := vv_court_stake(p_player, v_charge, p_stake, 'back');
  return v_res || jsonb_build_object('backed', true);
end;
$$;
revoke all on function press_charge_impl(uuid, uuid, text, uuid, integer) from public, anon, authenticated;

create or replace function press_charge(
  p_player_id uuid, p_defendant uuid, p_kind text, p_victim uuid default null, p_stake integer default 25
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
  return press_charge_impl(p_player_id, p_defendant, p_kind, p_victim, p_stake);
end;
$$;
grant execute on function press_charge(uuid, uuid, text, uuid, integer) to anon, authenticated;

-- +25 on a charge (never one against yourself; no withdrawals).
create or replace function back_charge_impl(p_player uuid, p_charge uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, p.dead, p.in_prison, p.in_hospital, r.day, r.phase, r.court_step
    into v_room, v_dead, v_prison, v_hosp, v_day, v_phase, v_step
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player
     for update of p;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'consultation' or v_step is distinct from 'docket' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_step');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if not exists (select 1 from court_charges
                  where id = p_charge and room_id = v_room and day = v_day and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'bad_charge');
  end if;
  return vv_court_stake(p_player, p_charge, vv_court_n('stake_step'), 'back');
end;
$$;
revoke all on function back_charge_impl(uuid, uuid) from public, anon, authenticated;

create or replace function back_charge(p_player_id uuid, p_charge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return back_charge_impl(p_player_id, p_charge_id);
end;
$$;
grant execute on function back_charge(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trial

-- A prosecution exhibit: "against" half, one per player, any actor but the
-- defendant and their witness. 50 SE into the pot.
create or replace function file_exhibit_impl(p_player uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text; v_def uuid;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_se integer;
  v_check jsonb; v_number integer; v_id uuid;
begin
  select p.room_id, p.dead, p.in_prison, p.in_hospital, p.soul_energy,
         r.day, r.phase, r.court_step, r.court_defendant_id
    into v_room, v_dead, v_prison, v_hosp, v_se, v_day, v_phase, v_step, v_def
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player
     for update of p;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'consultation' or v_step is distinct from 'against' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_step');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if p_player = v_def then
    return jsonb_build_object('ok', false, 'reason', 'defendant');
  end if;
  if exists (select 1 from court_witness where room_id = v_room and day = v_day
                and witness_id = p_player and status in ('called', 'accepted')) then
    return jsonb_build_object('ok', false, 'reason', 'witness');
  end if;
  -- One filing at a time per court (exhibit numbers).
  perform 1 from court_days where room_id = v_room and day = v_day for update;
  if exists (select 1 from court_exhibits where room_id = v_room and day = v_day
                and side = 'P' and filer_id = p_player) then
    return jsonb_build_object('ok', false, 'reason', 'already_filed');
  end if;
  if v_se < vv_court_n('exhibit') then
    return jsonb_build_object('ok', false, 'reason', 'cant_afford');
  end if;
  v_check := vv_court_check_exhibit(p_player, v_room, v_day, p_kind, p_payload);
  if not coalesce((v_check->>'ok')::boolean, false) then return v_check; end if;

  select coalesce(max(number), 0) + 1 into v_number
    from court_exhibits where room_id = v_room and day = v_day and side = 'P';
  insert into court_exhibits (room_id, day, number, side, filer_id, kind, payload, cost)
  values (v_room, v_day, v_number, 'P', p_player, p_kind, v_check->'payload', vv_court_n('exhibit'))
  returning id into v_id;
  insert into court_exhibit_truth (exhibit_id, genuine)
  values (v_id, (v_check->>'genuine')::boolean);
  perform vv_court_pay(v_room, v_day, p_player, -vv_court_n('exhibit'), 'exhibit', v_id);
  perform vv_court_extend(v_room, v_day);
  perform vv_court_rep(v_room, p_player, 'exhibits');
  return jsonb_build_object('ok', true, 'exhibit_id', v_id, 'number', v_number,
                            'genuine', (v_check->>'genuine')::boolean);
end;
$$;
revoke all on function file_exhibit_impl(uuid, text, jsonb) from public, anon, authenticated;

create or replace function file_exhibit(p_player_id uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return file_exhibit_impl(p_player_id, p_kind, p_payload);
end;
$$;
grant execute on function file_exhibit(uuid, text, jsonb) to anon, authenticated;

-- The defendant calls one witness (either half): a living player with no stake
-- in the case — not a backer of the tried charges, not an exhibit filer.
-- Hospitalised or imprisoned witnesses are fine; so is a hospitalised
-- defendant (decision 2026-11-05).
create or replace function call_witness_impl(p_player uuid, p_witness uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_day integer; v_phase text; v_step text; v_def uuid; v_dead boolean;
begin
  select p.room_id, p.dead, r.day, r.phase, r.court_step, r.court_defendant_id
    into v_room, v_dead, v_day, v_phase, v_step, v_def
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'consultation' or v_step is null or v_step not in ('against', 'defence') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_step');
  end if;
  if p_player is distinct from v_def or v_dead then
    return jsonb_build_object('ok', false, 'reason', 'not_defendant');
  end if;
  if p_witness is null or p_witness = p_player
     or not exists (select 1 from players where id = p_witness and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false, 'reason', 'bad_witness');
  end if;
  if exists (select 1 from court_stakes s join court_charges c on c.id = s.charge_id
              where c.room_id = v_room and c.day = v_day and c.status = 'tried'
                and s.player_id = p_witness)
     or exists (select 1 from court_exhibits where room_id = v_room and day = v_day
                   and filer_id = p_witness) then
    return jsonb_build_object('ok', false, 'reason', 'has_stake');
  end if;
  insert into court_witness (room_id, day, witness_id)
  values (v_room, v_day, p_witness)
  on conflict (room_id, day) do nothing;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already_called');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function call_witness_impl(uuid, uuid) from public, anon, authenticated;

create or replace function call_witness(p_player_id uuid, p_witness_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return call_witness_impl(p_player_id, p_witness_id);
end;
$$;
grant execute on function call_witness(uuid, uuid) to anon, authenticated;

-- The witness answers within 15 s; later counts as refusing.
create or replace function answer_witness_impl(p_player uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text; v_dead boolean;
  v_status text; v_called timestamptz;
begin
  select p.room_id, p.dead, r.day, r.phase, r.court_step
    into v_room, v_dead, v_day, v_phase, v_step
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select status, called_at into v_status, v_called
    from court_witness
   where room_id = v_room and day = v_day and witness_id = p_player
     for update;
  if v_status is distinct from 'called' then
    return jsonb_build_object('ok', false, 'reason', 'not_called');
  end if;
  if v_phase is distinct from 'consultation' or v_step is null or v_step not in ('against', 'defence')
     or v_dead or now() > v_called + make_interval(secs => vv_court_n('witness_window')) then
    update court_witness set status = 'refused', answered_at = now()
     where room_id = v_room and day = v_day;
    perform vv_court_rep(v_room, p_player, 'witness_refused');
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;
  update court_witness
     set status = case when coalesce(p_accept, false) then 'accepted' else 'refused' end,
         answered_at = now()
   where room_id = v_room and day = v_day;
  perform vv_court_rep(v_room, p_player,
                       case when coalesce(p_accept, false) then 'witness_accepted' else 'witness_refused' end);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function answer_witness_impl(uuid, boolean) from public, anon, authenticated;

create or replace function answer_witness(p_player_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return answer_witness_impl(p_player_id, p_accept);
end;
$$;
grant execute on function answer_witness(uuid, boolean) to anon, authenticated;

-- The accepted witness's one counterproof (D1): "defence" half, 50 SE of their
-- own (not in the pot). Hospital and prison don't stop a witness.
create or replace function file_counterproof_impl(p_player uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text; v_dead boolean; v_se integer;
  v_check jsonb; v_id uuid;
begin
  select p.room_id, p.dead, p.soul_energy, r.day, r.phase, r.court_step
    into v_room, v_dead, v_se, v_day, v_phase, v_step
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player
     for update of p;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'consultation' or v_step is distinct from 'defence' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_step');
  end if;
  if v_dead or not exists (select 1 from court_witness where room_id = v_room and day = v_day
                              and witness_id = p_player and status = 'accepted') then
    return jsonb_build_object('ok', false, 'reason', 'not_witness');
  end if;
  perform 1 from court_days where room_id = v_room and day = v_day for update;
  if exists (select 1 from court_exhibits where room_id = v_room and day = v_day and side = 'D') then
    return jsonb_build_object('ok', false, 'reason', 'already_filed');
  end if;
  if v_se < vv_court_n('counterproof') then
    return jsonb_build_object('ok', false, 'reason', 'cant_afford');
  end if;
  v_check := vv_court_check_exhibit(p_player, v_room, v_day, p_kind, p_payload);
  if not coalesce((v_check->>'ok')::boolean, false) then return v_check; end if;

  insert into court_exhibits (room_id, day, number, side, filer_id, kind, payload, cost)
  values (v_room, v_day, 1, 'D', p_player, p_kind, v_check->'payload', vv_court_n('counterproof'))
  returning id into v_id;
  insert into court_exhibit_truth (exhibit_id, genuine)
  values (v_id, (v_check->>'genuine')::boolean);
  perform vv_court_pay(v_room, v_day, p_player, -vv_court_n('counterproof'), 'counterproof', v_id);
  perform vv_court_extend(v_room, v_day);
  perform vv_court_rep(v_room, p_player, 'exhibits');
  return jsonb_build_object('ok', true, 'exhibit_id', v_id, 'number', 1,
                            'genuine', (v_check->>'genuine')::boolean);
end;
$$;
revoke all on function file_counterproof_impl(uuid, text, jsonb) from public, anon, authenticated;

create or replace function file_counterproof(p_player_id uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return file_counterproof_impl(p_player_id, p_kind, p_payload);
end;
$$;
grant execute on function file_counterproof(uuid, text, jsonb) to anon, authenticated;

-- Object to an exhibit (50 SE; each exhibit once; ruled on the spot — only
-- FORGED or UPHELD, never the truth behind it).
--   P exhibit: any actor but its filer. Forged → objector gets 100 (their 50 +
--     the filer's), exhibit struck (its 50 leaves the pot). Genuine → the
--     objector's 50 goes to the filer.
--   D1: any actor but the defendant and the witness. Forged → objector gets 100
--     (their 50 + the witness's). Genuine → the objector's 50 goes to the
--     defendant.
create or replace function object_exhibit_impl(p_player uuid, p_exhibit uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text; v_def uuid;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_se integer;
  e court_exhibits%rowtype; v_genuine boolean; v_ruling text;
begin
  select p.room_id, p.dead, p.in_prison, p.in_hospital, p.soul_energy,
         r.day, r.phase, r.court_step, r.court_defendant_id
    into v_room, v_dead, v_prison, v_hosp, v_se, v_day, v_phase, v_step, v_def
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player
     for update of p;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'consultation' or v_step is null or v_step not in ('against', 'defence') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_step');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  perform 1 from court_days where room_id = v_room and day = v_day for update;
  select * into e from court_exhibits
   where id = p_exhibit and room_id = v_room and day = v_day;
  if e.id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_exhibit');
  end if;
  if e.side = 'P' and e.filer_id = p_player then
    return jsonb_build_object('ok', false, 'reason', 'own_exhibit');
  end if;
  if e.side = 'D' and p_player in (v_def, e.filer_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if exists (select 1 from court_objections where exhibit_id = p_exhibit) then
    return jsonb_build_object('ok', false, 'reason', 'already_objected');
  end if;
  if v_se < vv_court_n('objection') then
    return jsonb_build_object('ok', false, 'reason', 'cant_afford');
  end if;

  select genuine into v_genuine from court_exhibit_truth where exhibit_id = p_exhibit;
  v_genuine := coalesce(v_genuine, true);
  perform vv_court_pay(v_room, v_day, p_player, -vv_court_n('objection'), 'objection', p_exhibit);
  if not v_genuine then
    v_ruling := 'forged';
    update court_exhibits set status = 'forged' where id = p_exhibit;
    perform vv_court_pay(v_room, v_day, p_player, vv_court_n('objection') + e.cost,
                         'objection_won', p_exhibit);
    perform vv_court_rep(v_room, p_player, 'objections_won');
    perform vv_court_rep(v_room, e.filer_id, 'exhibits_forged');
  else
    v_ruling := 'upheld';
    update court_exhibits set status = 'upheld' where id = p_exhibit;
    perform vv_court_pay(v_room, v_day,
                         case when e.side = 'P' then e.filer_id else v_def end,
                         vv_court_n('objection'), 'objection_fee', p_exhibit);
    perform vv_court_rep(v_room, p_player, 'objections_lost');
    perform vv_court_rep(v_room, e.filer_id, 'exhibits_upheld');
  end if;
  insert into court_objections (room_id, exhibit_id, objector_id, ruling)
  values (v_room, p_exhibit, p_player, v_ruling);
  return jsonb_build_object('ok', true, 'ruling', v_ruling);
end;
$$;
revoke all on function object_exhibit_impl(uuid, uuid) from public, anon, authenticated;

create or replace function object_exhibit(p_player_id uuid, p_exhibit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return object_exhibit_impl(p_player_id, p_exhibit_id);
end;
$$;
grant execute on function object_exhibit(uuid, uuid) to anon, authenticated;

commit;
