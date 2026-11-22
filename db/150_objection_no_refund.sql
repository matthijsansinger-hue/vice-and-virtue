-- 150_objection_no_refund.sql — 2026-11-15, Matthijs: "when objecting you
-- never get back any SE, no matter if it's genuine or forged — objecting is
-- really influential for the game either way", and then "I'd rather have the
-- 100 SE disappear in that case too".
--
-- object_exhibit_impl = the live version with the objection's money taken out
-- of both rulings: the objector pays vv_court_n('objection') (100 since 149,
-- 50 before) and it is gone, whatever the ruling.
--   * FORGED: the proof is struck (its filing cost is lost to its filer); the
--     objector gets nothing (was: their stake back + the filer's cost).
--   * UPHELD: the proof stands; nobody gets the stake (was: paid to the
--     proof's filer, or to the defendant for counterproof).
-- Reputation counters as before. Independent of 147–149; safe to run more
-- than once (re-run it if an earlier version of this file was applied).

begin;

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
    -- (150) The objector never gets anything back — objecting is a pure cost
    -- (Matthijs, 2026-11-15: an objection sways the game whichever way it
    -- goes). The forged proof is struck; its filing cost is simply lost.
    v_ruling := 'forged';
    update court_exhibits set status = 'forged' where id = p_exhibit;
    perform vv_court_rep(v_room, p_player, 'objections_won');
    perform vv_court_rep(v_room, e.filer_id, 'exhibits_forged');
  else
    -- (150) The objector's stake simply disappears here too (was: paid to the
    -- proof's filer, or the defendant for counterproof).
    v_ruling := 'upheld';
    update court_exhibits set status = 'upheld' where id = p_exhibit;
    perform vv_court_rep(v_room, p_player, 'objections_lost');
    perform vv_court_rep(v_room, e.filer_id, 'exhibits_upheld');
  end if;
  insert into court_objections (room_id, exhibit_id, objector_id, ruling)
  values (v_room, p_exhibit, p_player, v_ruling);
  return jsonb_build_object('ok', true, 'ruling', v_ruling);
end;
$$;

commit;
