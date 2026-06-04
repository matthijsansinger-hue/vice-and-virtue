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
  created_at timestamptz not null default now()
);

-- Players: one row per person who joined a room
create table players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,  -- account this row belongs to, NULL for guests
  name text not null,
  is_host boolean not null default false,
  connected boolean not null default true,
  role text,                                      -- assigned role id, NULL in the lobby
  ready boolean not null default false,           -- ready to leave the current phase
  minigame_score numeric not null default 0,      -- raw score from the last minigame
  minigame_submitted_at timestamptz,              -- when they submitted this round (for tie-breaking)
  soul_energy numeric not null default 0,         -- accumulated points
  vote text,                                      -- current consultation vote: player id, 'skip', or NULL
  in_prison boolean not null default false,       -- voted to prison
  dead boolean not null default false,            -- killed (by Murder, Justice-kill, etc.)
  in_hospital boolean not null default false,     -- 1-day skip state (Intoxication, Vengeance)
  acted_this_day boolean not null default false,  -- used role ability this day
  pending_action text,                            -- queued action ('kill' | 'protect' | ...)
  pending_target text,                            -- target player's id for the queued action
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

-- Bridge: keep player_secrets in sync with writes to players.* during the
-- migration. SECURITY DEFINER so it can write the locked-down table.
create or replace function mirror_player_secrets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into player_secrets (player_id, role, vote, pending_action, pending_target)
  values (new.id, new.role, new.vote, new.pending_action, new.pending_target)
  on conflict (player_id) do update
    set role = excluded.role,
        vote = excluded.vote,
        pending_action = excluded.pending_action,
        pending_target = excluded.pending_target;
  return new;
end;
$$;

drop trigger if exists trg_mirror_player_secrets on players;
create trigger trg_mirror_player_secrets
  after insert or update on players
  for each row execute function mirror_player_secrets();

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
