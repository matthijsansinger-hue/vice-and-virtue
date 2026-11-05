-- 142: The Trial — whole-chat proof, 10 SE steps, and the court's new role
-- abilities (Matthijs, 2026-11-05).
--
--   * Docket stakes go in steps of 10 (press 10, 20 … 100; back +10), cap 100.
--   * Text proof is a WHOLE chat: one day's conversation between the filer and
--     one other player, every message in order (exhibit kind 'chat'). Changing,
--     adding or leaving out any message makes it a forgery. The old one-message
--     kinds (msg_received / msg_sent) can no longer be filed.
--   * Role abilities bought in the role phase (use_power — one ability a day,
--     like every role), recorded in day_powers (locked):
--       diligence        100  Diligence sees, live in the courtroom, whether each
--                              exhibit and counterproof filed today is genuine
--       truth            100  Truthfulness swears the court to truth: nobody can
--                              file a forgery today (the court shows it is sworn,
--                              never by whom)
--       justice          100  Justice: if he is a prosecutor and votes Guilty and
--                              the defendant is a Vice, the defendant goes to
--                              prison whatever the count (court_days.by_justice)
--       pride_shield     100  Pride can't be imprisoned at today's consultation
--                              (the Wandering Soul's ward flag: all refunded)
--       pride_broadcast  200  Pride turns today's Outreach into a read-only
--                              global chat (enforced by migration 143)
--   * Truthfulness files exhibits and counterproof for free (passive).
--   * Retired: Pride's reveal (now); Truthfulness's 200 SE vote reveal (once
--     the court is live). Justice's shield/kill: see 143.
--
-- Diligence, Truthfulness and Justice only work once vv_court_live() is on
-- (use_power answers 'not_yet' before). Pride's two abilities work now.
-- Requires 141. Safe to re-run.

begin;
-- ---------------------------------------------------------------------------
-- Tunables (stake_step 10, the ability prices)
create or replace function vv_court_n(p_key text)
returns integer language sql immutable as $$
  select case p_key
    when 'stake_step'       then 10     -- backing step; press stakes 10, 20 … 100
    when 'cap'              then 100    -- per player per charge (press stake counts)
    when 'exhibit'          then 50
    when 'counterproof'     then 50
    when 'objection'        then 50
    when 'extend'           then 10     -- seconds an exhibit/counterproof adds
    when 'extend_cap'       then 30     -- per trial
    when 'witness_window'   then 15     -- seconds to answer a call
    when 'docket'           then 75
    when 'half'             then 30
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
-- Tables

-- Abilities bought for one day (locked; read through the RPCs).
create table if not exists day_powers (
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  player_id uuid not null references players(id) on delete cascade,
  power text not null check (power in ('diligence', 'truth', 'justice',
                                       'pride_shield', 'pride_broadcast')),
  created_at timestamptz not null default now(),
  primary key (room_id, day, power, player_id)
);
alter table day_powers enable row level security;

-- Justice's verdict, public with the trial.
alter table court_days add column if not exists by_justice boolean not null default false;

-- The whole-chat exhibit.
alter table court_exhibits drop constraint if exists court_exhibits_kind_check;
alter table court_exhibits add constraint court_exhibits_kind_check
  check (kind in ('quiz_peek', 'quiz_hint', 'msg_received', 'msg_sent', 'chat'));

-- ---------------------------------------------------------------------------
-- Buying a role ability for today (role phase).
create or replace function use_power_impl(p_player_id uuid, p_power text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_day integer; v_role text; v_se numeric; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_need text; v_cost integer;
begin
  select p.room_id, r.phase, r.day, s.role, p.soul_energy, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_day, v_role, v_se, v_acted, v_dead, v_prison, v_hosp
    from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
   where p.id = p_player_id
     for update of p;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_need := case p_power
              when 'diligence' then 'diligence'
              when 'truth' then 'truthfulness'
              when 'justice' then 'justice'
              when 'pride_shield' then 'pride'
              when 'pride_broadcast' then 'pride'
            end;
  v_cost := case when p_power = 'pride_broadcast' then vv_court_n('broadcast')
                 else vv_court_n('power') end;
  if v_need is null then return jsonb_build_object('ok', false, 'reason', 'bad_power'); end if;
  if v_role is distinct from v_need then
    return jsonb_build_object('ok', false, 'reason', 'not_your_role');
  end if;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if v_acted then return jsonb_build_object('ok', false, 'reason', 'already_acted'); end if;
  if p_power in ('diligence', 'truth', 'justice') and not vv_court_live() then
    return jsonb_build_object('ok', false, 'reason', 'not_yet');
  end if;
  if v_se < v_cost then return jsonb_build_object('ok', false, 'reason', 'cant_afford'); end if;

  update players set soul_energy = soul_energy - v_cost, acted_this_day = true
   where id = p_player_id;
  insert into day_powers (room_id, day, player_id, power)
  values (v_room, v_day, p_player_id, p_power)
  on conflict do nothing;
  if p_power = 'pride_shield' then
    -- The Wandering Soul's ward flag: no prison at this consultation (old vote
    -- and court alike); spent when the consultation ends.
    update player_secrets set potion_soul_protect = true where player_id = p_player_id;
  end if;
  return jsonb_build_object('ok', true, 'power', p_power, 'cost', v_cost);
end;
$$;
revoke all on function use_power_impl(uuid, text) from public, anon, authenticated;

create or replace function use_power(p_player_id uuid, p_power text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return use_power_impl(p_player_id, p_power);
end;
$$;
grant execute on function use_power(uuid, text) to anon, authenticated;

-- The abilities the caller bought today (their own only).
create or replace function my_powers(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(dp.power)
      from day_powers dp
      join players p on p.id = dp.player_id
      join rooms r on r.id = p.room_id
     where dp.player_id = p_player_id and dp.room_id = r.id and dp.day = r.day), '[]'::jsonb);
end;
$$;
grant execute on function my_powers(uuid) to anon, authenticated;

-- Is the court on? (The client picks the consultation screen and the role
-- panels from this.)
create or replace function court_live()
returns boolean language sql stable security definer set search_path = public as $$
  select vv_court_live();
$$;
grant execute on function court_live() to anon, authenticated;

-- Pride's old reveal is replaced by the shield and the broadcast.
create or replace function pride_reveal_impl(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object('ok', false, 'reason', 'retired');
end; $$;
revoke all on function pride_reveal_impl(uuid) from public, anon, authenticated;

-- Truthfulness's 200 SE vote reveal: gone once the court is live.
create or replace function reveal_votes_truthfulness_impl(p_player_id uuid)
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
begin
  -- Replaced by the sworn court and free proof once the court is live (142).
  if vv_court_live() then return false; end if;

  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_role
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_role is distinct from 'truthfulness'
     or v_acted or v_se < 200 then
    return false;
  end if;

  if (consultation_tally(v_room_id) ->> 'imprisoned_id') is null then
    return false;
  end if;

  update players set soul_energy = soul_energy - 200, acted_this_day = true
  where id = p_player_id;
  update rooms set vote_reveal = true where id = v_room_id;
  return true;
end;
$$;
revoke all on function reveal_votes_truthfulness_impl(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The docket in steps of 10 (back_charge already reads stake_step).
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
  -- 10, 20 … 100 (migration 142).
  if p_stake is null or p_stake < vv_court_n('stake_step') or p_stake > vv_court_n('cap')
     or p_stake % vv_court_n('stake_step') <> 0 then
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

-- ---------------------------------------------------------------------------
-- Exhibit check: the Quiz kinds as before, text proof = a whole chat.
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
  v_m jsonb; v_mfrom uuid; v_claim jsonb := '[]'::jsonb; v_real jsonb;
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

  elsif p_kind = 'chat' then
    -- A whole chat (142): one day's messages between the filer and one other
    -- player, all of them, in order. Genuine only if it is exactly the record.
    v_other := vv_court_uuid(p_payload->>'with');
    if v_other is null or v_other = p_filer
       or not exists (select 1 from players where id = v_other and room_id = p_room) then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    if jsonb_typeof(p_payload->'messages') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'reason', 'bad_message');
    end if;
    if jsonb_array_length(p_payload->'messages') = 0
       or jsonb_array_length(p_payload->'messages') > vv_court_n('chat_max') then
      return jsonb_build_object('ok', false, 'reason', 'bad_message');
    end if;
    -- The record must show they talked that day.
    if not exists (select 1 from dm_messages
                    where room_id = p_room and day = v_day
                      and ((sender_id = p_filer and recipient_id = v_other)
                           or (sender_id = v_other and recipient_id = p_filer))) then
      return jsonb_build_object('ok', false, 'reason', 'implausible');
    end if;

    for v_m in select value from jsonb_array_elements(p_payload->'messages') loop
      if jsonb_typeof(v_m) is distinct from 'object' then
        return jsonb_build_object('ok', false, 'reason', 'bad_message');
      end if;
      v_mfrom := vv_court_uuid(v_m->>'from');
      if v_mfrom is null or v_mfrom not in (p_filer, v_other) then
        return jsonb_build_object('ok', false, 'reason', 'bad_message');
      end if;
      v_about := null; v_role := null;
      if v_m ? 's' then
        v_s := v_m->>'s';
        if vv_sentence_text(v_s, null) is null then
          return jsonb_build_object('ok', false, 'reason', 'bad_message');
        end if;
        if vv_sentence_needs_about(v_s) then
          v_about := vv_court_uuid(v_m->>'about');
          if v_about is null
             or not exists (select 1 from players where id = v_about and room_id = p_room) then
            return jsonb_build_object('ok', false, 'reason', 'bad_message');
          end if;
        end if;
        if v_s = 'self_role' then
          v_role := v_m->>'role';
          if v_role is null or vv_role_camp(v_role) is null then
            return jsonb_build_object('ok', false, 'reason', 'bad_message');
          end if;
        end if;
        v_claim := v_claim || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                     'from', v_mfrom, 's', v_s, 'about', v_about, 'role', v_role)));
      else
        v_text := btrim(coalesce(v_m->>'text', ''));
        if length(v_text) = 0 or length(v_text) > vv_court_n('max_text') then
          return jsonb_build_object('ok', false, 'reason', 'bad_message');
        end if;
        v_claim := v_claim || jsonb_build_array(jsonb_build_object('from', v_mfrom, 'text', v_text));
      end if;
    end loop;

    select coalesce(jsonb_agg(
             case when m.payload ? 's' then
                    jsonb_strip_nulls(jsonb_build_object(
                      'from', m.sender_id, 's', m.payload->>'s',
                      'about', vv_court_uuid(m.payload->>'about'), 'role', m.payload->>'role'))
                  else jsonb_build_object('from', m.sender_id, 'text', btrim(m.text)) end
             order by m.created_at, m.id), '[]'::jsonb)
      into v_real
      from dm_messages m
     where m.room_id = p_room and m.day = v_day
       and ((m.sender_id = p_filer and m.recipient_id = v_other)
            or (m.sender_id = v_other and m.recipient_id = p_filer));
    v_genuine := v_claim = v_real;
    v_norm := jsonb_build_object('day', v_day, 'with', v_other, 'messages', v_claim);
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;

  return jsonb_build_object('ok', true, 'genuine', v_genuine, 'payload', v_norm);
end;
$$;
revoke all on function vv_court_check_exhibit(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;

create or replace function file_exhibit_impl(p_player uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_se integer;
  v_check jsonb; v_number integer; v_id uuid; v_cost integer;
begin
  select p.room_id, p.dead, p.in_prison, p.in_hospital, p.soul_energy,
         r.day, r.phase, r.court_step
    into v_room, v_dead, v_prison, v_hosp, v_se, v_day, v_phase, v_step
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
  -- The defendant and the witness can never be prosecutors (no stake on your
  -- own case; a witness has none), so this also keeps them out.
  if not vv_court_is_prosecutor(v_room, v_day, p_player) then
    return jsonb_build_object('ok', false, 'reason', 'not_prosecutor');
  end if;
  -- One filing at a time per court (exhibit numbers).
  perform 1 from court_days where room_id = v_room and day = v_day for update;
  if exists (select 1 from court_exhibits where room_id = v_room and day = v_day
                and side = 'P' and filer_id = p_player) then
    return jsonb_build_object('ok', false, 'reason', 'already_filed');
  end if;
  -- Truthfulness files for free (142).
  v_cost := case when exists (select 1 from player_secrets
                               where player_id = p_player and role = 'truthfulness')
                 then 0 else vv_court_n('exhibit') end;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'cant_afford');
  end if;
  v_check := vv_court_check_exhibit(p_player, v_room, v_day, p_kind, p_payload);
  if not coalesce((v_check->>'ok')::boolean, false) then return v_check; end if;
  -- A court sworn to truth (Truthfulness, 142) takes no forgeries.
  if not coalesce((v_check->>'genuine')::boolean, false)
     and exists (select 1 from day_powers
                  where room_id = v_room and day = v_day and power = 'truth') then
    return jsonb_build_object('ok', false, 'reason', 'sworn');
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from court_exhibits where room_id = v_room and day = v_day and side = 'P';
  insert into court_exhibits (room_id, day, number, side, filer_id, kind, payload, cost)
  values (v_room, v_day, v_number, 'P', p_player, p_kind, v_check->'payload', v_cost)
  returning id into v_id;
  insert into court_exhibit_truth (exhibit_id, genuine)
  values (v_id, (v_check->>'genuine')::boolean);
  perform vv_court_pay(v_room, v_day, p_player, -v_cost, 'exhibit', v_id);
  perform vv_court_extend(v_room, v_day);
  perform vv_court_rep(v_room, p_player, 'exhibits');
  return jsonb_build_object('ok', true, 'exhibit_id', v_id, 'number', v_number,
                            'genuine', (v_check->>'genuine')::boolean);
end;
$$;
revoke all on function file_exhibit_impl(uuid, text, jsonb) from public, anon, authenticated;

create or replace function file_counterproof_impl(p_player uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text; v_def uuid;
  v_dead boolean; v_se integer;
  v_check jsonb; v_number integer; v_id uuid; v_cost integer;
begin
  select p.room_id, p.dead, p.soul_energy, r.day, r.phase, r.court_step, r.court_defendant_id
    into v_room, v_dead, v_se, v_day, v_phase, v_step, v_def
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player
     for update of p;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'consultation' or v_step is distinct from 'defence' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_step');
  end if;
  if v_dead then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if p_player is distinct from v_def
     and not exists (select 1 from court_witness where room_id = v_room and day = v_day
                        and witness_id = p_player and status = 'accepted') then
    return jsonb_build_object('ok', false, 'reason', 'not_defence');
  end if;
  perform 1 from court_days where room_id = v_room and day = v_day for update;
  if exists (select 1 from court_exhibits where room_id = v_room and day = v_day
                and side = 'D' and filer_id = p_player) then
    return jsonb_build_object('ok', false, 'reason', 'already_filed');
  end if;
  -- Truthfulness files for free (142).
  v_cost := case when exists (select 1 from player_secrets
                               where player_id = p_player and role = 'truthfulness')
                 then 0 else vv_court_n('counterproof') end;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'cant_afford');
  end if;
  v_check := vv_court_check_exhibit(p_player, v_room, v_day, p_kind, p_payload);
  if not coalesce((v_check->>'ok')::boolean, false) then return v_check; end if;
  -- A court sworn to truth (Truthfulness, 142) takes no forgeries.
  if not coalesce((v_check->>'genuine')::boolean, false)
     and exists (select 1 from day_powers
                  where room_id = v_room and day = v_day and power = 'truth') then
    return jsonb_build_object('ok', false, 'reason', 'sworn');
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from court_exhibits where room_id = v_room and day = v_day and side = 'D';
  insert into court_exhibits (room_id, day, number, side, filer_id, kind, payload, cost)
  values (v_room, v_day, v_number, 'D', p_player, p_kind, v_check->'payload', v_cost)
  returning id into v_id;
  insert into court_exhibit_truth (exhibit_id, genuine)
  values (v_id, (v_check->>'genuine')::boolean);
  perform vv_court_pay(v_room, v_day, p_player, -v_cost, 'counterproof', v_id);
  perform vv_court_extend(v_room, v_day);
  perform vv_court_rep(v_room, p_player, 'exhibits');
  return jsonb_build_object('ok', true, 'exhibit_id', v_id, 'number', v_number,
                            'genuine', (v_check->>'genuine')::boolean);
end;
$$;
revoke all on function file_counterproof_impl(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The verdict, with Justice.
create or replace function vv_court_close_verdict(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day integer; v_def uuid; v_love text; v_love_vote text;
  v_g integer; v_ng integer; v_jurors integer; v_guilty boolean; v_outcome text;
  v_justice boolean := false;
begin
  select day, court_defendant_id, love_tiebreak into v_day, v_def, v_love
    from rooms where id = p_room_id;

  -- Everyone who could vote: free, not in hospital, not the defendant. Iron
  -- Will counts twice; the floor counts people.
  select coalesce(sum(case when s.potion_iron_will then 2 else 1 end)
                    filter (where s.vote = v_def::text), 0),
         coalesce(sum(case when s.potion_iron_will then 2 else 1 end)
                    filter (where s.vote = 'skip'), 0),
         count(*) filter (where s.vote = v_def::text)
    into v_g, v_ng, v_jurors
    from players p join player_secrets s on s.player_id = p.id
   where p.room_id = p_room_id and p.id <> v_def
     and not p.dead and not p.in_prison and not p.in_hospital;

  v_guilty := v_g > v_ng;
  -- A tie: Love's armed tie-break decides by Love's own (counted) vote.
  if v_g = v_ng and v_g > 0 and v_love is not null then
    select s.vote into v_love_vote
      from players p join player_secrets s on s.player_id = p.id
     where p.id = vv_court_uuid(v_love) and p.room_id = p_room_id and p.id <> v_def
       and not p.dead and not p.in_prison and not p.in_hospital;
    v_guilty := v_love_vote is not distinct from v_def::text;
  end if;
  v_guilty := v_guilty and v_jurors >= vv_court_n('guilty_floor');

  -- Justice (142): armed this morning, a prosecutor, and voted Guilty — a Vice
  -- defendant goes to prison whatever the count.
  if not v_guilty
     and vv_role_camp((select role from player_secrets where player_id = v_def)) = 'vice'
     and exists (
       select 1 from day_powers dp
         join players j on j.id = dp.player_id
         join player_secrets js on js.player_id = j.id
        where dp.room_id = p_room_id and dp.day = v_day and dp.power = 'justice'
          and j.id <> v_def and not j.dead and not j.in_prison and not j.in_hospital
          and js.vote = v_def::text
          and vv_court_is_prosecutor(p_room_id, v_day, j.id)) then
    v_guilty := true;
    v_justice := true;
  end if;

  if not v_guilty then
    v_outcome := 'spared';
  elsif exists (select 1 from player_secrets where player_id = v_def and potion_soul_protect) then
    v_outcome := 'warded';   -- the Wandering Soul's ward: nobody goes to prison
  else
    v_outcome := 'imprisoned';
    update players set in_prison = true where id = v_def;
    -- Vengeance remembers her jailers: everyone who voted Guilty.
    if exists (select 1 from player_secrets where player_id = v_def and role = 'vengeance') then
      update rooms set vengeance_imprisoners = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
          from (
            select jsonb_array_elements_text(coalesce(vengeance_imprisoners, '[]'::jsonb)) as e
              from rooms where id = p_room_id
            union
            select p.id::text
              from players p join player_secrets s on s.player_id = p.id
             where p.room_id = p_room_id and p.id <> v_def
               and not p.dead and not p.in_prison and not p.in_hospital
               and s.vote = v_def::text
          ) u)
       where id = p_room_id;
    end if;
  end if;

  update court_days
     set guilty = v_g, not_guilty = v_ng, guilty_jurors = v_jurors, outcome = v_outcome,
         by_justice = v_justice
   where room_id = p_room_id and day = v_day;
  perform vv_court_settle(p_room_id, v_day, v_outcome);
  perform vv_court_enter(p_room_id, 'settlement', null);
end;
$$;
revoke all on function vv_court_close_verdict(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The court snapshot (+ sworn, + Diligence).
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
  v_sees := v_dead or exists (select 1 from day_powers
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
grant execute on function court_state(uuid, uuid) to anon, authenticated;

commit;
