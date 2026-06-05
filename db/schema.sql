-- ============================================
-- Vice and Virtue - database schema
-- MVP step 1: the lobby (rooms + players)
-- Run this in the Supabase SQL Editor.
-- ============================================

-- Rooms: one row per game lobby
create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'lobby',          -- lobby | in_game | ended
  is_public boolean not null default false,       -- discoverable via "Find Public Session" matchmaking (private = code-only)
  phase text not null default 'lobby',            -- lobby | game_overview | lore_intro | role_reveal | role_action | murder_succession | event_summary | minigame | result | outreach | consultation | new_day | game_over
  phase_ends_at timestamptz,                      -- deadline for the current timed phase
  day integer not null default 1,
  outreach_enabled boolean not null default true,
  last_imprisoned_player text,                    -- player id imprisoned in the most recent consultation (or NULL)
  vote_reveal boolean not null default false,     -- Truthfulness has broadcast votes for this round
  envy_swap_a text,                               -- one side of Envy's identity swap (lasts one day)
  envy_swap_b text,                               -- other side
  torment_target text,                            -- Torment's target this day; their minigame is partly ink-obscured
  pending_murder_death text,                      -- Murder id whose death is deferred while they pick a successor
  revote_candidates jsonb,                        -- array of player ids when consultation is in a tie re-vote (else null)
  recent_successor_id text,                       -- player id who just took over Murder via succession (cleared next day)
  last_events jsonb,                              -- array of { type, target_id } banners shown on the Event Summary screen; cleared each new day
  group_action_result text,                       -- legacy single-outcome enum; superseded by eye_revealed + group_action_freed_id
  group_action_freed_id text,                     -- prisoner freed by the Virtue majority this round; cleared each new day
  eye_revealed boolean not null default false,    -- Vices used the Revealing Eye this round (banner); cleared each round
  eye_uses_left integer not null default 1,       -- remaining Vice-only "Revealing Eye" uses (once per game)
  free_uses_left integer not null default 1,      -- remaining Virtue-only "Free a prisoner" uses (once per game)
  role_pool jsonb,                                -- set of role ids in this game (public; Game Overview list)
  next_room_code text,                            -- re-queue: code of the new lobby spun up from the end screen
  created_at timestamptz not null default now()
);

-- Speeds up the "Find Public Session" matchmaker's scan for open public lobbies.
create index if not exists rooms_public_lobby_idx
  on rooms (is_public, status)
  where is_public and status = 'lobby';

-- Players: one row per person who joined a room
create table players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,  -- account this row belongs to, NULL for guests
  name text not null,
  is_host boolean not null default false,
  connected boolean not null default true,
  -- SECRET fields (role, vote, pending_action, pending_target) live in the
  -- locked-down player_secrets table, NOT here, so they're never sent to a
  -- browser. See migrations 028 + 036.
  ready boolean not null default false,           -- ready to leave the current phase
  minigame_score numeric not null default 0,      -- raw score from the last minigame
  minigame_submitted_at timestamptz,              -- when they submitted this round (for tie-breaking)
  soul_energy numeric not null default 0,         -- accumulated points
  has_voted boolean not null default false,       -- whether this player has voted this round (set by submit_vote; reveals no target)
  in_prison boolean not null default false,       -- voted to prison
  dead boolean not null default false,            -- killed (by Murder, Justice-kill, etc.)
  in_hospital boolean not null default false,     -- 1-day skip state (Intoxication, Vengeance)
  acted_this_day boolean not null default false,  -- used role ability this day
  murder_kills integer not null default 0,        -- per-game kills landed while holding Murder (for badges)
  created_at timestamptz not null default now()
);

-- Messages: per-camp secret messages from Vice Worshipper / Virtue Seeker.
create table messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  camp text not null,                            -- 'vice' or 'virtue'
  sender_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- DM messages: 1-on-1 chat during the outreach phase.
-- `day` is the in-game day the message was sent on; the client filters
-- by current day so each outreach phase starts fresh.
create table dm_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid not null references players(id) on delete cascade,
  recipient_id uuid not null references players(id) on delete cascade,
  day integer,
  text text not null,
  created_at timestamptz not null default now()
);

-- Consultation chat: public "meeting chat" shown during the
-- consultation phase. Distinct from messages (camp-only, anonymous).
create table consultation_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid not null references players(id) on delete cascade,
  day integer not null,
  text text not null,
  created_at timestamptz not null default now()
);

-- Dead chat: private side channel for players who have died.
-- Only visible to dead players; living players never see it.
create table dead_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- Profiles: one row per registered account, keyed to Supabase's
-- built-in auth.users. Joining a room is guest-only; an account is
-- needed only to CREATE a room and to keep lifetime stats.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  favorite_role text,                            -- role id from roles.ts, nullable
  avatar_url text,                               -- uploaded profile photo URL, nullable
  featured_badges text[] not null default '{}',  -- up to 2 badge ids shown next to your name
  created_at timestamptz not null default now()
);

create unique index profiles_username_lower_idx on profiles (lower(username));

-- Game results: one row per account per finished game. room_id groups
-- co-players (plain uuid, no FK, so results survive room cleanup).
create table game_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  role text,                                     -- role id held at game end
  camp text,                                     -- 'vice' | 'virtue'
  won boolean not null,
  created_at timestamptz not null default now()
);

create index game_results_user_idx on game_results (user_id);
create index game_results_room_idx on game_results (room_id);

-- Achievements: one-off badge keys that aren't derivable from
-- game_results (in-game events, honour-system claims).
create table user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Friendships: one row per pair; requester sends, addressee accepts.
create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',          -- 'pending' | 'accepted'
  created_at timestamptz not null default now(),
  constraint friendships_no_self check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index friendships_requester_idx on friendships (requester_id);
create index friendships_addressee_idx on friendships (addressee_id);

-- Auto-create a profile row on sign-up from the username in auth metadata.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Row Level Security is required by Supabase.
-- For the MVP we allow open access so the app just works.
-- TODO before launch: replace these with proper, restrictive policies.
alter table rooms enable row level security;
alter table players enable row level security;
alter table messages enable row level security;
alter table dm_messages enable row level security;
alter table consultation_messages enable row level security;
alter table dead_messages enable row level security;

create policy "open access to rooms" on rooms
  for all using (true) with check (true);

create policy "open access to players" on players
  for all using (true) with check (true);

create policy "open access to messages" on messages
  for all using (true) with check (true);

create policy "open access to dm_messages" on dm_messages
  for all using (true) with check (true);

create policy "open access to consultation_messages" on consultation_messages
  for all using (true) with check (true);

create policy "open access to dead_messages" on dead_messages
  for all using (true) with check (true);

-- Profiles use proper restrictive policies (they hold personal data,
-- unlike the open MVP game tables above).
alter table profiles enable row level security;
alter table game_results enable row level security;
alter table user_achievements enable row level security;
alter table friendships enable row level security;

create policy "profiles are readable by everyone"
  on profiles for select using (true);

-- Open access for MVP (tighten before launch with the rest).
create policy "open access to game_results" on game_results
  for all using (true) with check (true);

-- Achievements: world-readable, write-your-own.
create policy "achievements readable by everyone"
  on user_achievements for select using (true);

create policy "users insert their own achievements"
  on user_achievements for insert with check (auth.uid() = user_id);

-- Host-side grants (in-game event badges) go through this SECURITY
-- DEFINER function so the host can award keys to any player.
create or replace function grant_achievements(p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
begin
  for rec in select * from jsonb_array_elements(p_awards)
  loop
    insert into user_achievements (user_id, key)
    values ((rec->>'u')::uuid, rec->>'k')
    on conflict (user_id, key) do nothing;
  end loop;
end;
$$;

grant execute on function grant_achievements(jsonb) to anon, authenticated;

-- Friendships use proper per-user policies (consent-related).
create policy "see own friendships"
  on friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "create own requests"
  on friendships for insert
  with check (auth.uid() = requester_id);

create policy "addressee updates request"
  on friendships for update
  using (auth.uid() = addressee_id) with check (auth.uid() = addressee_id);

create policy "either party deletes"
  on friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "users insert their own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "users update their own profile"
  on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Realtime: let the app subscribe to live changes
-- (so the lobby player list updates as people join, messages appear, etc.).
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table dm_messages;
alter publication supabase_realtime add table consultation_messages;
alter publication supabase_realtime add table dead_messages;
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table friendships;

-- ============================================
-- Automatic cleanup (migration 027)
-- ============================================
-- Rooms older than 24h are finished games or abandoned lobbies. A
-- nightly pg_cron job deletes them; cascade removes their players +
-- all four chat tables. game_results / profiles / friendships /
-- user_achievements are unaffected (no FK to rooms).
create extension if not exists pg_cron;

create or replace function public.cleanup_old_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.rooms
  where created_at < now() - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

do $$
begin
  perform cron.unschedule('cleanup-old-rooms');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'cleanup-old-rooms',
  '0 4 * * *',                       -- every day at 04:00 UTC
  $$ select public.cleanup_old_rooms(); $$
);

-- ============================================
-- Secret player fields + server-side game logic (migration 028+)
-- ============================================
-- "Hide roles for real": secret per-player fields move into a locked-down
-- player_secrets table so they stop being sent to the browser, and logic
-- that needs them runs in SECURITY DEFINER functions. The public players
-- table keeps every non-secret field (realtime unchanged). During the
-- migration a trigger mirrors players.* -> player_secrets so old client
-- writes keep working; the final batch drops the bridge + old columns.

-- Static role -> camp lookup, reused by every server-side game function.
create or replace function vv_role_camp(p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_role in
      ('murder','intoxication','envy','torment','vengeance','vice_worshipper')
      then 'vice'
    when p_role in
      ('empathy','justice','truthfulness','certainty','sacrifice','virtue_seeker')
      then 'virtue'
    else null
  end;
$$;

-- Secret fields. No RLS policies => no direct anon/authenticated access;
-- reachable only through the SECURITY DEFINER trigger + RPCs. Not added to
-- the realtime publication, so never broadcast.
create table player_secrets (
  player_id uuid primary key references players(id) on delete cascade,
  role text,
  vote text,
  pending_action text,
  pending_target text
);

alter table player_secrets enable row level security;

-- player_secrets rows are created by assign_roles_and_start (game start)
-- and written only by the SECURITY DEFINER RPCs below (submit_vote,
-- queue_action, clear_room_votes, and the resolution functions). There is
-- no mirror trigger — the players.* secret columns were dropped (migration
-- 036), so nothing writes secrets to the players table.

-- Server-side minigame scoring (ports computeScore from Minigame.tsx):
-- +1 correct, +0.4 unknown/untagged, any explicit wrong tag => 0. The
-- client sends only its guesses; real roles never leave the database.
create or replace function submit_minigame_guesses(
  p_player_id uuid,
  p_guesses jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_score numeric := 0;
  v_target record;
  v_guess text;
  v_truth text;
begin
  select room_id into v_room_id
  from players
  where id = p_player_id and not dead and not in_prison and not in_hospital;
  if v_room_id is null then
    return 0;
  end if;

  for v_target in
    select p.id, s.role
    from players p
    left join player_secrets s on s.player_id = p.id
    where p.room_id = v_room_id
      and p.id <> p_player_id
      and not p.dead
      and not p.in_prison
  loop
    v_guess := p_guesses ->> v_target.id::text;
    v_truth := vv_role_camp(v_target.role);
    if v_guess is null or v_guess = 'unknown' or v_truth is null then
      v_score := v_score + 0.4;
    elsif v_guess = v_truth then
      v_score := v_score + 1;
    else
      v_score := 0;
      exit;
    end if;
  end loop;

  update players
  set minigame_score = v_score,
      minigame_submitted_at = now(),
      ready = true
  where id = p_player_id;

  return v_score;
end;
$$;

grant execute on function submit_minigame_guesses(uuid, jsonb) to anon, authenticated;

-- Certainty (cost 100): reveal one target's exact role id (migration 029).
create or replace function reveal_role(p_player_id uuid, p_target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_caller_role text;
  v_target_role text;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_caller_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_caller_role is distinct from 'certainty'
     or v_acted or v_se < 100 then
    return null;
  end if;

  select s.role into v_target_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_target_id and p.room_id = v_room_id;

  if v_target_role is null then
    return null;
  end if;

  update players
  set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  return v_target_role;
end;
$$;

grant execute on function reveal_role(uuid, uuid) to anon, authenticated;

-- Empathy (cost 150): reveal who voted for whom last consultation as a
-- jsonb array [{ target_id, voter_ids:[...] }] (migration 029).
create or replace function reveal_votes_empathy(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_caller_role text;
  v_result jsonb;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_caller_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_caller_role is distinct from 'empathy'
     or v_acted or v_se < 150 then
    return null;
  end if;

  update players
  set soul_energy = soul_energy - 150, acted_this_day = true
  where id = p_player_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('target_id', target_id, 'voter_ids', voter_ids)),
    '[]'::jsonb
  )
    into v_result
  from (
    select s.vote as target_id, array_agg(s.player_id) as voter_ids
    from player_secrets s
    join players p on p.id = s.player_id
    where p.room_id = v_room_id
      and s.vote is not null
      and s.vote <> 'skip'
    group by s.vote
  ) t;

  return v_result;
end;
$$;

grant execute on function reveal_votes_empathy(uuid) to anon, authenticated;

-- Win check (ports winConditions.checkWinner) — migration 030.
create or replace function vv_check_winner(p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_active int;
  v_murder int;
  v_vices int;
  v_virtues int;
begin
  select
    count(*),
    count(*) filter (where s.role = 'murder'),
    count(*) filter (where vv_role_camp(s.role) = 'vice'),
    count(*) filter (where vv_role_camp(s.role) = 'virtue')
  into v_active, v_murder, v_vices, v_virtues
  from players p
  join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison;

  if v_active = 2 and v_murder >= 1 then
    return 'vice';
  end if;
  if v_vices = 0 and v_virtues > 0 then return 'virtue'; end if;
  if v_virtues = 0 and v_vices > 0 then return 'vice'; end if;
  return null;
end;
$$;

grant execute on function vv_check_winner(uuid) to anon, authenticated;

-- Role-action resolution (ports endRoleAction) — migration 030.
create or replace function resolve_role_action(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_imprisoned text;
  v_protected uuid[] := '{}';
  v_dead uuid[] := '{}';
  v_hospital uuid[] := '{}';
  v_envy_a text;
  v_envy_b text;
  v_torment text;
  v_dying_murder uuid;
  v_succession boolean := false;
  v_candidates int;
  v_events jsonb;
  v_winner text;
  r record;
  v_newtotal int;
begin
  select last_imprisoned_player into v_last_imprisoned from rooms where id = p_room_id;

  select coalesce(array_agg(s.pending_target::uuid), '{}')
    into v_protected
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and s.pending_action = 'protect' and s.pending_target is not null;

  for r in
    select p.id, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('kill','sacrifice') and s.pending_target is not null
  loop
    if r.act = 'kill' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    else
      if not (r.id = any(v_protected)) then
        v_dead := array_append(v_dead, r.id);
      end if;
      if not (r.tgt::uuid = any(v_protected)) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    end if;
  end loop;

  for r in
    select p.id, p.dead as wasdead, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('envy_swap','torment') and s.pending_target is not null
  loop
    if not r.wasdead and not (r.id = any(v_dead)) then
      if r.act = 'envy_swap' then
        v_envy_a := r.id::text;
        v_envy_b := r.tgt;
      else
        v_torment := r.tgt;
      end if;
    end if;
  end loop;

  for r in
    select p.id, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('intox','vengeance_guess') and s.pending_target is not null
  loop
    if r.act = 'intox' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_hospital := array_append(v_hospital, r.tgt::uuid);
      end if;
    else
      if v_last_imprisoned is not null and exists (
        select 1 from player_secrets gs
        where gs.player_id = r.tgt::uuid and gs.vote = v_last_imprisoned
      ) then
        v_hospital := array_append(v_hospital, r.tgt::uuid);
      end if;
    end if;
  end loop;

  select p.id into v_dying_murder
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and s.role = 'murder' and p.id = any(v_dead)
  limit 1;

  if v_dying_murder is not null then
    select count(*) into v_candidates
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and p.id <> v_dying_murder
      and vv_role_camp(s.role) = 'vice'
      and not p.dead and not p.in_prison and not p.in_hospital
      and not (p.id = any(v_dead));
    if v_candidates > 0 then
      v_succession := true;
      v_dead := array_remove(v_dead, v_dying_murder);
    end if;
  end if;

  for r in
    select p.id, p.user_id, p.murder_kills, s.role,
           s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('kill','sacrifice') and s.pending_target is not null
  loop
    if r.tgt::uuid = any(v_dead) then
      if r.user_id is not null and vv_role_camp(r.role) is not null
         and vv_role_camp(r.role) = (
           select vv_role_camp(s2.role) from player_secrets s2 where s2.player_id = r.tgt::uuid
         ) then
        insert into user_achievements (user_id, key)
        values (r.user_id, 'kill_teammate') on conflict do nothing;
      end if;
      if r.act = 'kill' and r.role = 'murder' then
        v_newtotal := coalesce(r.murder_kills, 0) + 1;
        update players set murder_kills = v_newtotal where id = r.id;
        if r.user_id is not null then
          if v_newtotal >= 3 then
            insert into user_achievements (user_id, key)
            values (r.user_id, 'murder_3') on conflict do nothing;
          end if;
          if v_newtotal >= 5 then
            insert into user_achievements (user_id, key)
            values (r.user_id, 'murder_5') on conflict do nothing;
          end if;
        end if;
      end if;
    end if;
  end loop;

  insert into user_achievements (user_id, key)
  select p.user_id, 'murdered_hospital'
  from players p
  where p.id = any(v_dead) and p.in_hospital and p.user_id is not null
  on conflict do nothing;

  insert into user_achievements (user_id, key)
  select prot.user_id, 'justice_protect'
  from players prot join player_secrets ps on ps.player_id = prot.id
  where prot.room_id = p_room_id and ps.pending_action = 'protect'
    and ps.pending_target is not null and prot.user_id is not null
    and exists (
      select 1 from player_secrets k join players kp on kp.id = k.player_id
      where kp.room_id = p_room_id and (
        (k.pending_action = 'kill' and k.pending_target = ps.pending_target)
        or (k.pending_action = 'sacrifice'
            and (k.pending_target = ps.pending_target
                 or k.player_id::text = ps.pending_target))
      )
    )
  on conflict do nothing;

  if v_envy_a is not null and v_envy_b is not null and v_envy_b::uuid = any(v_dead) then
    insert into user_achievements (user_id, key)
    select user_id, 'envy_escape' from players
    where id = v_envy_a::uuid and user_id is not null
    on conflict do nothing;
  end if;

  update players set dead = true where id = any(v_dead);
  update players set in_hospital = true
    where id = any(v_hospital) and not (id = any(v_dead));
  update player_secrets set pending_action = null, pending_target = null
    where player_id in (select id from players where room_id = p_room_id);

  v_events := coalesce(
    (select jsonb_agg(jsonb_build_object('type','killed','target_id', q.d))
       from (select distinct u as d from unnest(v_dead) u) q),
    '[]'::jsonb);
  v_events := v_events || coalesce(
    (select jsonb_agg(jsonb_build_object('type','hospitalized','target_id', q.h))
       from (select distinct u as h from unnest(v_hospital) u) q
       where not (q.h = any(v_dead))),
    '[]'::jsonb);

  update rooms
    set envy_swap_a = v_envy_a, envy_swap_b = v_envy_b, torment_target = v_torment
  where id = p_room_id;

  if v_succession and v_dying_murder is not null then
    update rooms set
      phase = 'murder_succession', phase_ends_at = null,
      pending_murder_death = v_dying_murder::text, last_events = v_events
    where id = p_room_id;
    return;
  end if;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null, last_events = v_events
    where id = p_room_id;
    return;
  end if;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'event_summary', phase_ends_at = null, last_events = v_events
  where id = p_room_id;
end;
$$;

grant execute on function resolve_role_action(uuid) to anon, authenticated;

-- Murder succession (ports chooseMurderSuccessor) — migration 030.
create or replace function choose_murder_successor(p_room_id uuid, p_successor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dying text;
  v_events jsonb;
  v_winner text;
begin
  select pending_murder_death into v_dying from rooms where id = p_room_id;
  if v_dying is null then return; end if;

  update players set dead = true where id = v_dying::uuid;
  update player_secrets set role = 'murder' where player_id = p_successor_id;

  select coalesce(last_events, '[]'::jsonb)
         || jsonb_build_object('type','killed','target_id', v_dying)
    into v_events from rooms where id = p_room_id;

  update rooms set
    pending_murder_death = null,
    recent_successor_id = p_successor_id::text,
    last_events = v_events
  where id = p_room_id;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = p_room_id;
    return;
  end if;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'event_summary', phase_ends_at = null where id = p_room_id;
end;
$$;

grant execute on function choose_murder_successor(uuid, uuid) to anon, authenticated;

-- Consultation resolution (ports endConsultation) — migration 031.
create or replace function resolve_consultation(p_room_id uuid)
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
  select count(*) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, count(*) as c
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

  if v_imprisoned is not null then
    update players set in_prison = true where id = v_imprisoned::uuid;
  end if;

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

grant execute on function resolve_consultation(uuid) to anon, authenticated;

-- Tie-breaker re-vote (ports startRevote) — migration 031.
create or replace function start_revote(p_room_id uuid, p_candidate_ids jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets set vote = null
  where player_id in (select id from players where room_id = p_room_id);
  update players set has_voted = false where room_id = p_room_id;
  update rooms set
    revote_candidates = p_candidate_ids,
    phase_ends_at = now() + interval '95 seconds'
  where id = p_room_id;
end;
$$;

grant execute on function start_revote(uuid, jsonb) to anon, authenticated;

-- Instant Sacrifice in consultation (ports instantSacrifice) — migration 031.
create or replace function instant_sacrifice(
  p_room_id uuid, p_player_id uuid, p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner text;
begin
  update players set dead = true, acted_this_day = true where id = p_player_id;
  update players set dead = true where id = p_target_id;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = p_room_id;
  end if;
end;
$$;

grant execute on function instant_sacrifice(uuid, uuid, uuid) to anon, authenticated;

-- players.has_voted is maintained directly by submit_vote / clear_room_votes
-- (migration 036). There is no sync trigger — players.vote no longer exists.

-- Aggregate consultation outcome for the result screen — migration 032.
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
begin
  select count(*) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, count(*) as c
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

-- Truthfulness reveal (migration 033): verify caller, spend SE, set vote_reveal.
create or replace function reveal_votes_truthfulness(p_player_id uuid)
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

grant execute on function reveal_votes_truthfulness(uuid) to anon, authenticated;

-- Voters of the round's imprisoned player, only when revealed (migration 033).
create or replace function get_revealed_voters(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reveal boolean;
  v_target text;
  v_result jsonb;
begin
  select vote_reveal into v_reveal from rooms where id = p_room_id;
  if not coalesce(v_reveal, false) then
    return '[]'::jsonb;
  end if;

  v_target := consultation_tally(p_room_id) ->> 'imprisoned_id';
  if v_target is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(s.player_id), '[]'::jsonb) into v_result
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.vote = v_target;

  return v_result;
end;
$$;

grant execute on function get_revealed_voters(uuid) to anon, authenticated;

-- Vengeance gate: true only for Vengeance when a Vice was just imprisoned
-- (migration 033). Told only to the caller, never broadcast.
create or replace function vengeance_available(p_player_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_role text;
  v_last text;
  v_camp text;
begin
  select p.room_id, s.role into v_room_id, v_role
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_role is distinct from 'vengeance' then return false; end if;

  select last_imprisoned_player into v_last from rooms where id = v_room_id;
  if v_last is null then return false; end if;

  select vv_role_camp(s.role) into v_camp
  from player_secrets s where s.player_id = v_last::uuid;

  return v_camp = 'vice';
end;
$$;

grant execute on function vengeance_available(uuid) to anon, authenticated;

-- Group action resolution (ports endGroupAction) — migration 034.
create or replace function resolve_group_action(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eye_left int;
  v_free_left int;
  v_eye_yes int;
  v_eye_no int;
  v_eye_fires boolean;
  v_freed text;
  v_free_topn int;
  v_freed_user uuid;
begin
  select eye_uses_left, free_uses_left into v_eye_left, v_free_left
  from rooms where id = p_room_id;

  select
    count(*) filter (where s.vote = 'eye_yes'),
    count(*) filter (where s.vote = 'eye_no')
  into v_eye_yes, v_eye_no
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.dead and not p.in_prison and not p.in_hospital
    and vv_role_camp(s.role) = 'vice';
  v_eye_fires := v_eye_left > 0 and v_eye_yes > v_eye_no;

  v_freed := null;
  if v_free_left > 0 then
    with fv as (
      select s.vote as target, count(*) as c
      from players p join player_secrets s on s.player_id = p.id
      where p.room_id = p_room_id
        and not p.dead and not p.in_prison and not p.in_hospital
        and vv_role_camp(s.role) = 'virtue' and s.vote is not null
      group by s.vote
    ), mx as (select coalesce(max(c), 0) as m from fv)
    select
      (select count(*) from fv, mx where fv.c = mx.m and mx.m > 0),
      (select target from fv, mx where fv.c = mx.m and mx.m > 0 limit 1)
    into v_free_topn, v_freed;

    if v_free_topn = 1 and v_freed is not null and v_freed <> 'no_free' then
      if not exists (
        select 1 from players where id = v_freed::uuid and in_prison and not dead
      ) then
        v_freed := null;
      end if;
    else
      v_freed := null;
    end if;
  end if;

  if v_freed is not null then
    update players set in_prison = false where id = v_freed::uuid;
    select user_id into v_freed_user from players where id = v_freed::uuid;
    if v_freed_user is not null then
      insert into user_achievements (user_id, key)
      values (v_freed_user, 'freed_prison') on conflict do nothing;
    end if;
  end if;

  update rooms set
    eye_revealed = v_eye_fires,
    eye_uses_left = case when v_eye_fires then greatest(0, v_eye_left - 1) else v_eye_left end,
    group_action_freed_id = v_freed,
    free_uses_left = case when v_freed is not null then greatest(0, v_free_left - 1) else v_free_left end
  where id = p_room_id;

  update player_secrets set vote = null
  where player_id in (select id from players where room_id = p_room_id);
  update players set has_voted = false where room_id = p_room_id;
  update rooms set
    phase = 'consultation', vote_reveal = false,
    phase_ends_at = now() + interval '95 seconds'
  where id = p_room_id;
end;
$$;

grant execute on function resolve_group_action(uuid) to anon, authenticated;

-- Group-action readiness for the host's early advance — migration 034.
create or replace function group_action_ready(p_room_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eye_avail boolean;
  v_free_avail boolean;
  v_eligible int;
  v_voted int;
begin
  select
    (eye_uses_left > 0),
    (free_uses_left > 0 and exists (
      select 1 from players where room_id = p_room_id and in_prison and not dead))
  into v_eye_avail, v_free_avail
  from rooms where id = p_room_id;

  select
    count(*) filter (where (v_eye_avail and vv_role_camp(s.role) = 'vice')
                        or (v_free_avail and vv_role_camp(s.role) = 'virtue')),
    count(*) filter (where ((v_eye_avail and vv_role_camp(s.role) = 'vice')
                         or (v_free_avail and vv_role_camp(s.role) = 'virtue'))
                        and s.vote is not null)
  into v_eligible, v_voted
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison and not p.in_hospital;

  return v_eligible = 0 or v_voted >= v_eligible;
end;
$$;

grant execute on function group_action_ready(uuid) to anon, authenticated;

-- Active camp counts for the Eye banner, only after the Eye fired — migration 034.
create or replace function count_active_camps(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vices int;
  v_virtues int;
begin
  if not coalesce((select eye_revealed from rooms where id = p_room_id), false) then
    return null;
  end if;

  select
    count(*) filter (where vv_role_camp(s.role) = 'vice'),
    count(*) filter (where vv_role_camp(s.role) = 'virtue')
  into v_vices, v_virtues
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison;

  return jsonb_build_object('vices', v_vices, 'virtues', v_virtues);
end;
$$;

grant execute on function count_active_camps(uuid) to anon, authenticated;

-- A player's own secrets (role / vote / queued action) + per-viewer room
-- flags (migrations 035 + 037).
create or replace function get_my_secrets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_room_id uuid;
  v_dying boolean := false;
  v_succ boolean := false;
  v_torment boolean := false;
begin
  select room_id into v_room_id from players where id = p_player_id;
  if v_room_id is not null then
    select
      coalesce(pending_murder_death = p_player_id::text, false),
      coalesce(recent_successor_id = p_player_id::text, false),
      coalesce(torment_target = p_player_id::text, false)
    into v_dying, v_succ, v_torment
    from rooms where id = v_room_id;
  end if;

  select jsonb_build_object(
    'role', ps.role, 'vote', ps.vote,
    'pending_action', ps.pending_action, 'pending_target', ps.pending_target,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment)
  into v
  from player_secrets ps where ps.player_id = p_player_id;

  return coalesce(v, jsonb_build_object(
    'role', null, 'vote', null, 'pending_action', null, 'pending_target', null,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment));
end;
$$;

grant execute on function get_my_secrets(uuid) to anon, authenticated;

-- Per-viewer display names (dedup + Envy swap for non-participants) so the
-- raw envy_swap_a/b never reach a client — migration 037.
create or replace function get_display_names(p_room_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_a text;
  v_b text;
  v_participant boolean;
  v_result jsonb;
begin
  select envy_swap_a, envy_swap_b into v_a, v_b from rooms where id = p_room_id;
  v_participant := v_a is not null and v_b is not null
    and (p_viewer_id::text = v_a or p_viewer_id::text = v_b);

  with dedup as (
    select p.id,
      case when count(*) over (partition by p.name) > 1
           then (row_number() over (partition by p.name order by p.created_at))::text
                || '. ' || p.name
           else p.name end as dname
    from players p where p.room_id = p_room_id
  ),
  swapped as (
    select d.id,
      case
        when v_a is not null and v_b is not null and not v_participant and d.id::text = v_a
          then (select dname from dedup where id = v_b::uuid)
        when v_a is not null and v_b is not null and not v_participant and d.id::text = v_b
          then (select dname from dedup where id = v_a::uuid)
        else d.dname
      end as final_name
    from dedup d
  )
  select coalesce(jsonb_object_agg(id::text, final_name), '{}'::jsonb)
  into v_result from swapped;

  return v_result;
end;
$$;

grant execute on function get_display_names(uuid, uuid) to anon, authenticated;

-- The dying Murder's eligible Vice successors — migration 035.
create or replace function eligible_successors(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dying text;
  v_result jsonb;
begin
  select pending_murder_death into v_dying from rooms where id = p_room_id;
  if v_dying is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(p.id), '[]'::jsonb) into v_result
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and p.id <> v_dying::uuid
    and vv_role_camp(s.role) = 'vice'
    and not p.dead and not p.in_prison and not p.in_hospital;

  return v_result;
end;
$$;

grant execute on function eligible_successors(uuid) to anon, authenticated;

-- Every player's role, only once the game has ended — migration 035.
create or replace function reveal_all_roles(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_result jsonb;
begin
  select status into v_status from rooms where id = p_room_id;
  if v_status <> 'ended' then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id, 'user_id', p.user_id, 'role', s.role)), '[]'::jsonb)
  into v_result
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id;

  return v_result;
end;
$$;

grant execute on function reveal_all_roles(uuid) to anon, authenticated;

-- ---- Write RPCs: secrets are written to player_secrets only (migration 036) ----

create or replace function submit_vote(p_player_id uuid, p_vote text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets set vote = p_vote where player_id = p_player_id;
  update players set has_voted = (p_vote is not null) where id = p_player_id;
end;
$$;

grant execute on function submit_vote(uuid, text) to anon, authenticated;

create or replace function queue_action(
  p_player_id uuid, p_cost numeric, p_action text, p_target text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets
    set pending_action = p_action, pending_target = p_target
  where player_id = p_player_id;
  update players
    set soul_energy = soul_energy - p_cost, acted_this_day = true
  where id = p_player_id;
end;
$$;

grant execute on function queue_action(uuid, numeric, text, text) to anon, authenticated;

create or replace function clear_room_votes(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets set vote = null
  where player_id in (select id from players where room_id = p_room_id);
  update players set has_voted = false where room_id = p_room_id;
end;
$$;

grant execute on function clear_room_votes(uuid) to anon, authenticated;

-- Assign roles + start the game entirely server-side (ports assignRoles +
-- startGame) so even the host never receives the role list.
create or replace function assign_roles_and_start(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_player record;
  v_i int := 1;
begin
  select count(*) into v_total from players where room_id = p_room_id;
  v_vice := floor(v_total / 2.0);
  v_virtue := v_total - v_vice;

  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array['murder','intoxication','envy','torment','vengeance'])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array['empathy','justice','certainty','truthfulness','sacrifice'])[i],
      'virtue_seeker'));
  end loop;

  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action, pending_target)
    values (v_player.id, v_roles[v_i], null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  update rooms set
    status = 'in_game', phase = 'game_overview',
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1
  where id = p_room_id;
end;
$$;

grant execute on function assign_roles_and_start(uuid) to anon, authenticated;

-- Worldwide "most wins" leaderboard (profile screen). Returns the top players
-- by total wins with their public profile (username, avatar, featured badges).
create or replace function leaderboard_top_wins(p_limit integer default 10)
returns table (
  user_id uuid,
  username text,
  avatar_url text,
  featured_badges text[],
  wins bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select gr.user_id, p.username, p.avatar_url, p.featured_badges, count(*) as wins
  from game_results gr
  join profiles p on p.id = gr.user_id
  where gr.won
  group by gr.user_id, p.username, p.avatar_url, p.featured_badges
  order by count(*) desc, p.username asc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

grant execute on function leaderboard_top_wins(integer) to anon, authenticated;

-- ============================================
-- Public lobby matchmaking (migrations 042 + 043)
-- ============================================
-- "Find Public Session": atomically join the fullest open public lobby
-- (public, in lobby, < 12 players) or create + host a new one if none.
-- The 12 ceiling is matchmaking-only; code-joins still fill up to 20.
-- Rejoin guard (043): if this browser already holds a seat in an open public
-- lobby, hand it back instead of inserting a duplicate "puppet" row.
drop function if exists find_or_create_public_room(text, uuid);
create or replace function find_or_create_public_room(
  p_name text,
  p_user_id uuid,
  p_existing_player_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
  v_is_host boolean := false;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- mirrors CODE_ALPHABET in room.ts
  v_i int;
begin
  -- Rejoin guard: already seated in an open public lobby? Return that seat.
  if p_existing_player_id is not null then
    select r.id, r.code into v_room_id, v_code
    from rooms r
    join players p on p.room_id = r.id
    where p.id = p_existing_player_id
      and r.is_public
      and r.status = 'lobby';
    if v_room_id is not null then
      return jsonb_build_object('code', v_code, 'player_id', p_existing_player_id);
    end if;
  end if;

  -- Fullest still-fillable public lobby (< 12 players). FOR UPDATE SKIP
  -- LOCKED means simultaneous matchmakers won't both grab the same
  -- near-full lobby: the second skips the locked row and picks/creates
  -- another, so matchmaking never overshoots 12. Counts live in subqueries
  -- because FOR UPDATE can't be combined with GROUP BY at the same level.
  select r.id, r.code into v_room_id, v_code
  from rooms r
  where r.is_public
    and r.status = 'lobby'
    and (select count(*) from players p where p.room_id = r.id) < 12
  order by (select count(*) from players p where p.room_id = r.id) desc,
           r.created_at asc
  limit 1
  for update skip locked;

  if v_room_id is null then
    loop
      v_code := '';
      for v_i in 1..5 loop
        v_code := v_code ||
          substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      end loop;
      begin
        insert into rooms (code, is_public) values (v_code, true)
        returning id into v_room_id;
        exit;
      exception when unique_violation then
        -- code already taken, generate another
      end;
    end loop;
    v_is_host := true;
  end if;

  insert into players (room_id, user_id, name, is_host)
  values (v_room_id, p_user_id, p_name, v_is_host)
  returning id into v_player_id;

  return jsonb_build_object('code', v_code, 'player_id', v_player_id);
end;
$$;

grant execute on function find_or_create_public_room(text, uuid, uuid) to anon, authenticated;
