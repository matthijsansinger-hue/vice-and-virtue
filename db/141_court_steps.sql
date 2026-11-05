-- 141: The Trial, batch 3 — the court's steps, the verdict and the settlement
-- (docs/trial-build-spec.md; design doc "The Trial", 5 Nov 2026).
--
--   docket 75 s ─(no charges: adjourned → new day)─▶ against 30 s ─▶ defence 30 s
--     ─▶ verdict 45 s ─▶ settlement (until most press Continue) ─▶ new day
--
-- ONE step machine for both room types (decision 2026-11-05):
--   * server rooms: vv_tick_room steps it (cron + every player's tick_room);
--   * private lobbies: the host's client starts the consultation with
--     start_consultation(room) and pings court_tick(room) every few seconds.
--
-- Docket and both halves end on the clock, or early once most players press
-- Done (players.ready; a 10 s countdown, still extended by new exhibits), or at
-- once when everyone has. A witness call still waiting for an answer holds the
-- half open; after 15 s it counts as refused. The verdict ends when everyone who
-- may vote has voted, or on the clock — no majority-advance; unsubmitted =
-- blank. Settlement ends when most players press Continue (10 s countdown).
--
-- Verdict: Guilty = player_secrets.vote = the defendant's id, Not guilty =
-- 'skip', blank = null (submit_vote, so Iron Will, Empathy, Truthfulness,
-- Vengeance's jailers and the vote-reveal potion keep working). Guilty ⇔
-- weighted Guilty > weighted Not guilty AND at least 2 distinct Guilty jurors;
-- a tie goes to Love's armed tie-break (Love's own vote), else Not guilty. The
-- Wandering Soul's ward blocks prison: everyone is refunded.
--
-- Settlement (paid the moment the verdict is in, so the screen shows it):
--   imprisoned  every prosecutor gets 2× what they put in (backing + standing
--               exhibits); counterproof is lost
--   spared      the pot (backing + standing exhibits) goes to the defence:
--               half to the accepted witness, the rest to the defendant (all of
--               it without a witness); each standing counterproof back 2× to its
--               filer
--   warded      everything refunded
-- A defendant who can't be tried any more mid-trial (an instant Sacrifice) →
-- adjourned, everything refunded.
--
-- INERT UNTIL SWITCHED ON: vv_court_live() is false, so every consultation
-- still runs the old vote. The client batch switches it on; to test earlier:
--   create or replace function vv_court_live() returns boolean
--     language sql immutable as $$ select true $$;
-- (Private lobbies also need the new client: the old one starts the
-- consultation itself and so always gets the old vote.)
--
-- Requires 136_court_foundation, 137_court_actions and 140_court_sides.
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Switch and tunables

create or replace function vv_court_live()
returns boolean language sql immutable as $$ select false $$;

create or replace function vv_court_n(p_key text)
returns integer language sql immutable as $$
  select case p_key
    when 'stake_step'       then 25     -- backing step; press stakes are 25/50/75/100
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
  end;
$$;

-- When the current step began (the bots-only grace).
alter table court_days add column if not exists step_at timestamptz;

-- ---------------------------------------------------------------------------
-- Opening the consultation (both room types)

create or replace function vv_start_consultation(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_day integer;
begin
  perform clear_room_votes_impl(p_room_id);
  update players set ready = false where room_id = p_room_id;
  if not vv_court_live() then
    update rooms set phase = 'consultation', vote_reveal = false,
                     phase_ends_at = now() + interval '95 seconds'
     where id = p_room_id;
    return;
  end if;
  update rooms set phase = 'consultation', vote_reveal = false, revote_candidates = null,
                   court_step = 'docket', court_defendant_id = null, server_substate = null,
                   phase_ends_at = now() + make_interval(secs => vv_court_n('docket'))
   where id = p_room_id
  returning day into v_day;
  insert into court_days (room_id, day, step_at) values (p_room_id, v_day, now())
  on conflict (room_id, day) do update set step_at = now();
  perform vv_court_bots(p_room_id, 'docket');
end;
$$;
revoke all on function vv_start_consultation(uuid) from public, anon, authenticated;

-- Server rooms (vv_tick_room's store_summary step).
create or replace function vv_srv_start_consultation(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform vv_start_consultation(p_room_id);
end;
$$;
revoke all on function vv_srv_start_consultation(uuid) from public, anon, authenticated;

-- Private lobbies: the host's client, from the Market recap.
create or replace function start_consultation(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_phase text;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;
  select phase into v_phase from rooms where id = p_room_id for update;
  if v_phase is distinct from 'store_summary' then return; end if;  -- already moved on
  perform vv_start_consultation(p_room_id);
end;
$$;
grant execute on function start_consultation(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Step helpers

-- The bots' moves at the start of a step. For now they only vote in the
-- verdict; the court bots (next batch) replace this.
create or replace function vv_court_bots(p_room_id uuid, p_step text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b record;
begin
  if p_step = 'verdict' then
    for b in
      select id from players
       where room_id = p_room_id and is_bot and not dead
       order by random()
    loop
      begin
        perform vv_bot_vote(b.id, null);
      exception when others then
        raise warning 'vv_court_bots: bot % failed in %: %', b.id, p_step, sqlerrm;
      end;
    end loop;
  end if;
end;
$$;
revoke all on function vv_court_bots(uuid, text) from public, anon, authenticated;

-- Enter a step: its clock (null = until Continue), a fresh Done for every
-- human (bots always count as Done), and the bots' moves.
create or replace function vv_court_enter(p_room_id uuid, p_step text, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_day integer;
begin
  update rooms
     set court_step = p_step, server_substate = null,
         phase_ends_at = case when p_seconds is null then null
                              else now() + make_interval(secs => p_seconds) end
   where id = p_room_id
  returning day into v_day;
  update court_days set step_at = now() where room_id = p_room_id and day = v_day;
  update players set ready = false where room_id = p_room_id and not is_bot;
  perform vv_court_bots(p_room_id, p_step);
end;
$$;
revoke all on function vv_court_enter(uuid, text, integer) from public, anon, authenticated;

-- Docket and trial halves: is the step over? Everyone Done → now; a majority
-- Done → a 10 s countdown (started once per step, so an exhibit's +10 s still
-- counts); otherwise the clock (+1.5 s grace for last-second writes).
create or replace function vv_court_due(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int; v_ready int; v_humans int;
  v_ends timestamptz; v_sub text; v_at timestamptz;
begin
  select o_total, o_ready, o_humans into v_total, v_ready, v_humans
    from vv_srv_electorate(p_room_id, 'active');
  select r.phase_ends_at, r.server_substate, d.step_at into v_ends, v_sub, v_at
    from rooms r left join court_days d on d.room_id = r.id and d.day = r.day
   where r.id = p_room_id;
  if v_humans = 0
     and now() < coalesce(v_at, now()) + make_interval(secs => vv_court_n('bots_grace')) then
    return false;
  end if;
  if v_total > 0 and v_ready = v_total then return true; end if;
  if v_total > 0 and v_ready * 2 > v_total and v_sub is distinct from 'countdown' then
    update rooms
       set server_substate = 'countdown',
           phase_ends_at = least(coalesce(phase_ends_at, 'infinity'::timestamptz),
                                 now() + make_interval(secs => vv_court_n('countdown')))
     where id = p_room_id;
    return false;
  end if;
  return v_ends is not null and now() >= v_ends + interval '1.5 seconds';
end;
$$;
revoke all on function vv_court_due(uuid) from public, anon, authenticated;

-- Settlement: everyone Continue → now; a majority → a 10 s countdown.
create or replace function vv_court_continue_due(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_total int; v_ready int; v_humans int; v_ends timestamptz; v_at timestamptz;
begin
  select o_total, o_ready, o_humans into v_total, v_ready, v_humans
    from vv_srv_electorate(p_room_id, 'active');
  select r.phase_ends_at, d.step_at into v_ends, v_at
    from rooms r left join court_days d on d.room_id = r.id and d.day = r.day
   where r.id = p_room_id;
  if v_humans = 0 then
    return now() >= coalesce(v_at, now()) + make_interval(secs => vv_court_n('bots_grace'));
  end if;
  if v_ready = v_total then return true; end if;
  if v_ready * 2 > v_total then
    if v_ends is null then
      update rooms set phase_ends_at = now() + make_interval(secs => vv_court_n('countdown'))
       where id = p_room_id;
      return false;
    end if;
    return now() >= v_ends;
  end if;
  return false;
end;
$$;
revoke all on function vv_court_continue_due(uuid) from public, anon, authenticated;

-- Give everything back: every stake on the tried charges and every exhibit or
-- counterproof still standing (a struck one was settled when it was ruled).
create or replace function vv_court_refund_all(p_room_id uuid, p_day integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare x record;
begin
  for x in
    select s.player_id, s.charge_id, sum(s.amount)::integer as amt
      from court_stakes s join court_charges c on c.id = s.charge_id
     where c.room_id = p_room_id and c.day = p_day and c.status = 'tried'
     group by s.player_id, s.charge_id
  loop
    perform vv_court_pay(p_room_id, p_day, x.player_id, x.amt, 'refund', x.charge_id);
  end loop;
  for x in
    select id, filer_id, cost from court_exhibits
     where room_id = p_room_id and day = p_day and status <> 'forged'
  loop
    perform vv_court_pay(p_room_id, p_day, x.filer_id, x.cost, 'refund', x.id);
  end loop;
end;
$$;
revoke all on function vv_court_refund_all(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The money after the verdict (ledger lines: payout, pot_share,
-- counterproof_won, refund) and the reputation counters.
create or replace function vv_court_settle(p_room_id uuid, p_day integer, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_def uuid; v_wit uuid; v_pot integer; v_half integer; x record;
begin
  if p_outcome in ('warded', 'adjourned') then
    perform vv_court_refund_all(p_room_id, p_day);
    return;
  end if;

  select defendant_id into v_def from court_days where room_id = p_room_id and day = p_day;
  select witness_id into v_wit from court_witness
   where room_id = p_room_id and day = p_day and status = 'accepted';

  -- Every prosecutor: their backing on the tried charges + their exhibit if it
  -- still stands.
  for x in
    with put as (
      select s.player_id, s.amount
        from court_stakes s join court_charges c on c.id = s.charge_id
       where c.room_id = p_room_id and c.day = p_day and c.status = 'tried'
      union all
      select e.filer_id, e.cost
        from court_exhibits e
       where e.room_id = p_room_id and e.day = p_day and e.side = 'P' and e.status <> 'forged'
    )
    select player_id, sum(amount)::integer as amt from put group by player_id
  loop
    if p_outcome = 'imprisoned' then
      perform vv_court_pay(p_room_id, p_day, x.player_id,
                           (x.amt * vv_court_n('payout_pct')) / 100, 'payout', null);
      perform vv_court_rep(p_room_id, x.player_id, 'backed_imprisoned');
    else
      perform vv_court_rep(p_room_id, x.player_id, 'backed_spared');
    end if;
  end loop;

  if p_outcome = 'spared' then
    select coalesce(sum(s.amount), 0)::integer into v_pot
      from court_stakes s join court_charges c on c.id = s.charge_id
     where c.room_id = p_room_id and c.day = p_day and c.status = 'tried';
    v_pot := v_pot + coalesce((
      select sum(cost)::integer from court_exhibits
       where room_id = p_room_id and day = p_day and side = 'P' and status <> 'forged'), 0);
    if v_wit is not null then
      v_half := v_pot / 2;
      perform vv_court_pay(p_room_id, p_day, v_wit, v_half, 'pot_share', null);
      perform vv_court_pay(p_room_id, p_day, v_def, v_pot - v_half, 'pot_share', null);
    else
      perform vv_court_pay(p_room_id, p_day, v_def, v_pot, 'pot_share', null);
    end if;
    for x in
      select id, filer_id, cost from court_exhibits
       where room_id = p_room_id and day = p_day and side = 'D' and status <> 'forged'
    loop
      perform vv_court_pay(p_room_id, p_day, x.filer_id,
                           (x.cost * vv_court_n('counterproof_pct')) / 100, 'counterproof_won', x.id);
    end loop;
    perform vv_court_rep(p_room_id, v_def, 'spared');
  end if;
end;
$$;
revoke all on function vv_court_settle(uuid, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Closing the docket: today's only defendant is the player with the most Soul
-- Energy backed against them in total (tie → more distinct backers → the
-- earliest press). Their charges are 'tried' (their backers are the
-- prosecutors); every other charge is refunded in full, now. No charges →
-- adjourned, straight to the new day.
create or replace function vv_court_close_docket(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_day integer; v_def uuid; x record;
begin
  select day into v_day from rooms where id = p_room_id;
  insert into court_days (room_id, day) values (p_room_id, v_day)
  on conflict (room_id, day) do nothing;

  -- (A player who died or went to prison since can't be tried.)
  select c.defendant_id into v_def
    from court_charges c
    join court_stakes s on s.charge_id = c.id
    join players d on d.id = c.defendant_id
   where c.room_id = p_room_id and c.day = v_day and c.status = 'open'
     and not d.dead and not d.in_prison
   group by c.defendant_id
   order by sum(s.amount) desc, count(distinct s.player_id) desc, min(c.created_at)
   limit 1;

  if v_def is not null then
    update court_charges set status = 'tried'
     where room_id = p_room_id and day = v_day and status = 'open' and defendant_id = v_def;
  end if;

  for x in
    select s.player_id, s.charge_id, sum(s.amount)::integer as amt
      from court_stakes s join court_charges c on c.id = s.charge_id
     where c.room_id = p_room_id and c.day = v_day and c.status = 'open'
     group by s.player_id, s.charge_id
  loop
    perform vv_court_pay(p_room_id, v_day, x.player_id, x.amt, 'refund', x.charge_id);
  end loop;
  update court_charges set status = 'refunded'
   where room_id = p_room_id and day = v_day and status = 'open';

  if v_def is null then
    update court_days set outcome = 'adjourned' where room_id = p_room_id and day = v_day;
    perform vv_court_finish(p_room_id);
    return;
  end if;

  update rooms set court_defendant_id = v_def where id = p_room_id;
  update court_days set defendant_id = v_def where room_id = p_room_id and day = v_day;
  perform vv_court_rep(p_room_id, v_def, 'trials');
  perform vv_court_enter(p_room_id, 'against', vv_court_n('half'));
end;
$$;
revoke all on function vv_court_close_docket(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Closing the verdict: count, imprison (or not), settle, show the settlement.
create or replace function vv_court_close_verdict(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day integer; v_def uuid; v_love text; v_love_vote text;
  v_g integer; v_ng integer; v_jurors integer; v_guilty boolean; v_outcome text;
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
     set guilty = v_g, not_guilty = v_ng, guilty_jurors = v_jurors, outcome = v_outcome
   where room_id = p_room_id and day = v_day;
  perform vv_court_settle(p_room_id, v_day, v_outcome);
  perform vv_court_enter(p_room_id, 'settlement', null);
end;
$$;
revoke all on function vv_court_close_verdict(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leaving the court (after settlement, or an adjourned docket): this
-- consultation's potions are spent, then the win check and the new day — the
-- tail of resolve_consultation.
create or replace function vv_court_finish(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_def uuid; v_outcome text; v_imprisoned text; v_winner text;
begin
  select d.defendant_id, d.outcome into v_def, v_outcome
    from rooms r join court_days d on d.room_id = r.id and d.day = r.day
   where r.id = p_room_id;
  v_imprisoned := case when v_outcome = 'imprisoned' then v_def::text end;

  update player_secrets
     set potion_vote_reveal = false, potion_iron_will = false, potion_soul_protect = false
   where player_id in (select id from players where room_id = p_room_id);
  update rooms set court_step = null, server_substate = null where id = p_room_id;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null,
      last_imprisoned_player = v_imprisoned
    where id = p_room_id;
    return;
  end if;

  update rooms set
    phase = 'new_day',
    phase_ends_at = now() + interval '4 seconds',
    last_imprisoned_player = v_imprisoned
  where id = p_room_id;
end;
$$;
revoke all on function vv_court_finish(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The step machine. One step per call; safe to call as often as you like.
-- p_force = the host's Skip: end the current step now.
create or replace function vv_court_step(p_room_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype; v_gone boolean; w record;
  v_voters integer; v_voted integer; v_humans integer; v_at timestamptz;
begin
  select * into r from rooms where id = p_room_id for update;
  if not found or r.phase is distinct from 'consultation' or r.court_step is null then
    return;
  end if;

  -- The defendant can't be tried any more (an instant Sacrifice): adjourned,
  -- everything refunded.
  if r.court_step in ('against', 'defence', 'verdict') then
    select dead or in_prison into v_gone from players where id = r.court_defendant_id;
    if coalesce(v_gone, true) then
      update court_days set outcome = 'adjourned' where room_id = p_room_id and day = r.day;
      perform vv_court_refund_all(p_room_id, r.day);
      perform vv_court_enter(p_room_id, 'settlement', null);
      return;
    end if;
  end if;

  if r.court_step = 'docket' then
    if p_force or vv_court_due(p_room_id) then
      perform vv_court_close_docket(p_room_id);
    end if;

  elsif r.court_step in ('against', 'defence') then
    -- A call nobody answered within 15 s counts as refused; one still waiting
    -- holds the half open.
    for w in
      update court_witness set status = 'refused', answered_at = now()
       where room_id = p_room_id and day = r.day and status = 'called'
         and now() > called_at + make_interval(secs => vv_court_n('witness_window'))
      returning witness_id
    loop
      perform vv_court_rep(p_room_id, w.witness_id, 'witness_refused');
    end loop;
    if not p_force
       and exists (select 1 from court_witness
                    where room_id = p_room_id and day = r.day and status = 'called') then
      return;
    end if;
    if p_force or vv_court_due(p_room_id) then
      if r.court_step = 'against' then
        perform vv_court_enter(p_room_id, 'defence', vv_court_n('half'));
      else
        perform clear_room_votes_impl(p_room_id);
        perform vv_court_enter(p_room_id, 'verdict', vv_court_n('verdict'));
      end if;
    end if;

  elsif r.court_step = 'verdict' then
    select count(*), count(*) filter (where has_voted), count(*) filter (where not is_bot)
      into v_voters, v_voted, v_humans
      from players
     where room_id = p_room_id and id <> r.court_defendant_id
       and not dead and not in_prison and not in_hospital;
    select step_at into v_at from court_days where room_id = p_room_id and day = r.day;
    if p_force
       or (r.phase_ends_at is not null and now() >= r.phase_ends_at + interval '1.5 seconds')
       or (v_voted >= v_voters
           and (v_humans > 0
                or now() >= coalesce(v_at, now()) + make_interval(secs => vv_court_n('bots_grace')))) then
      perform vv_court_close_verdict(p_room_id);
    end if;

  elsif r.court_step = 'settlement' then
    if p_force or vv_court_continue_due(p_room_id) then
      perform vv_court_finish(p_room_id);
    end if;
  end if;

  -- Left the court this call (a new day or a victory): the Wandering Soul's
  -- last-standing check, as after every resolution.
  if exists (select 1 from rooms where id = p_room_id and phase is distinct from 'consultation') then
    perform resolve_soul_last_standing(p_room_id);
  end if;
end;
$$;
revoke all on function vv_court_step(uuid, boolean) from public, anon, authenticated;

-- Private lobbies: the host's client pings this every few seconds during the
-- consultation. The server decides whether anything is due.
create or replace function court_tick(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;
  if pg_try_advisory_xact_lock(hashtextextended('vv_tick:' || p_room_id::text, 0)) then
    perform vv_court_step(p_room_id, false);
  end if;
end;
$$;
grant execute on function court_tick(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Voting in court: only during the verdict, never by the defendant, only for
-- the defendant (Guilty) or 'skip' (Not guilty); null clears (blank). Outside
-- the court, unchanged. (The gated submit_vote wrapper is untouched.)
create or replace function submit_vote_impl(p_player_id uuid, p_vote text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text; v_step text; v_def uuid;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select r.phase, r.court_step, r.court_defendant_id, p.dead, p.in_prison, p.in_hospital
    into v_phase, v_step, v_def, v_dead, v_prison, v_hosp
    from players p join rooms r on r.id = p.room_id
   where p.id = p_player_id;
  if v_phase = 'consultation' and v_step is not null then
    if v_step is distinct from 'verdict' or p_player_id = v_def
       or v_dead or v_prison or v_hosp
       or (p_vote is not null and p_vote <> 'skip' and p_vote is distinct from v_def::text) then
      raise exception 'vote_not_allowed' using errcode = '22023';
    end if;
  end if;
  update player_secrets set vote = p_vote where player_id = p_player_id;
  update players set has_voted = (p_vote is not null) where id = p_player_id;
end;
$$;
revoke all on function submit_vote_impl(uuid, text) from public, anon, authenticated;

-- Bots vote a known or suspected enemy; with nothing to go on, vote at random a
-- little over half the time and skip otherwise. In a re-vote only the tied
-- players (p_candidates) are eligible. In court only the verdict counts: Guilty
-- (the defendant) or Not guilty ('skip'), never on their own case — a known
-- ally is never voted Guilty.
create or replace function vv_bot_vote(p_bot uuid, p_candidates uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_t uuid; v_sus jsonb; v_step text; v_def uuid;
  v_cands uuid[] := p_candidates;
begin
  select p.dead, p.in_prison, p.in_hospital, coalesce(s.bot_memory->'sus', '{}'::jsonb),
         case when r.phase = 'consultation' then r.court_step end, r.court_defendant_id
    into v_dead, v_prison, v_hosp, v_sus, v_step, v_def
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_dead or v_prison or v_hosp then return; end if;
  if v_step is not null then
    if v_step is distinct from 'verdict' or v_def is null or v_def = p_bot then return; end if;
    v_cands := array[v_def];
  end if;

  -- Imprisoned / hospitalised players can still be voted on (p_active_only = false).
  v_t := vv_bot_enemy(p_bot, v_cands, false, true);      -- a known enemy
  if v_t is null then
    v_t := vv_bot_enemy(p_bot, v_cands, false, false);   -- suspicion, else anyone
    if v_t is not null
       and coalesce((v_sus->>v_t::text)::numeric, 0) <= 0
       and random() < 0.45 then
      v_t := null;                                        -- no real read: skip
    end if;
  end if;

  perform submit_vote_impl(p_bot, coalesce(v_t::text, 'skip'));
end;
$$;
revoke all on function vv_bot_vote(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The old consultation functions, made court-aware (bodies otherwise as live).

-- The vote outcome for the result screen and Truthfulness (075 + the court).
create or replace function consultation_tally(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_skip int := 0;
  v_max int := 0;
  v_topn int := 0;
  v_imprisoned text;
  v_tied jsonb;
  v_court court_days%rowtype;
begin
  -- A court day (migration 141): the verdict decides. Guilty votes are votes
  -- for the defendant, so Truthfulness and the voter reveals read them as
  -- before; a spared or warded defendant reads as "not imprisoned".
  select d.* into v_court
    from court_days d join rooms r on r.id = d.room_id and r.day = d.day
   where d.room_id = p_room_id;
  if found then
    return jsonb_build_object(
      'kind', case when v_court.outcome = 'imprisoned' then 'imprisoned'
                   when v_court.outcome in ('spared', 'warded') then 'skip_majority'
                   else 'no_votes' end,
      'imprisoned_id', case when v_court.outcome = 'imprisoned' then v_court.defendant_id end,
      'tied_ids', '[]'::jsonb,
      'court', true,
      'outcome', v_court.outcome);
  end if;

  -- Iron Will (migration 075): the buyer's imprisonment vote counts double, so
  -- votes are summed by weight (2 / 1), not plain counted — must match
  -- resolve_consultation.
  select coalesce(sum(case when s.potion_iron_will then 2 else 1 end), 0) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, sum(case when s.potion_iron_will then 2 else 1 end) as c
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.in_prison and not p.dead and not p.in_hospital
      and s.vote is not null and s.vote <> 'skip'
    group by s.vote
  ),
  mx as (select coalesce(max(c), 0) as m from tally)
  select
    (select m from mx),
    (select count(*) from tally, mx where tally.c = mx.m and mx.m > 0),
    (select target from tally, mx where tally.c = mx.m and mx.m > 0 limit 1),
    coalesce((select jsonb_agg(target) from tally, mx where tally.c = mx.m and mx.m > 0), '[]'::jsonb)
  into v_max, v_topn, v_imprisoned, v_tied;

  -- Love's tie-break (migration 067): a real tie Love voted into resolves to
  -- Love's pick instead of going to a re-vote (must match resolve_consultation).
  if v_topn > 1 and v_max > v_skip then
    declare
      v_love text; v_love_vote text;
    begin
      select love_tiebreak into v_love from rooms where id = p_room_id;
      if v_love is not null then
        select s.vote into v_love_vote from player_secrets s where s.player_id = v_love::uuid;
        if v_love_vote is not null and v_tied ? v_love_vote then
          return jsonb_build_object('kind','imprisoned','imprisoned_id',v_love_vote,'tied_ids','[]'::jsonb);
        end if;
      end if;
    end;
  end if;

  if v_max = 0 then
    return jsonb_build_object('kind','no_votes','imprisoned_id',null,'tied_ids','[]'::jsonb);
  elsif v_skip >= v_max then
    return jsonb_build_object('kind','skip_majority','imprisoned_id',null,'tied_ids','[]'::jsonb);
  elsif v_topn > 1 then
    return jsonb_build_object('kind','tie','imprisoned_id',null,'tied_ids',v_tied);
  else
    return jsonb_build_object('kind','imprisoned','imprisoned_id',v_imprisoned,'tied_ids','[]'::jsonb);
  end if;
end;
$$;

grant execute on function consultation_tally(uuid) to anon, authenticated;

-- Consultation resolution (094's body + the court guard).
create or replace function resolve_consultation_impl(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skip int := 0;
  v_imprisoned text;
  v_winner text;
begin
  -- The court (migration 141) runs its own steps and settles itself: a call
  -- here (the host's Skip) just ends the current step.
  if exists (select 1 from rooms where id = p_room_id and court_step is not null) then
    perform vv_court_step(p_room_id, true);
    return;
  end if;

  -- The vote-reveal potion only lasts this consultation; retire it now. (The
  -- iron-will potion is cleared AFTER the weighted tallies below — migration
  -- 075 — since they need to read it to double the buyer's vote.)
  update player_secrets set potion_vote_reveal = false
  where player_id in (select id from players where room_id = p_room_id);

  select coalesce(sum(case when s.potion_iron_will then 2 else 1 end), 0) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, sum(case when s.potion_iron_will then 2 else 1 end) as c
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.in_prison and not p.dead and not p.in_hospital
      and s.vote is not null and s.vote <> 'skip'
    group by s.vote
  ),
  mx as (select coalesce(max(c), 0) as m from tally)
  select case
    when (select m from mx) > 0
     and (select m from mx) > v_skip
     and (select count(*) from tally, mx where tally.c = mx.m) = 1
    then (select target from tally, mx where tally.c = mx.m limit 1)
    else null
  end
  into v_imprisoned;

  -- Love's tie-break (migration 067): no unique winner because of a TIE (max
  -- beats skip, multiple candidates) + Love armed the deciding vote + Love
  -- voted for one of the tied candidates → that candidate is imprisoned.
  if v_imprisoned is null then
    declare
      v_love text; v_love_vote text; v_max int := 0; v_tiecnt int := 0;
    begin
      select love_tiebreak into v_love from rooms where id = p_room_id;
      if v_love is not null then
        with tally as (
          select s.vote as target, sum(case when s.potion_iron_will then 2 else 1 end) as c
          from players p join player_secrets s on s.player_id = p.id
          where p.room_id = p_room_id
            and not p.in_prison and not p.dead and not p.in_hospital
            and s.vote is not null and s.vote <> 'skip'
          group by s.vote
        ), mx as (select coalesce(max(c), 0) as m from tally)
        select (select m from mx),
               (select count(*) from tally, mx where tally.c = mx.m and mx.m > 0)
        into v_max, v_tiecnt;
        select s.vote into v_love_vote from player_secrets s where s.player_id = v_love::uuid;
        if v_max > v_skip and v_tiecnt > 1 and v_love_vote is not null
           and exists (
             select 1 from players p join player_secrets s on s.player_id = p.id
             where p.room_id = p_room_id and not p.in_prison and not p.dead and not p.in_hospital
               and s.vote = v_love_vote
             group by s.vote having sum(case when s.potion_iron_will then 2 else 1 end) = v_max
           ) then
          v_imprisoned := v_love_vote;
        end if;
      end if;
    end;
  end if;

  -- Iron-will potion fired this consultation; retire it now (migration 075).
  update player_secrets set potion_iron_will = false
  where player_id in (select id from players where room_id = p_room_id);

  if v_imprisoned is not null then
    -- Wandering Soul ward (migration 094): a warded Soul cannot be jailed.
    if exists (select 1 from player_secrets
               where player_id = v_imprisoned::uuid and potion_soul_protect) then
      v_imprisoned := null;
    else
      update players set in_prison = true where id = v_imprisoned::uuid;
      -- If the imprisoned player is Vengeance, permanently remember her jailers.
      if exists (select 1 from player_secrets where player_id = v_imprisoned::uuid and role = 'vengeance') then
        update rooms set vengeance_imprisoners = (
          select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
          from (
            select jsonb_array_elements_text(vengeance_imprisoners) as e
              from rooms where id = p_room_id
            union
            select p.id::text
            from players p join player_secrets s on s.player_id = p.id
            where p.room_id = p_room_id
              and not p.in_prison and not p.dead and not p.in_hospital
              and s.vote = v_imprisoned
          ) u
        )
        where id = p_room_id;
      end if;
    end if;
  end if;

  -- The Soul's one-cycle ward is spent at the end of the consultation.
  update player_secrets set potion_soul_protect = false
  where player_id in (select id from players where room_id = p_room_id);

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null,
      last_imprisoned_player = v_imprisoned
    where id = p_room_id;
    return;
  end if;

  update rooms set
    phase = 'new_day',
    phase_ends_at = now() + interval '4 seconds',
    last_imprisoned_player = v_imprisoned
  where id = p_room_id;
end;
$$;
revoke all on function resolve_consultation_impl(uuid) from public, anon, authenticated;

-- The phase machine (135's body + the court branch). One step per call.
create or replace function vv_tick_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
  n rooms%rowtype;
  v_key text;
  v_voters int; v_voted int;
  v_tally jsonb;
begin
  -- The server is acting (see header): host-gated resolvers accept this
  -- transaction for the rest of its life.
  perform set_config('vv.server_tick', 'on', true);

  select * into r from rooms where id = p_room_id for update;
  if not found or not r.server_hosted or r.phase = 'game_over' then return; end if;

  -- First tick in a new phase / day / re-vote: entry work.
  v_key := r.phase || ':' || r.day || ':' || coalesce(md5(r.revote_candidates::text), '-');
  if r.server_phase_key is distinct from v_key then
    if r.phase in ('vice_victory_intro', 'virtue_victory_intro', 'soul_victory_intro') then
      -- Reached from a resolver, which doesn't reset ready: start the
      -- Continue majority clean (bots stay ready).
      update players set ready = false where room_id = p_room_id and not is_bot;
    end if;
    update rooms set server_phase_key = v_key, server_substate = null where id = p_room_id;
    r.server_phase_key := v_key;
    r.server_substate := null;
  end if;

  -- Bots move once per phase / day / re-vote (idempotent inside).
  perform run_bots(p_room_id);
  select * into r from rooms where id = p_room_id;

  if r.phase = 'role_select' then
    -- Bots pick, then lock, each on its own random schedule (migration 127).
    perform vv_bot_role_select_step(p_room_id);
    -- Ends once every HUMAN has locked (nobody waits on a bot: one still
    -- deciding is handed its planned role), or at the deadline.
    if not exists (select 1 from players p join player_secrets s on s.player_id = p.id
                   where p.room_id = p_room_id and s.role is null and not p.is_bot)
       or (r.phase_ends_at is not null and now() >= r.phase_ends_at + interval '1.5 seconds') then
      update player_secrets s set role_choice = s.bot_memory->>'plan'
        from players p
       where p.id = s.player_id and p.room_id = p_room_id and p.is_bot
         and s.role is null and s.bot_memory ? 'plan';
      perform resolve_role_select(p_room_id);
    end if;

  elsif r.phase = 'role_overview' then
    if vv_srv_continue(p_room_id) then
      update players set ready = false where room_id = p_room_id;
      update rooms set phase = 'lore_intro', phase_ends_at = null where id = p_room_id;
    end if;

  elsif r.phase = 'lore_intro' then
    -- Reading the card: majority ready, or 15s. Then the 3.5s flight
    -- (clients play it when phase_ends_at appears), then on.
    if r.phase_ends_at is null then
      if (select t.o_total > 0 and t.o_ready * 2 > t.o_total
            from vv_srv_electorate(p_room_id, 'active') t)
         or now() >= coalesce(r.phase_started_at, now()) + interval '15 seconds' then
        update rooms set phase_ends_at = now() + interval '3.5 seconds' where id = p_room_id;
      end if;
    elsif now() >= r.phase_ends_at + interval '0.5 seconds' then
      if r.role_assign_mode = 'choose' then
        perform vv_srv_start_role_action(p_room_id);
      else
        update players set ready = false where room_id = p_room_id;
        update rooms set phase = 'role_reveal', phase_ends_at = null where id = p_room_id;
      end if;
    end if;

  elsif r.phase = 'role_reveal' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_role_action(p_room_id); end if;

  elsif r.phase = 'role_action' then
    if vv_srv_timed(p_room_id) then perform vv_srv_resolve_role_action(p_room_id); end if;

  elsif r.phase = 'event_summary' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_minigame(p_room_id); end if;

  elsif r.phase = 'minigame' then
    if vv_srv_timed(p_room_id) then
      perform apply_quiz_awards(p_room_id);
      update players set ready = false where room_id = p_room_id;
      update rooms set phase = 'result', phase_ends_at = null where id = p_room_id;
    end if;

  elsif r.phase = 'result' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_outreach(p_room_id); end if;

  elsif r.phase = 'outreach' then
    -- Bots read their messages and answer their partner (migration 129).
    perform vv_bot_outreach_step(p_room_id);
    if vv_srv_timed(p_room_id, 'living') then
      perform enter_store(p_room_id, now() + interval '60 seconds');
    end if;

  elsif r.phase = 'store' then
    if vv_srv_timed(p_room_id) then
      perform resolve_store(p_room_id);
      perform resolve_soul_last_standing(p_room_id);
    end if;

  elsif r.phase = 'store_summary' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_consultation(p_room_id); end if;

  elsif r.phase = 'consultation' and r.court_step is not null then
    -- The court (migration 141): docket → trial → verdict → settlement.
    perform vv_court_step(p_room_id, false);

  elsif r.phase = 'consultation' then
    if r.server_substate is distinct from 'voted' then
      select count(*), count(*) filter (where has_voted) into v_voters, v_voted
        from players
       where room_id = p_room_id and not dead and not in_prison and not in_hospital;
      if v_voted < v_voters then
        -- Time's up: whoever hasn't voted skips (incl. anyone disconnected).
        if r.phase_ends_at is not null
           and now() >= r.phase_ends_at + interval '1.5 seconds' then
          perform submit_vote_impl(p.id, 'skip')
             from players p
            where p.room_id = p_room_id and not p.dead and not p.in_prison
              and not p.in_hospital and not p.has_voted;
        end if;
        return;
      end if;
      -- Everyone has voted. A first-round tie goes straight to the re-vote
      -- (the host's old decision); anything else opens the result screen.
      v_tally := consultation_tally(p_room_id);
      if v_tally->>'kind' = 'tie' and r.revote_candidates is null then
        perform start_revote(p_room_id, coalesce(v_tally->'tied_ids', '[]'::jsonb));
        return;
      end if;
      -- No ready reset here (migration 135). Clients see "everyone voted"
      -- and offer Continue BEFORE this tick notices, so resetting wiped the
      -- presses made in between and the room sat on the result screen with
      -- nobody ready. Nothing sets ready during the vote (consultation
      -- starts with it cleared), so there's nothing stale to clear.
      update rooms set server_substate = 'voted', phase_ends_at = null where id = p_room_id;
      return;
    end if;
    if vv_srv_continue(p_room_id) then
      perform resolve_consultation(p_room_id);
      perform resolve_soul_last_standing(p_room_id);
    end if;

  elsif r.phase = 'new_day' then
    if r.phase_ends_at is null or now() >= r.phase_ends_at then
      perform vv_srv_start_next_day(p_room_id);
    end if;

  elsif r.phase = 'vice_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'vice'); end if;

  elsif r.phase = 'virtue_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'virtue'); end if;

  elsif r.phase = 'soul_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'neutral'); end if;
  end if;

  -- A resolver above just ended the game (migration 135)? Do the victory
  -- screen's entry work now, in the same transaction: clients show its
  -- Continue the moment the phase changes, and a reset on the NEXT tick
  -- wiped presses made in between.
  select * into n from rooms where id = p_room_id;
  if n.phase in ('vice_victory_intro', 'virtue_victory_intro', 'soul_victory_intro')
     and n.phase is distinct from r.phase then
    update players set ready = false where room_id = p_room_id and not is_bot;
    update rooms
       set server_phase_key = n.phase || ':' || n.day || ':'
                              || coalesce(md5(n.revote_candidates::text), '-'),
           server_substate = null
     where id = p_room_id;
  end if;
end;
$$;
revoke all on function vv_tick_room(uuid) from public, anon, authenticated;

commit;
