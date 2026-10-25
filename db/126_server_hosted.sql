-- Migration 126 — Server-hosted queue games (quick play + ranked), batch 1
--
-- Design (Matthijs, 2026-10-25): games from the matchmaking queue — quick play
-- AND ranked — have NO host; the server runs them. Only private code lobbies
-- keep a player host. Until now the host's browser ran the whole phase machine
-- (timers, majority countdowns, every transition and resolution), so a host who
-- closed the app froze the game for everyone, and a cheating host could steer it.
--
-- HOW
--   * rooms.server_hosted. form_match (queue) creates such rooms with is_host
--     false for every seat.
--   * vv_tick_room(room) is the phase machine, in Postgres. It runs the same
--     transitions the host's client used to (ported from src/lib/game.ts and the
--     phase components): timed phases (shorten to 10s on a human majority, end
--     on all-ready or the deadline + 1.5s grace), majority-continue screens (10s
--     countdown), the lore intro (majority or 15s, then the 3.5s entry), the vote
--     (auto-skip non-voters at the deadline; a first-round tie auto-starts the
--     re-vote), the new-day splash, and game end (results, rewards, ranked).
--     It also runs the bots (run_bots).
--   * It is driven by pg_cron every 2 seconds (vv_tick_all_rooms) AND by every
--     connected player's client (tick_room, every few seconds) as a backstop.
--     A per-room advisory lock means concurrent ticks never double-step.
--   * THE SERVER FLAG. Rather than re-implementing every host-gated resolver
--     (resolve_*, apply_quiz_awards, record_game_results, enter_store,
--     start_revote, run_bots …), the tick sets a TRANSACTION-LOCAL setting
--     (vv.server_tick = on) and vv_is_host() accepts it. Every existing,
--     reviewed resolver then runs unchanged for a hostless room. A client cannot
--     set it: PostgREST only lets requests set request.* settings, and it is
--     local to the tick's own transaction.
--   * Presence: tick_room records the caller in room_presence (a separate,
--     un-broadcast table — writing players would nudge every client on every
--     ping). A server room with no human seen for 2 minutes is ABANDONED: it is
--     deleted (no results, no rewards), as decided.
--   * Pacing counts humans only (bots act instantly), falling back to the bots
--     when no human is active — the same rule as the clients' lib/bots.ts. A
--     bots-only phase still lasts at least 5s so dead spectators can follow it.
--
-- Depends on 124/125 (bots, run_bots), 120 (phase guards), 122 (apply_quiz_awards).
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Schema
alter table rooms add column if not exists server_hosted boolean not null default false;
alter table rooms add column if not exists phase_started_at timestamptz default now();
alter table rooms add column if not exists server_phase_key text;
alter table rooms add column if not exists server_substate text;

create table if not exists room_presence (
  player_id uuid primary key references players(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists room_presence_room_idx on room_presence (room_id);
alter table room_presence enable row level security;   -- no policies: server-only

-- When the phase (or day) changes, stamp the start time (the lore intro's 15s
-- fallback and the bots-only minimum phase length read it).
create or replace function vv_stamp_phase_start()
returns trigger
language plpgsql
as $$
begin
  if new.phase is distinct from old.phase or new.day is distinct from old.day then
    new.phase_started_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists vv_stamp_phase_start_trg on rooms;
create trigger vv_stamp_phase_start_trg
  before update on rooms
  for each row execute function vv_stamp_phase_start();

-- ---------------------------------------------------------------------------
-- The server flag in the host check (see header). Body is migration 106's.
create or replace function vv_is_host(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('vv.server_tick', true), '') = 'on'
      or exists (
        select 1 from players
        where room_id = p_room_id and is_host and auth.uid() is not null
          and (auth_uid = auth.uid() or user_id = auth.uid())
      );
$$;

-- ---------------------------------------------------------------------------
-- form_match: migration 124's, but the room is server-hosted and nobody is host.
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
  v_is_bot boolean;
  v_role text;
  r record;
begin
  if (select count(*) from ranked_queue
      where mode = p_kind and status = 'waiting') < 2 * c_seats then
    if p_kind = 'public' and exists (
         select 1 from ranked_queue
         where mode = 'public' and status = 'waiting'
           and joined_at <= now() - c_patience) then
      v_bot_mode := true;
    else
      return null;
    end if;
  end if;

  -- Pass 1: give people the class they asked for.
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

  -- Pass 2: fill the remaining seats (bot mode: every waiting human, then bots).
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
      return null;
    end if;
    v_taken := array_append(v_taken, v_pick);
    v_assign := v_assign || jsonb_build_object(
      'user', v_pick, 'camp', v_camp, 'class', v_class);
  end loop;

  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, phase_ends_at,
                         role_assign_mode, eye_uses_left, free_uses_left, server_hosted)
      values (v_code, false, p_kind = 'ranked', 'in_game', 'role_select',
              now() + interval '30 seconds', 'choose', 1, 1, true)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

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

      -- user_id = ACCOUNT identity (only with a profile); auth_uid = SESSION
      -- identity (what vv_is_me matches) — see migration 106. No host: the
      -- server runs this room.
      insert into players (room_id, user_id, auth_uid, name, is_host)
      values (v_room_id,
              case when exists (select 1 from profiles pr
                                where pr.id = (r.elem ->> 'user')::uuid)
                   then (r.elem ->> 'user')::uuid end,
              (r.elem ->> 'user')::uuid,
              coalesce(v_name, 'Player'), false)
      returning id into v_player_id;

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
-- Pacing helpers. "Electorate" = the players whose readiness gates a phase:
--   'active'  alive, not jailed, not hospitalised   (most phases)
--   'living'  alive                                  (outreach: jailed + hospital chat)
--   'victory' active → else living → else everyone   (victory screens)
-- then humans only, falling back to the bots when no human qualifies.
-- (Output columns are o_-prefixed: in PL/pgSQL they become variables, and a
-- bare `ready` would clash with players.ready inside the query.)
create or replace function vv_srv_electorate(p_room_id uuid, p_mode text)
returns table (o_total int, o_ready int, o_humans int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_tier text := p_mode;
begin
  if p_mode = 'victory' then
    if exists (select 1 from players where room_id = p_room_id
               and not dead and not in_prison and not in_hospital) then
      v_tier := 'active';
    elsif exists (select 1 from players where room_id = p_room_id and not dead) then
      v_tier := 'living';
    else
      v_tier := 'all';
    end if;
  end if;

  return query
  with pool as (
    select pl.is_bot as bot, pl.ready as rdy from players pl
    where pl.room_id = p_room_id
      and (v_tier = 'all'
           or (v_tier = 'living' and not pl.dead)
           or (v_tier = 'active' and not pl.dead and not pl.in_prison and not pl.in_hospital))
  ), hum as (select * from pool where not bot)
  select
    case when (select count(*) from hum) > 0
         then (select count(*) from hum) else (select count(*) from pool) end::int,
    case when (select count(*) from hum) > 0
         then (select count(*) from hum where rdy)
         else (select count(*) from pool where rdy) end::int,
    (select count(*) from hum)::int;
end;
$$;
revoke all on function vv_srv_electorate(uuid, text) from public, anon, authenticated;

-- Majority-continue screens: everyone ready → go now; a majority → start (or
-- run out) a 10s countdown on phase_ends_at. Entered with phase_ends_at null.
create or replace function vv_srv_continue(p_room_id uuid, p_mode text default 'active')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_total int; v_ready int; v_humans int; v_ends timestamptz; v_started timestamptz;
begin
  select o_total, o_ready, o_humans into v_total, v_ready, v_humans
    from vv_srv_electorate(p_room_id, p_mode);
  select phase_ends_at, phase_started_at into v_ends, v_started
    from rooms where id = p_room_id;
  if v_total = 0 then return false; end if;
  -- Bots only: still give spectators a moment.
  if v_humans = 0 and now() < coalesce(v_started, now()) + interval '5 seconds' then
    return false;
  end if;
  if v_ready = v_total then return true; end if;
  if v_ready * 2 > v_total then
    if v_ends is null then
      update rooms set phase_ends_at = now() + interval '10 seconds' where id = p_room_id;
      return false;
    end if;
    return now() >= v_ends;
  end if;
  return false;
end;
$$;
revoke all on function vv_srv_continue(uuid, text) from public, anon, authenticated;

-- Timed phases: everyone ready → go now; a majority shortens the clock to 10s;
-- otherwise the deadline (+1.5s grace for last-second writes) ends it.
create or replace function vv_srv_timed(p_room_id uuid, p_mode text default 'active')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_total int; v_ready int; v_humans int; v_ends timestamptz; v_started timestamptz;
begin
  select o_total, o_ready, o_humans into v_total, v_ready, v_humans
    from vv_srv_electorate(p_room_id, p_mode);
  select phase_ends_at, phase_started_at into v_ends, v_started
    from rooms where id = p_room_id;
  if v_humans = 0 and now() < coalesce(v_started, now()) + interval '5 seconds' then
    return false;
  end if;
  if v_total > 0 and v_ready = v_total then return true; end if;
  if v_total > 0 and v_ready * 2 > v_total
     and (v_ends is null or v_ends > now() + interval '10.5 seconds') then
    update rooms set phase_ends_at = now() + interval '10 seconds' where id = p_room_id;
    return false;
  end if;
  return v_ends is not null and now() >= v_ends + interval '1.5 seconds';
end;
$$;
revoke all on function vv_srv_timed(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Transitions (ports of src/lib/game.ts; the resolvers are called as-is and
-- pass vv_is_host thanks to the server flag).
create or replace function vv_srv_start_role_action(p_room_id uuid)
returns void language sql security definer set search_path = public as $$
  update players set ready = false, acted_this_day = false, in_hospital = false
   where room_id = p_room_id;
  update rooms set phase = 'role_action', phase_ends_at = now() + interval '30 seconds'
   where id = p_room_id;
$$;

create or replace function vv_srv_start_minigame(p_room_id uuid)
returns void language sql security definer set search_path = public as $$
  update players set ready = false, minigame_score = 0, minigame_submitted_at = null
   where room_id = p_room_id;
  update rooms set phase = 'minigame', phase_ends_at = now() + interval '45 seconds',
                   minigame_clue = null
   where id = p_room_id;
$$;

create or replace function vv_srv_start_outreach(p_room_id uuid)
returns void language sql security definer set search_path = public as $$
  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'outreach', phase_ends_at = now() + interval '120 seconds'
   where id = p_room_id;
$$;

create or replace function vv_srv_start_consultation(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform clear_room_votes(p_room_id);
  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'consultation', vote_reveal = false,
                   phase_ends_at = now() + interval '95 seconds'
   where id = p_room_id;
end;
$$;

create or replace function vv_srv_start_next_day(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update players set ready = false, minigame_score = 0, acted_this_day = false,
                     in_hospital = false
   where room_id = p_room_id;
  update rooms set
    phase = 'role_action',
    phase_ends_at = now() + interval '30 seconds',
    day = day + 1,
    envy_swap_a = null, envy_swap_b = null, torment_target = null,
    pride_target = null, love_tiebreak = null, revote_candidates = null,
    recent_successor_id = null, last_events = null,
    group_action_result = null, group_action_freed_id = null, eye_revealed = false
   where id = p_room_id;
  perform resolve_gm_endurance(p_room_id);
end;
$$;

create or replace function vv_srv_resolve_role_action(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Same order as the client's resolveRoleAction.
  begin
    perform notify_correct_guesses(p_room_id);
  exception when undefined_function then null;
  end;
  perform resolve_role_action(p_room_id);
  perform resolve_greed(p_room_id);
  perform resolve_soul_escape(p_room_id);
  perform resolve_soul_last_standing(p_room_id);
end;
$$;

-- Game over: record results, rewards and ranked points, then the scoreboard.
-- Each step is isolated so a stats hiccup can never block game_over (same as the
-- client's best-effort recordGameResults).
create or replace function vv_srv_finish(p_room_id uuid, p_winner text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ranked boolean; v_vices int; v_virtues int; v_results jsonb;
begin
  update rooms set status = 'ended' where id = p_room_id and status <> 'ended';

  begin
    perform record_game_results(p_room_id, p_winner);
  exception when others then
    raise warning 'vv_srv_finish: record_game_results failed for %: %', p_room_id, sqlerrm;
  end;

  begin
    perform grant_match_rewards(p_room_id, '[]'::jsonb);
  exception when others then
    raise warning 'vv_srv_finish: grant_match_rewards failed for %: %', p_room_id, sqlerrm;
  end;

  select is_ranked into v_ranked from rooms where id = p_room_id;
  if coalesce(v_ranked, false) then
    begin
      -- diff = |Vices − Virtues still standing| (the win margin), as the client did.
      select count(*) filter (where vv_role_camp(s.role) = 'vice'),
             count(*) filter (where vv_role_camp(s.role) = 'virtue')
        into v_vices, v_virtues
        from players p join player_secrets s on s.player_id = p.id
       where p.room_id = p_room_id and not p.dead and not p.in_prison;
      select coalesce(jsonb_agg(jsonb_build_object(
               'u', g.user_id, 'won', g.won, 'diff', abs(v_vices - v_virtues))), '[]'::jsonb)
        into v_results
        from (select user_id, bool_or(won) as won from game_results
              where room_id = p_room_id group by user_id) g;
      perform apply_ranked_results(p_room_id, v_results);
    exception when others then
      raise warning 'vv_srv_finish: apply_ranked_results failed for %: %', p_room_id, sqlerrm;
    end;
  end if;

  update rooms set phase = 'game_over', phase_ends_at = null where id = p_room_id;
end;
$$;

revoke all on function vv_srv_start_role_action(uuid) from public, anon, authenticated;
revoke all on function vv_srv_start_minigame(uuid) from public, anon, authenticated;
revoke all on function vv_srv_start_outreach(uuid) from public, anon, authenticated;
revoke all on function vv_srv_start_consultation(uuid) from public, anon, authenticated;
revoke all on function vv_srv_start_next_day(uuid) from public, anon, authenticated;
revoke all on function vv_srv_resolve_role_action(uuid) from public, anon, authenticated;
revoke all on function vv_srv_finish(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The phase machine. One step per call; safe to call as often as you like.
create or replace function vv_tick_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
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
    if not exists (select 1 from players p join player_secrets s on s.player_id = p.id
                   where p.room_id = p_room_id and s.role is null)
       or (r.phase_ends_at is not null and now() >= r.phase_ends_at + interval '1.5 seconds') then
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
      update players set ready = false where room_id = p_room_id;
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
end;
$$;
revoke all on function vv_tick_room(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client entry point: "I'm still here" + a nudge. Any seated player may call it;
-- the server decides whether anything is due, so calling it can't cheat.
create or replace function tick_room(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from rooms where id = p_room_id and server_hosted)
     or not exists (select 1 from players where id = p_player_id and room_id = p_room_id) then
    return;
  end if;

  insert into room_presence (player_id, room_id, last_seen_at)
  values (p_player_id, p_room_id, now())
  on conflict (player_id) do update set last_seen_at = now();

  -- Skip (don't wait) if another tick is already stepping this room.
  if pg_try_advisory_xact_lock(hashtextextended('vv_tick:' || p_room_id::text, 0)) then
    perform vv_tick_room(p_room_id);
  end if;
end;
$$;
grant execute on function tick_room(uuid, uuid) to anon, authenticated;

-- Cron entry point: step every live server room, and close abandoned ones.
create or replace function vv_tick_all_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare rr record;
begin
  for rr in
    select id, created_at from rooms
    where server_hosted and phase <> 'game_over'
  loop
    -- Abandoned: no human has pinged for 2 minutes (a room younger than that
    -- counts its creation as the last sign of life). Deleting cascades the
    -- players, secrets, chat and presence; nothing is recorded.
    if not exists (
         select 1 from players p
         left join room_presence pr on pr.player_id = p.id
         where p.room_id = rr.id and not p.is_bot
           and coalesce(pr.last_seen_at, rr.created_at) > now() - interval '2 minutes') then
      delete from rooms where id = rr.id;
      continue;
    end if;

    if pg_try_advisory_xact_lock(hashtextextended('vv_tick:' || rr.id::text, 0)) then
      begin
        perform vv_tick_room(rr.id);
      exception when others then
        raise warning 'vv_tick_all_rooms: room % failed: %', rr.id, sqlerrm;
      end;
    end if;
  end loop;
end;
$$;
revoke all on function vv_tick_all_rooms() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule: every 2 seconds (pg_cron 1.5+). If this project's pg_cron can't do
-- sub-minute schedules, fall back to every minute — the players' own clients
-- tick every few seconds anyway, so games still run normally.
do $$
begin
  begin
    perform cron.schedule('vv-tick-rooms', '2 seconds', 'select public.vv_tick_all_rooms()');
  exception when others then
    perform cron.schedule('vv-tick-rooms', '* * * * *', 'select public.vv_tick_all_rooms()');
  end;
  -- A 2-second job writes ~43k run records a day; keep a day of history.
  perform cron.schedule('vv-tick-history-cleanup', '17 * * * *',
    $c$delete from cron.job_run_details where end_time < now() - interval '1 day'$c$);
end $$;

commit;
