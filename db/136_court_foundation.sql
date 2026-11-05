-- 136: The Trial, batch 1 — the Quiz log, the court tables, and what clients
-- may read (docs/trial-build-spec.md).
--
-- * quiz_log: player_secrets.quiz is overwritten every day, so a trigger on
--   that column keeps each day's choice (and its private result). The court
--   record shows the KIND only; the composer shows a player their own results.
-- * Court tables. All are locked (RLS on, no policies): clients read them only
--   through court_state(), which applies the visibility rules — an exhibit's
--   genuineness goes to its filer and the dead only, the record carries Quiz
--   kinds and who-messaged-whom but never targets, results or text. Writes come
--   in batch 2 (the action RPCs) and batch 3 (the step machine).
-- * Every court table carries room_id, so the room-changed broadcast (121)
--   nudges clients on every change.
--
-- Nothing calls these yet; the consultation still plays as before. Safe to
-- re-run.

begin;

-- ---------------------------------------------------------------------------
-- Quiz log
create table if not exists quiz_log (
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  player_id uuid not null references players(id) on delete cascade,
  kind text not null,                 -- points | hint | peek
  target_id uuid,                     -- the peeked player
  result jsonb,                       -- {hint: {kind, camp?, a, b}} or {peek: {target, camp}}
  created_at timestamptz not null default now(),
  primary key (room_id, day, player_id)
);
alter table quiz_log enable row level security;

-- The first choice of a day is the one (a choice can't be changed; the award
-- step rewrites the same day's entry, which is ignored here).
create or replace function vv_quiz_log_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_day integer; v_kind text;
begin
  if new.quiz is null then return new; end if;
  if tg_op = 'UPDATE' and new.quiz is not distinct from old.quiz then return new; end if;
  v_kind := new.quiz->>'choice';
  begin
    v_day := (new.quiz->>'day')::integer;
  exception when others then
    v_day := null;
  end;
  if v_kind is null or v_day is null then return new; end if;
  select room_id into v_room from players where id = new.player_id;
  if v_room is null then return new; end if;
  insert into quiz_log (room_id, day, player_id, kind, target_id, result)
  values (v_room, v_day, new.player_id, v_kind,
          case when jsonb_typeof(new.quiz->'peek') = 'object'
               then (new.quiz->'peek'->>'target')::uuid end,
          jsonb_strip_nulls(jsonb_build_object('hint', new.quiz->'hint', 'peek', new.quiz->'peek')))
  on conflict (room_id, day, player_id) do nothing;
  return new;
exception when others then
  return new;                         -- never break a Quiz write over the log
end;
$$;
revoke all on function vv_quiz_log_write() from public, anon, authenticated;

drop trigger if exists vv_quiz_log_trg on player_secrets;
create trigger vv_quiz_log_trg
  after insert or update of quiz on player_secrets
  for each row execute function vv_quiz_log_write();

-- Games already running keep today's choice.
insert into quiz_log (room_id, day, player_id, kind, target_id, result)
select p.room_id, (s.quiz->>'day')::integer, s.player_id, s.quiz->>'choice',
       case when jsonb_typeof(s.quiz->'peek') = 'object'
            then (s.quiz->'peek'->>'target')::uuid end,
       jsonb_strip_nulls(jsonb_build_object('hint', s.quiz->'hint', 'peek', s.quiz->'peek'))
  from player_secrets s join players p on p.id = s.player_id
 where s.quiz ? 'choice' and (s.quiz->>'day') ~ '^\d+$'
on conflict (room_id, day, player_id) do nothing;

-- ---------------------------------------------------------------------------
-- Court tables
alter table rooms add column if not exists court_step text;        -- docket | against | defence | verdict | settlement (null outside the consultation)
alter table rooms add column if not exists court_defendant_id uuid; -- today's only defendant, from the docket's close

-- One row per room per day in court: the trial itself.
create table if not exists court_days (
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  defendant_id uuid references players(id) on delete set null,
  outcome text check (outcome in ('adjourned', 'imprisoned', 'spared', 'warded')),
  guilty integer,                     -- weighted (Iron Will ×2), public once the vote closes
  not_guilty integer,
  guilty_jurors integer,              -- distinct jurors who voted Guilty (the floor is 2)
  extend_s integer not null default 0,-- seconds exhibits/counterproof have added (cap 30)
  created_at timestamptz not null default now(),
  primary key (room_id, day)
);

create table if not exists court_charges (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  defendant_id uuid not null references players(id) on delete cascade,
  kind text not null check (kind in ('vice', 'murder', 'false_witness')),
  victim_id uuid references players(id) on delete cascade,
  pressed_by uuid not null references players(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'tried', 'refunded')),
  created_at timestamptz not null default clock_timestamp()
);
-- "An identical charge" = same defendant, kind and victim on the same day.
create unique index if not exists court_charges_identical on court_charges
  (room_id, day, defendant_id, kind,
   coalesce(victim_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Every press stake and every +25 is its own row (the live feed).
create table if not exists court_stakes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  charge_id uuid not null references court_charges(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  amount integer not null check (amount > 0),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists court_stakes_charge on court_stakes (charge_id);

create table if not exists court_exhibits (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  number integer not null,            -- P1, P2… / D1
  side text not null check (side in ('P', 'D')),
  filer_id uuid not null references players(id) on delete cascade,
  kind text not null check (kind in ('quiz_peek', 'quiz_hint', 'msg_received', 'msg_sent')),
  payload jsonb not null,
  cost integer not null,
  status text not null default 'standing' check (status in ('standing', 'upheld', 'forged')),
  created_at timestamptz not null default clock_timestamp(),
  unique (room_id, day, side, number)
);

-- Whether an exhibit matches the filer's real data — computed at filing and
-- never shown except to its filer and the dead (or as an objection's ruling).
create table if not exists court_exhibit_truth (
  exhibit_id uuid primary key references court_exhibits(id) on delete cascade,
  genuine boolean not null
);

create table if not exists court_witness (
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  witness_id uuid not null references players(id) on delete cascade,
  status text not null default 'called' check (status in ('called', 'accepted', 'refused')),
  called_at timestamptz not null default clock_timestamp(),
  answered_at timestamptz,
  primary key (room_id, day)
);

create table if not exists court_objections (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  exhibit_id uuid not null unique references court_exhibits(id) on delete cascade,
  objector_id uuid not null references players(id) on delete cascade,
  ruling text not null check (ruling in ('forged', 'upheld')),
  created_at timestamptz not null default clock_timestamp()
);

-- Built across the game, shown next to every name.
create table if not exists court_reputation (
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  counters jsonb not null default '{}'::jsonb,
  primary key (room_id, player_id)
);

-- Every Soul Energy movement the court makes, + in / − out — the public
-- payout lines (each one follows from public stakes, exhibits and outcomes).
create table if not exists court_ledger (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  day integer not null,
  player_id uuid not null references players(id) on delete cascade,
  amount integer not null,
  reason text not null,
  ref_id uuid,                        -- the charge or exhibit it concerns
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists court_ledger_room_day on court_ledger (room_id, day);

alter table court_days enable row level security;
alter table court_charges enable row level security;
alter table court_stakes enable row level security;
alter table court_exhibits enable row level security;
alter table court_exhibit_truth enable row level security;
alter table court_witness enable row level security;
alter table court_objections enable row level security;
alter table court_reputation enable row level security;
alter table court_ledger enable row level security;

-- Room-changed nudges (the players-table statement trigger from 121 works for
-- any table with room_id).
do $$
declare t text;
begin
  foreach t in array array['court_days', 'court_charges', 'court_stakes', 'court_exhibits',
                           'court_witness', 'court_objections', 'court_ledger'] loop
    execute format('drop trigger if exists vv_%s_nudge_ins on %I', t, t);
    execute format('drop trigger if exists vv_%s_nudge_upd on %I', t, t);
    execute format('drop trigger if exists vv_%s_nudge_del on %I', t, t);
    execute format('create trigger vv_%s_nudge_ins after insert on %I referencing new table as changed_rows '
                   'for each statement execute function vv_players_changed_stmt()', t, t);
    execute format('create trigger vv_%s_nudge_upd after update on %I referencing new table as changed_rows '
                   'for each statement execute function vv_players_changed_stmt()', t, t);
    execute format('create trigger vv_%s_nudge_del after delete on %I referencing old table as changed_rows '
                   'for each statement execute function vv_players_changed_stmt()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Who died to a kill today — ids only (the kill log is secret: no killers).
create or replace function vv_court_victims(p_room_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct (e->>'victim')::uuid), '{}')
    from rooms r, jsonb_array_elements(coalesce(r.kill_log, '[]'::jsonb)) e
   where r.id = p_room_id
     and (e->>'day') ~ '^\d+$' and (e->>'day')::integer = r.day
     and (e->>'victim') is not null;
$$;
revoke all on function vv_court_victims(uuid) from public, anon, authenticated;

-- Everything a player in the room may see of the court, in one snapshot.
--   trial       today's court_days row (outcome + vote counts once closed)
--   charges     today's, each with its stakes in order
--   exhibits    today's; `genuine` only for its filer and the dead
--   witness, objections, ledger (today), reputation (all game)
--   victims     today's kill victims (for Murder charges)
--   record      every day's Quiz kind per player and who messaged whom —
--               today's only once the court is in session
--   history     past days' trials
create or replace function court_state(p_room_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r rooms%rowtype; v_dead boolean; v_open boolean;
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

  return jsonb_build_object(
    'day', r.day,
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
               'genuine', case when v_dead or e.filer_id = p_viewer_id then t.genuine end)
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

-- The exhibit composer's pre-fill: the caller's OWN Quiz results and messages,
-- every day.
create or replace function court_my_material(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_room uuid;
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select room_id into v_room from players where id = p_player_id;
  return jsonb_build_object(
    'quiz', coalesce((
      select jsonb_agg(jsonb_build_object('day', q.day, 'kind', q.kind,
                                          'target_id', q.target_id, 'result', q.result)
                       order by q.day)
        from quiz_log q where q.room_id = v_room and q.player_id = p_player_id), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'day', m.day, 'to', m.recipient_id,
                                          'payload', m.payload, 'text', m.text, 'at', m.created_at)
                       order by m.created_at)
        from dm_messages m
       where m.room_id = v_room and m.sender_id = p_player_id and m.day is not null), '[]'::jsonb),
    'received', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'day', m.day, 'from', m.sender_id,
                                          'payload', m.payload, 'text', m.text, 'at', m.created_at)
                       order by m.created_at)
        from dm_messages m
       where m.room_id = v_room and m.recipient_id = p_player_id and m.day is not null), '[]'::jsonb)
  );
end;
$$;
grant execute on function court_my_material(uuid) to anon, authenticated;

commit;
