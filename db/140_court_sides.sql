-- 140: The Trial — two sides in court (design doc "The Trial", 5 Nov 2026;
-- docs/trial-build-spec.md).
--
-- The final design splits the court into two sides, and each side may only
-- check the other's proof:
--   * Prosecutors — everyone who pressed or backed any charge against today's
--     defendant — are the ONLY ones who file exhibits (P1, P2…), and the only
--     ones who may object to counterproof. They must be able to act (alive,
--     not in hospital or prison).
--   * The defence — the defendant and their accepted witness — may EACH file
--     one counterproof in the defence half (D1, D2: at most two per trial),
--     and they are the only ones who may object to a prosecution exhibit
--     (either half). Hospital doesn't stop them; nor does prison stop the
--     witness.
--   * The jury (everyone else who can act) talks and votes; it never files or
--     objects.
-- Money is unchanged: an objection costs 50; forged → the objector gets 100
-- and the proof is struck; genuine → the objector's 50 goes to the exhibit's
-- filer (P) or to the defendant (D, also when the witness filed it).
--
-- Replaces three _impls from 137_court_actions.sql (the gated wrappers are
-- untouched) and adds vv_court_is_prosecutor. The docket close (next batch)
-- marks every charge against the defendant 'tried'; that is what makes its
-- backers prosecutors. Requires 136_court_foundation.sql and
-- 137_court_actions.sql. Safe to re-run.

begin;

-- Pressed or backed any charge against today's defendant.
create or replace function vv_court_is_prosecutor(p_room uuid, p_day integer, p_player uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from court_stakes s join court_charges c on c.id = s.charge_id
     where c.room_id = p_room and c.day = p_day and c.status = 'tried'
       and s.player_id = p_player);
$$;
revoke all on function vv_court_is_prosecutor(uuid, integer, uuid) from public, anon, authenticated;

-- A prosecution exhibit: "against" half, prosecutors only (who can act), one
-- each. 50 SE into the pot.
create or replace function file_exhibit_impl(p_player uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_se integer;
  v_check jsonb; v_number integer; v_id uuid;
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

-- Counterproof: "defence" half; the defendant and the accepted witness may
-- each file one (D1, D2 in filing order), 50 SE of their own (not in the pot).
-- Hospital doesn't stop either of them; prison doesn't stop the witness.
create or replace function file_counterproof_impl(p_player uuid, p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day integer; v_phase text; v_step text; v_def uuid;
  v_dead boolean; v_se integer;
  v_check jsonb; v_number integer; v_id uuid;
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
  if v_se < vv_court_n('counterproof') then
    return jsonb_build_object('ok', false, 'reason', 'cant_afford');
  end if;
  v_check := vv_court_check_exhibit(p_player, v_room, v_day, p_kind, p_payload);
  if not coalesce((v_check->>'ok')::boolean, false) then return v_check; end if;

  select coalesce(max(number), 0) + 1 into v_number
    from court_exhibits where room_id = v_room and day = v_day and side = 'D';
  insert into court_exhibits (room_id, day, number, side, filer_id, kind, payload, cost)
  values (v_room, v_day, v_number, 'D', p_player, p_kind, v_check->'payload', vv_court_n('counterproof'))
  returning id into v_id;
  insert into court_exhibit_truth (exhibit_id, genuine)
  values (v_id, (v_check->>'genuine')::boolean);
  perform vv_court_pay(v_room, v_day, p_player, -vv_court_n('counterproof'), 'counterproof', v_id);
  perform vv_court_extend(v_room, v_day);
  perform vv_court_rep(v_room, p_player, 'exhibits');
  return jsonb_build_object('ok', true, 'exhibit_id', v_id, 'number', v_number,
                            'genuine', (v_check->>'genuine')::boolean);
end;
$$;
revoke all on function file_counterproof_impl(uuid, text, jsonb) from public, anon, authenticated;

-- Object to a piece of proof (50 SE; each piece once; ruled on the spot — only
-- FORGED or UPHELD, never the truth behind it). Each side checks the other:
--   P exhibit (either half): the defendant or the accepted witness only
--     (hospital OK; prison OK for the witness). Forged → objector gets 100
--     (their 50 + the filer's), exhibit struck (its 50 leaves the pot).
--     Genuine → the objector's 50 goes to the filer.
--   D1/D2 counterproof: prosecutors only, who must be able to act. Forged →
--     objector gets 100 (their 50 + the filer's), struck. Genuine → the
--     objector's 50 goes to the defendant, whoever filed it.
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
  if v_dead then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  perform 1 from court_days where room_id = v_room and day = v_day for update;
  select * into e from court_exhibits
   where id = p_exhibit and room_id = v_room and day = v_day;
  if e.id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_exhibit');
  end if;
  if e.side = 'P' then
    if p_player is distinct from v_def
       and not exists (select 1 from court_witness where room_id = v_room and day = v_day
                          and witness_id = p_player and status = 'accepted') then
      return jsonb_build_object('ok', false, 'reason', 'not_defence');
    end if;
  else
    if v_prison or v_hosp then
      return jsonb_build_object('ok', false, 'reason', 'cannot_act');
    end if;
    if not vv_court_is_prosecutor(v_room, v_day, p_player) then
      return jsonb_build_object('ok', false, 'reason', 'not_prosecutor');
    end if;
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

commit;
