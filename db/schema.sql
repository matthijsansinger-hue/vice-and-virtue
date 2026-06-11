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
  is_ranked boolean not null default false,       -- ranked game: ladder points apply at game end (migration 051)
  phase text not null default 'lobby',            -- lobby | game_overview | role_select | role_overview | lore_intro | role_reveal | role_action | murder_succession | event_summary | minigame | result | outreach | store | group_action | consultation | new_day | vice_victory_intro | virtue_victory_intro | game_over
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
  minigame_clue jsonb,                            -- post-minigame shared clue {target_id, correct, total} (migration 045)
  role_assign_mode text not null default 'random',-- 'random' (secret deal + role_reveal) | 'choose' (live role_select; skips role_reveal) (migration 063)
  role_config jsonb,                              -- host per-tier role config for random mode (migration 063; wired in the lobby batch)
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
  muted boolean not null default false,           -- silenced by moderation (auto-mute after repeated reports)
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

-- Auto-create a profile row (and an account_economy row, migration 050) on
-- sign-up from the username in auth metadata.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  insert into public.account_economy (user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.account_ranked (user_id) values (new.id)
  on conflict (user_id) do nothing;
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

-- Un-started lobbies expire after 10 minutes (migration 055). A room still in
-- the 'lobby' status 10 min after creation is deleted so matchmaking stops
-- dropping players into AFK-host lobbies. Cron runs the janitor every minute,
-- and any client can call it as a self-heal (it only removes stale lobbies,
-- re-checked against server time — never a live/finished game). Keep the
-- interval in sync with LOBBY_EXPIRY_MINUTES in src/lib/room.ts.
create or replace function public.expire_stale_lobbies()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.rooms
  where status = 'lobby'
    and created_at < now() - interval '10 minutes';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.expire_stale_lobbies() to anon, authenticated;

do $$
begin
  perform cron.unschedule('expire-stale-lobbies');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'expire-stale-lobbies',
  '* * * * *',                       -- every minute
  $$ select public.expire_stale_lobbies(); $$
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
  pending_target text,
  minigame_guesses jsonb,                          -- this round's V/V/? guesses, for the shared clue (migration 045)
  -- Store potions (migration 058). Bought secretly in the `store` phase, last
  -- one day cycle. Combat targets carry to the next reflection; the multiplier
  -- to the next minigame; vote_reveal to the upcoming consultation.
  potion_kill_target uuid,
  potion_hosp_target uuid,
  potion_protect boolean not null default false,
  potion_minigame_mult boolean not null default false,
  potion_vote_reveal boolean not null default false,
  -- Live role selection (migration 063): the camp + tier dealt to this player
  -- when the room uses role_assign_mode='choose', and their tentative pick
  -- (visible to camp-mates anonymously) until `role` is locked in.
  assigned_camp text,
  assigned_tier text,
  role_choice text
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

  update player_secrets set minigame_guesses = p_guesses
  where player_id = p_player_id;

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
-- (Migration-056 ability rework + migration-059 combat potions folded in.)
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
  v_imprison uuid[] := '{}';
  v_envy_a text;
  v_envy_b text;
  v_torment text;
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

  -- Protection potion: a live buyer shields THEMSELVES this reflection. Add
  -- their own id to the protected set (alongside Justice's protect targets).
  v_protected := v_protected || coalesce((
    select array_agg(s.player_id)
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.potion_protect and not p.dead
  ), '{}'::uuid[]);

  -- Kills + sacrifices. 'kill' targets one player; 'sacrifice' kills the actor
  -- plus a JSON array of targets (each protect-checked).
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
      v_dead := v_dead || coalesce((
        select array_agg(e::uuid)
        from jsonb_array_elements_text(r.tgt::jsonb) e
        where not (e::uuid = any(v_protected))
      ), '{}'::uuid[]);
    end if;
  end loop;

  -- Kill potion: a live buyer kills a target unless protected or already dead.
  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s
      join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_kill_target
    where p.room_id = p_room_id and s.potion_kill_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_dead := array_append(v_dead, r.tgt);
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

  -- Hospitalise potion: a live buyer hospitalises a target unless protected or
  -- already dead.
  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s
      join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_hosp_target
    where p.room_id = p_room_id and s.potion_hosp_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_hospital := array_append(v_hospital, r.tgt);
    end if;
  end loop;

  -- Worshipper / Seeker counterpart guesses.
  for r in
    select s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('worshipper_guess','seeker_guess') and s.pending_target is not null
  loop
    if r.act = 'worshipper_guess' then
      if not (r.tgt::uuid = any(v_protected)) and exists (
        select 1 from player_secrets gs where gs.player_id = r.tgt::uuid and gs.role = 'virtue_seeker'
      ) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    else
      if exists (
        select 1 from player_secrets gs where gs.player_id = r.tgt::uuid and gs.role = 'vice_worshipper'
      ) then
        v_imprison := array_append(v_imprison, r.tgt::uuid);
      end if;
    end if;
  end loop;

  -- Murder succession removed: a killed Murder simply dies (no hand-off to a
  -- Vice successor). The Murder+1 endgame win check is unchanged.

  -- Murder kill counting + kill_teammate (single-target kills only).
  for r in
    select p.id, p.user_id, p.murder_kills, s.role, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action = 'kill' and s.pending_target is not null
  loop
    if r.tgt::uuid = any(v_dead) then
      if r.user_id is not null and vv_role_camp(r.role) is not null
         and vv_role_camp(r.role) = (
           select vv_role_camp(s2.role) from player_secrets s2 where s2.player_id = r.tgt::uuid
         ) then
        insert into user_achievements (user_id, key)
        values (r.user_id, 'kill_teammate') on conflict do nothing;
      end if;
      if r.role = 'murder' then
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
        or (k.pending_action = 'sacrifice' and k.player_id::text = ps.pending_target)
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
  update players set in_prison = true
    where id = any(v_imprison) and not (id = any(v_dead));
  -- Clear role actions AND the combat potions (they fired this reflection).
  -- The minigame x2 + vote-reveal potions are consumed elsewhere — leave them.
  update player_secrets set pending_action = null, pending_target = null,
    potion_kill_target = null, potion_hosp_target = null, potion_protect = false
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

-- Consultation resolution (ports endConsultation) — migration 031; migration
-- 056 captures Vengeance's jailers; migration 060 clears the vote-reveal potion.
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
  -- The vote-reveal potion only lasts this consultation; retire it now.
  update player_secrets set potion_vote_reveal = false
  where player_id in (select id from players where room_id = p_room_id);

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
  -- Exactly one C-tier role per camp per game, picked at random from the two
  -- (Vice: torment/vengeance, Virtue: truthfulness/sacrifice). Every other tier
  -- contributes one role, so a full camp is S,A,B,C,D and then D-tier filler.
  v_vice_c text := (array['torment','vengeance'])[1 + floor(random() * 2)::int];
  v_virtue_c text := (array['truthfulness','sacrifice'])[1 + floor(random() * 2)::int];
begin
  select count(*) into v_total from players where room_id = p_room_id;
  v_vice := floor(v_total / 2.0);
  v_virtue := v_total - v_vice;

  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array['murder','intoxication','envy', v_vice_c])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array['empathy','justice','certainty', v_virtue_c])[i],
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
      and r.status = 'lobby'
      and r.created_at > now() - interval '10 minutes';  -- skip stale lobbies (migration 055)
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
    and r.created_at > now() - interval '10 minutes'    -- skip stale lobbies (migration 055)
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

-- ============================================
-- Lightweight moderation: reports + auto-mute (migration 044)
-- ============================================
-- Report log (locked: only the RPC writes it; review via the dashboard) +
-- players.muted (above). report_player() auto-mutes after 3 distinct
-- reporters in a game.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  reporter_id uuid not null,
  reported_id uuid not null,
  reported_user_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  unique (room_id, reporter_id, reported_id)
);

create index if not exists reports_room_reported_idx
  on reports (room_id, reported_id);

alter table reports enable row level security;
-- No policies: only report_player() (SECURITY DEFINER) writes it.

create or replace function report_player(
  p_room_id uuid,
  p_reporter_id uuid,
  p_reported_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reported_user uuid;
  v_count int;
  v_threshold constant int := 3;
begin
  if p_reporter_id = p_reported_id then
    return;
  end if;

  select user_id into v_reported_user
  from players
  where id = p_reported_id and room_id = p_room_id;
  if not found then
    return;
  end if;

  insert into reports
    (room_id, reporter_id, reported_id, reported_user_id, reason)
  values
    (p_room_id, p_reporter_id, p_reported_id, v_reported_user,
     nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (room_id, reporter_id, reported_id) do nothing;

  select count(*) into v_count
  from reports
  where room_id = p_room_id and reported_id = p_reported_id;

  if v_count >= v_threshold then
    update players set muted = true where id = p_reported_id;
  end if;
end;
$$;

grant execute on function report_player(uuid, uuid, uuid, text) to anon, authenticated;

-- ============================================
-- Shared post-minigame clue (migration 045)
-- ============================================
-- Most-correctly-read player + counts, published on rooms.minigame_clue for
-- the result screen. Reads the locked guesses + true camps; never exposes a
-- camp to the client (only target id + correct/total). Clears guesses after.
create or replace function compute_minigame_clue(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
  v_correct int;
  v_total int;
begin
  with targets as (
    select p.id as target_id, vv_role_camp(s.role) as camp
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and not p.dead and not p.in_prison
  ),
  guessers as (
    select s.player_id as guesser_id, s.minigame_guesses as g
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.dead and not p.in_prison and not p.in_hospital
      and s.minigame_guesses is not null
  ),
  tally as (
    select t.target_id,
      count(*) filter (where (gr.g ->> t.target_id::text) = t.camp) as correct,
      count(*) as total
    from targets t
    join guessers gr on gr.guesser_id <> t.target_id
    group by t.target_id
  )
  select target_id, correct, total
    into v_target_id, v_correct, v_total
  from tally
  order by correct desc, target_id asc
  limit 1;

  if v_target_id is null or coalesce(v_correct, 0) = 0 then
    update rooms set minigame_clue = jsonb_build_object('target_id', null)
    where id = p_room_id;
  else
    update rooms set minigame_clue = jsonb_build_object(
      'target_id', v_target_id::text,
      'correct', v_correct,
      'total', v_total
    ) where id = p_room_id;
  end if;

  update player_secrets set minigame_guesses = null
  where player_id in (select id from players where room_id = p_room_id);
end;
$$;

grant execute on function compute_minigame_clue(uuid) to anon, authenticated;

-- ============================================
-- Outreach store potions (migration 058)
-- ============================================
-- Buy a potion in the `store` phase (spends players.soul_energy). Purchases are
-- secret (player_secrets) and mutated only here. Returns jsonb {ok, camp?, error?}.
--   camp_reveal   (200 SE): reveals a target's camp now (repeatable, SE-limited).
--   minigame_mult ( 60 SE): doubles your NEXT minigame's Soul Energy (arm once).
-- (kill / hospitalise / protection / vote_reveal are wired in later migrations.)
create or replace function buy_potion(
  p_player_id uuid,
  p_potion text,
  p_target uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_phase text;
  v_se numeric;
  v_dead boolean; v_prison boolean; v_hospital boolean;
  v_cost numeric;
  v_target_role text;
  v_target_dead boolean;
  v_armed boolean;
begin
  select p.room_id, r.phase, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_phase, v_se, v_dead, v_prison, v_hospital
  from players p join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_phase is distinct from 'store' then
    return jsonb_build_object('ok', false, 'error', 'not_store');
  end if;
  if v_dead or v_prison or v_hospital then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;

  v_cost := case p_potion
    when 'kill'          then 300
    when 'hospitalise'   then 200
    when 'protect'       then 200
    when 'camp_reveal'   then 200
    when 'vote_reveal'   then 100
    when 'minigame_mult' then 60
    else null end;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion');
  end if;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;

  -- Minigame x2 (arm once).
  if p_potion = 'minigame_mult' then
    select potion_minigame_mult into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_minigame_mult = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Vote reveal (arm once): see who votes to imprison you this consultation.
  if p_potion = 'vote_reveal' then
    select potion_vote_reveal into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_vote_reveal = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Protection (self, arm once).
  if p_potion = 'protect' then
    select potion_protect into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_protect = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Camp reveal (instant info, repeatable).
  if p_potion = 'camp_reveal' then
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    select s.role into v_target_role
    from players p join player_secrets s on s.player_id = p.id
    where p.id = p_target and p.room_id = v_room_id;
    if v_target_role is null then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true, 'camp', vv_role_camp(v_target_role));
  end if;

  -- Kill / Hospitalise (arm a target for the next reflection; one of each).
  if p_potion in ('kill', 'hospitalise') then
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    select p.dead into v_target_dead
    from players p where p.id = p_target and p.room_id = v_room_id;
    if v_target_dead is null or v_target_dead then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    if p_potion = 'kill' then
      select potion_kill_target is not null into v_armed
      from player_secrets where player_id = p_player_id;
      if v_armed then
        return jsonb_build_object('ok', false, 'error', 'already_bought');
      end if;
      update player_secrets set potion_kill_target = p_target
      where player_id = p_player_id;
    else
      select potion_hosp_target is not null into v_armed
      from player_secrets where player_id = p_player_id;
      if v_armed then
        return jsonb_build_object('ok', false, 'error', 'already_bought');
      end if;
      update player_secrets set potion_hosp_target = p_target
      where player_id = p_player_id;
    end if;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_potion');
end;
$$;
grant execute on function buy_potion(uuid, text, uuid) to anon, authenticated;

-- The caller's own armed potions, for the store UI's "bought" state.
create or replace function my_potions(p_player_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'minigame_mult', coalesce(potion_minigame_mult, false),
    'protect',       coalesce(potion_protect, false),
    'kill',          potion_kill_target is not null,
    'hospitalise',   potion_hosp_target is not null,
    'vote_reveal',   coalesce(potion_vote_reveal, false)
  )
  from player_secrets where player_id = p_player_id;
$$;
grant execute on function my_potions(uuid) to anon, authenticated;

-- Consume (return + clear) the players in a room who armed the Minigame x2
-- potion. Called by the host's endMinigame to double their Soul Energy award.
create or replace function consume_minigame_mult(p_room_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(s.player_id), '{}')
    into v_ids
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.potion_minigame_mult = true;

  update player_secrets set potion_minigame_mult = false
  where player_id = any(v_ids);

  return v_ids;
end;
$$;
grant execute on function consume_minigame_mult(uuid) to anon, authenticated;

-- Vote-reveal potion (migration 060): who is voting to imprison the caller.
-- Gated on the armed flag + the consultation phase (during group-action,
-- player_secrets.vote holds eye/free choices, not imprisonment votes). Returns
-- the voters' player ids; the client maps them to display names.
create or replace function my_voters(p_player_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_phase text;
  v_armed boolean;
  v_ids uuid[];
begin
  select p.room_id, r.phase, s.potion_vote_reveal
    into v_room_id, v_phase, v_armed
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_phase is distinct from 'consultation'
     or not coalesce(v_armed, false) then
    return '{}'::uuid[];
  end if;

  select coalesce(array_agg(vp.id order by vp.created_at), '{}')
    into v_ids
  from players vp join player_secrets vs on vs.player_id = vp.id
  where vp.room_id = v_room_id
    and vs.vote = p_player_id::text
    and not vp.dead and not vp.in_prison and not vp.in_hospital;

  return v_ids;
end;
$$;
grant execute on function my_voters(uuid) to anon, authenticated;

-- ============================================
-- Friend invite link (migration 046)
-- ============================================
-- Opening an invite link makes you friends with the inviter instantly
-- (SECURITY DEFINER, since RLS only lets the addressee accept a request).
create or replace function accept_friend_invite(p_inviter uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_inviter is null or p_inviter = v_me then
    return;
  end if;
  if not exists (select 1 from profiles where id = p_inviter) then
    return;
  end if;
  if exists (
    select 1 from friendships
    where (requester_id = v_me and addressee_id = p_inviter)
       or (requester_id = p_inviter and addressee_id = v_me)
  ) then
    update friendships
      set status = 'accepted'
    where status = 'pending'
      and ((requester_id = v_me and addressee_id = p_inviter)
        or (requester_id = p_inviter and addressee_id = v_me));
    return;
  end if;
  insert into friendships (requester_id, addressee_id, status)
  values (p_inviter, v_me, 'accepted');
end;
$$;

grant execute on function accept_friend_invite(uuid) to authenticated;

-- ============================================
-- Friends' active lobbies (migration 047)
-- ============================================
-- Open lobbies hosted by the logged-in user's accepted friends (incl.
-- private; excl. ones they're already in), for the start-screen surface.
create or replace function friends_active_lobbies()
returns table (
  room_id uuid,
  code text,
  host_user_id uuid,
  host_username text,
  player_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with my_friends as (
    select case
             when f.requester_id = auth.uid() then f.addressee_id
             else f.requester_id
           end as friend_id
    from friendships f
    where f.status = 'accepted'
      and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
  )
  select
    r.id,
    r.code,
    p.user_id,
    pr.username,
    (select count(*) from players p2 where p2.room_id = r.id),
    r.created_at
  from rooms r
  join players p on p.room_id = r.id and p.is_host
  join my_friends mf on mf.friend_id = p.user_id
  join profiles pr on pr.id = p.user_id
  where r.status = 'lobby'
    and not exists (
      select 1 from players me
      where me.room_id = r.id and me.user_id = auth.uid()
    )
  order by r.created_at desc;
$$;

grant execute on function friends_active_lobbies() to authenticated;

-- ============================================
-- Targeted game invites (migration 048)
-- ============================================
-- "Invite a friend to this game": a per room+recipient invite, surfaced on
-- the invitee's start screen. Writes go through send_game_invite() only.
create table if not exists game_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, to_user_id)
);

create index if not exists game_invites_to_idx on game_invites (to_user_id);

alter table game_invites enable row level security;

create policy "see own game invites" on game_invites
  for select using (to_user_id = auth.uid() or from_user_id = auth.uid());

create or replace function send_game_invite(p_room_id uuid, p_to_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_to_user_id is null or p_to_user_id = v_me then
    return;
  end if;
  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester_id = v_me and addressee_id = p_to_user_id)
        or (requester_id = p_to_user_id and addressee_id = v_me))
  ) then
    return;
  end if;
  if not exists (
    select 1 from players where room_id = p_room_id and user_id = v_me
  ) then
    return;
  end if;
  if not exists (
    select 1 from rooms where id = p_room_id and status = 'lobby'
  ) then
    return;
  end if;
  if exists (
    select 1 from players where room_id = p_room_id and user_id = p_to_user_id
  ) then
    return;
  end if;
  insert into game_invites (room_id, from_user_id, to_user_id)
  values (p_room_id, v_me, p_to_user_id)
  on conflict (room_id, to_user_id)
    do update set from_user_id = excluded.from_user_id, created_at = now();
end;
$$;

grant execute on function send_game_invite(uuid, uuid) to authenticated;

create or replace function my_game_invites()
returns table (
  room_id uuid,
  code text,
  from_user_id uuid,
  from_username text,
  player_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.code,
    gi.from_user_id,
    pr.username,
    (select count(*) from players p2 where p2.room_id = r.id),
    gi.created_at
  from game_invites gi
  join rooms r on r.id = gi.room_id
  join profiles pr on pr.id = gi.from_user_id
  where gi.to_user_id = auth.uid()
    and r.status = 'lobby'
    and not exists (
      select 1 from players me
      where me.room_id = r.id and me.user_id = auth.uid()
    )
  order by gi.created_at desc;
$$;

grant execute on function my_game_invites() to authenticated;

-- ============================================
-- Leave room + host hand-off (migration 049)
-- ============================================
-- Leaving the lobby; if the leaver is the host, the oldest remaining player
-- (the "second to join") is promoted to host first.
create or replace function leave_room(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_is_host boolean;
  v_next uuid;
begin
  select room_id, is_host into v_room, v_is_host
  from players where id = p_player_id;
  if v_room is null then
    return;
  end if;
  if v_is_host then
    select id into v_next
    from players
    where room_id = v_room and id <> p_player_id
    order by created_at asc
    limit 1;
    if v_next is not null then
      update players set is_host = true where id = v_next;
    end if;
  end if;
  delete from players where id = p_player_id;
end;
$$;

grant execute on function leave_room(uuid) to anon, authenticated;

-- ============================================
-- Account economy: currencies, account XP, Soul Shards, role unlocks
-- (migration 050) — meta-progression layer, batch 1a.
-- ============================================
-- Kept in tables SEPARATE from `profiles` so the client can't edit balances
-- directly (profiles has a self-update policy; these do NOT — only the
-- SECURITY DEFINER RPCs below write them). "Life Experience" (LE) is the
-- account currency for unlocking roles; the in-MATCH ability resource
-- (players.soul_energy) is the separate "Soul Energy" and is untouched.

create table account_economy (
  user_id uuid primary key references auth.users(id) on delete cascade,
  life_experience integer not null default 0,  -- LE: spent to unlock roles
  mano integer not null default 0,             -- spent on cosmetics (later batch)
  xp integer not null default 0,               -- account XP (level derived in TS)
  unopened_shards integer not null default 0,  -- Soul Shards earned, not yet opened
  last_daily_shard_date date,                  -- last day a daily-login shard was granted
  last_first_win_date date,                    -- last day a first-win shard was granted
  created_at timestamptz not null default now()
);

alter table account_economy enable row level security;

create policy "read own economy"
  on account_economy for select
  using (auth.uid() = user_id);

create table account_role_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table account_role_unlocks enable row level security;

create policy "read own role unlocks"
  on account_role_unlocks for select
  using (auth.uid() = user_id);

create table account_match_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

alter table account_match_rewards enable row level security;
-- No policies: written only by grant_match_rewards (SECURITY DEFINER).

-- Backfill existing accounts (no-op on a fresh schema run).
insert into account_economy (user_id)
  select id from profiles
  on conflict (user_id) do nothing;

-- Soul Shard: consume one + grant XP, then roll 0.1% role / 9% Mano / ~90.9%
-- LE. Keyed on auth.uid() so a client only opens its own shards.
create or replace function open_soul_shard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  v_roll numeric;
  v_kind text;
  v_amount int := 0;
  v_role text := null;
  v_locked text[];
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker',
    'wrath','love','gambling','determination',
    'fanaticism','generosity','pride','diligence'];
  c_default text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_xp constant int := 50;
  c_le constant int := 10;
  c_mano constant int := 10;
  c_odds_role constant numeric := 0.001;
  c_odds_mano constant numeric := 0.09;
begin
  if v_user is null then
    return jsonb_build_object('kind', 'none');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.unopened_shards <= 0 then
    return jsonb_build_object('kind', 'none');
  end if;

  v_roll := random();

  if v_roll < c_odds_role then
    select array_agg(r) into v_locked
    from unnest(c_all_roles) r
    where not (r = any(c_default))
      and not exists (
        select 1 from account_role_unlocks u
        where u.user_id = v_user and u.role = r
      );
    if v_locked is null or array_length(v_locked, 1) is null then
      v_kind := 'le'; v_amount := c_le;
    else
      v_role := v_locked[1 + floor(random() * array_length(v_locked, 1))::int];
      insert into account_role_unlocks (user_id, role) values (v_user, v_role)
        on conflict do nothing;
      v_kind := 'role';
    end if;
  elsif v_roll < c_odds_role + c_odds_mano then
    v_kind := 'mano'; v_amount := c_mano;
  else
    v_kind := 'le'; v_amount := c_le;
  end if;

  update account_economy set
    unopened_shards = unopened_shards - 1,
    xp = xp + c_xp,
    life_experience = life_experience + case when v_kind = 'le' then v_amount else 0 end,
    mano = mano + case when v_kind = 'mano' then v_amount else 0 end
  where user_id = v_user
  returning * into v_row;

  return jsonb_build_object(
    'kind', v_kind, 'amount', v_amount, 'role', v_role,
    'xp_gained', c_xp, 'le', v_row.life_experience, 'mano', v_row.mano,
    'xp', v_row.xp, 'unopened_shards', v_row.unopened_shards
  );
end;
$$;

grant execute on function open_soul_shard() to authenticated;

create or replace function claim_daily_login()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  v_granted boolean := false;
begin
  if v_user is null then
    return jsonb_build_object('granted', false, 'unopened_shards', 0);
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.last_daily_shard_date is null or v_row.last_daily_shard_date < current_date then
    update account_economy set
      unopened_shards = unopened_shards + 1,
      last_daily_shard_date = current_date
    where user_id = v_user
    returning * into v_row;
    v_granted := true;
  end if;

  return jsonb_build_object('granted', v_granted, 'unopened_shards', v_row.unopened_shards);
end;
$$;

grant execute on function claim_daily_login() to authenticated;

create or replace function unlock_role(p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker',
    'wrath','love','gambling','determination',
    'fanaticism','generosity','pride','diligence'];
  c_default text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_cost constant int := 1000;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if not (p_role = any(c_all_roles)) or (p_role = any(c_default)) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from account_role_unlocks where user_id = v_user and role = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.life_experience < c_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'le', v_row.life_experience);
  end if;

  update account_economy set life_experience = life_experience - c_cost where user_id = v_user
  returning * into v_row;
  insert into account_role_unlocks (user_id, role) values (v_user, p_role)
    on conflict do nothing;

  return jsonb_build_object('ok', true, 'role', p_role, 'le', v_row.life_experience);
end;
$$;

grant execute on function unlock_role(text) to authenticated;

-- Host-side, on game-over: per-match XP + first-win-of-the-day shard for every
-- account player. Idempotent per (user, room) via the ledger insert.
-- p_awards = [{ "u": <user_id uuid>, "won": <bool> }, ...]
create or replace function grant_match_rewards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_user uuid;
  v_won boolean;
  c_match_xp constant int := 30;
  c_win_bonus constant int := 20;
  c_le_win constant int := 20;
  c_le_loss constant int := 10;
begin
  for rec in select * from jsonb_array_elements(p_awards)
  loop
    v_user := (rec->>'u')::uuid;
    v_won := coalesce((rec->>'won')::boolean, false);
    if v_user is null then continue; end if;

    insert into account_match_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;

    if found then
      insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
      update account_economy set
        xp = xp + c_match_xp + case when v_won then c_win_bonus else 0 end,
        life_experience = life_experience + case when v_won then c_le_win else c_le_loss end,
        unopened_shards = unopened_shards + case
          when v_won and (last_first_win_date is null or last_first_win_date < current_date)
          then 1 else 0 end,
        last_first_win_date = case
          when v_won and (last_first_win_date is null or last_first_win_date < current_date)
          then current_date else last_first_win_date end
      where user_id = v_user;
    end if;
  end loop;
end;
$$;

grant execute on function grant_match_rewards(uuid, jsonb) to anon, authenticated;

-- ============================================
-- Ranked ladder (migration 051) — meta-progression layer, batch 2.
-- ============================================
-- Five tiers (Earthen < Verdant < Primal < Noble < Divine), three divisions
-- each (Division 1 highest), 100 points per division. Promotion needs a WIN
-- at 100; demotion a LOSS at 0 (no auto-move). Only apply_ranked_results
-- (SECURITY DEFINER) mutates account_ranked. (rooms.is_ranked is declared on
-- the rooms table above.)

create table account_ranked (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier_index integer not null default 0,        -- 0 Earthen .. 4 Divine
  division integer not null default 3,           -- 1 (top) .. 3 (bottom)
  points numeric not null default 0,             -- 0..100 within the division
  games integer not null default 0,
  wins integer not null default 0,
  created_at timestamptz not null default now()
);

alter table account_ranked enable row level security;

create policy "ranked readable by everyone"
  on account_ranked for select using (true);

create table account_ranked_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

alter table account_ranked_rewards enable row level security;
-- No policies: written only by apply_ranked_results (SECURITY DEFINER).

insert into account_ranked (user_id)
  select id from profiles
  on conflict (user_id) do nothing;

-- p_results = [{ "u": <user_id uuid>, "won": <bool>, "diff": <int >= 0> }, ...]
-- diff = |Vices remaining − Virtues remaining| at game end.
--   win -> +20 + 2.5*diff ; loss -> −(15 + 2.5*diff). Promote on a WIN at 100,
--   demote on a LOSS at 0.
create or replace function apply_ranked_results(p_room_id uuid, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_user uuid;
  v_won boolean;
  v_diff numeric;
  v_tier int;
  v_div int;
  v_pts numeric;
  c_win_base   constant numeric := 20;
  c_loss_base  constant numeric := 15;
  c_per_diff   constant numeric := 2.5;
  c_demote_pts constant numeric := 75;
begin
  for rec in select * from jsonb_array_elements(p_results)
  loop
    v_user := (rec->>'u')::uuid;
    v_won  := coalesce((rec->>'won')::boolean, false);
    v_diff := greatest(0, coalesce((rec->>'diff')::numeric, 0));
    if v_user is null then continue; end if;

    insert into account_ranked_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;
    if not found then continue; end if;

    insert into account_ranked (user_id) values (v_user) on conflict (user_id) do nothing;
    select tier_index, division, points into v_tier, v_div, v_pts
    from account_ranked where user_id = v_user for update;

    if v_won then
      if v_pts >= 100 then
        if v_div > 1 then
          v_div := v_div - 1; v_pts := 0;
        elsif v_tier < 4 then
          v_tier := v_tier + 1; v_div := 3; v_pts := 0;
        else
          v_pts := 100;
        end if;
      else
        v_pts := least(100, v_pts + c_win_base + c_per_diff * v_diff);
      end if;
    else
      if v_pts <= 0 then
        if v_div < 3 then
          v_div := v_div + 1; v_pts := c_demote_pts;
        elsif v_tier > 0 then
          v_tier := v_tier - 1; v_div := 1; v_pts := c_demote_pts;
        else
          v_pts := 0;
        end if;
      else
        v_pts := greatest(0, v_pts - c_loss_base - c_per_diff * v_diff);
      end if;
    end if;

    update account_ranked set
      tier_index = v_tier, division = v_div, points = v_pts,
      games = games + 1, wins = wins + case when v_won then 1 else 0 end
    where user_id = v_user;
  end loop;
end;
$$;

grant execute on function apply_ranked_results(uuid, jsonb) to anon, authenticated;

-- ============================================
-- Ranked role loadout (migration 052) — meta-progression layer, batch 3a.
-- ============================================
-- Per-account preferred role per side (Vice/Virtue) per role tier (S/A/B/C/D),
-- consumed by ranked role assignment (a later batch). The player edits this
-- freely, so it uses normal per-user RLS (no SECURITY DEFINER needed).
create table account_role_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,   -- { vice: {S,A,B,C,D -> role id}, virtue: {...} }
  created_at timestamptz not null default now()
);

alter table account_role_config enable row level security;

create policy "read own role config"
  on account_role_config for select using (auth.uid() = user_id);
create policy "insert own role config"
  on account_role_config for insert with check (auth.uid() = user_id);
create policy "update own role config"
  on account_role_config for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- Ranked matchmaking queue (migration 053) — meta-progression layer, batch 3b.
-- ============================================
-- Single queue with modes ('3v3' / '5v5'): join with a mode only (migration
-- 063 removed the side pick — camps are dealt at match formation, then players
-- choose their role live in the role_select phase). Read-own RLS.
create table ranked_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default '3v3',         -- '3v3' (6 players) | '5v5' (10)
  side text,                                -- legacy (pre-063 side pick); unused
  name text not null,
  status text not null default 'waiting',   -- 'waiting' | 'matched'
  room_code text,
  joined_at timestamptz not null default now()
);

alter table ranked_queue enable row level security;

create policy "read own queue row"
  on ranked_queue for select using (auth.uid() = user_id);

create or replace function join_ranked_queue(p_mode text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  if p_mode not in ('3v3', '5v5') then return; end if;
  insert into ranked_queue (user_id, mode, side, name, status, room_code, joined_at)
  values (v_user, p_mode, null, coalesce(nullif(btrim(p_name), ''), 'Player'),
          'waiting', null, now())
  on conflict (user_id) do update
    set mode = excluded.mode, side = null, name = excluded.name,
        status = 'waiting', room_code = null, joined_at = now();
end; $$;
grant execute on function join_ranked_queue(text, text) to authenticated;

create or replace function leave_ranked_queue()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from ranked_queue where user_id = auth.uid();
end; $$;
grant execute on function leave_ranked_queue() to authenticated;

create or replace function ranked_queue_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    '3v3', count(*) filter (where mode = '3v3' and status = 'waiting'),
    '5v5', count(*) filter (where mode = '5v5' and status = 'waiting')
  ) from ranked_queue;
$$;
grant execute on function ranked_queue_counts() to authenticated;

-- Role -> role tier (S/A/B/C/D), mirroring roles.ts.
create or replace function vv_role_tier(p_role text)
returns text language sql immutable as $$
  select case p_role
    when 'murder' then 'S'        when 'empathy' then 'S'
    when 'intoxication' then 'A'  when 'justice' then 'A'
    when 'envy' then 'B'          when 'certainty' then 'B'
    when 'torment' then 'C'       when 'vengeance' then 'C'
    when 'truthfulness' then 'C'  when 'sacrifice' then 'C'
    when 'vice_worshipper' then 'D' when 'virtue_seeker' then 'D'
    else null end;
$$;

-- Assign the camp role multiset to its players (aligned to p_users), honoring
-- each player's loadout: greedy over players (caller shuffles, so tier is
-- random), each takes the available role they prefer (highest tier first),
-- else a random remaining role.
create or replace function assign_camp_roles(p_users uuid[], p_camp text, p_roles text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_n int := coalesce(array_length(p_users, 1), 0);
  v_remaining text[] := p_roles;
  v_assign text[] := '{}';
  v_i int; v_j int; v_len int;
  v_loadout jsonb;
  v_best int; v_best_rank int; v_cand_rank int;
  v_role text; v_tier text;
begin
  for v_i in 1..v_n loop
    select config -> p_camp into v_loadout
    from account_role_config where user_id = p_users[v_i];

    v_len := array_length(v_remaining, 1);
    v_best := null; v_best_rank := 99;
    for v_j in 1..v_len loop
      v_role := v_remaining[v_j];
      v_tier := vv_role_tier(v_role);
      if v_loadout is not null and (v_loadout ->> v_tier) = v_role then
        v_cand_rank := case v_tier
          when 'S' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end;
        if v_cand_rank < v_best_rank then
          v_best := v_j; v_best_rank := v_cand_rank;
        end if;
      end if;
    end loop;

    if v_best is null then
      v_best := 1 + floor(random() * v_len)::int;
    end if;

    v_assign := array_append(v_assign, v_remaining[v_best]);
    v_remaining := v_remaining[1:v_best - 1] || v_remaining[v_best + 1:v_len];
  end loop;
  return v_assign;
end; $$;

-- Form a match for a mode of p_n per side, if 2N players are waiting (no side
-- pick — migration 063). Takes the 2N longest-waiting players of the mode,
-- randomly splits them into camps, deals each camp the tier list S,A,B(,C,D)
-- shuffled, and opens the room in the role_select phase (30s): roles stay NULL
-- until the players pick them. Assumes the caller holds the advisory lock.
create or replace function ranked_form_match(p_mode text, p_n int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_users uuid[];
  v_tiers text[] := (array['S','A','B','C','D'])[1:p_n];
  v_vice_tiers text[]; v_virtue_tiers text[];
  v_code text; v_room_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_i int; v_name text; v_player_id uuid; v_user uuid;
begin
  select array_agg(user_id order by random()) into v_users
  from (select user_id from ranked_queue
        where status = 'waiting' and mode = p_mode
        order by joined_at limit 2 * p_n) q;

  if coalesce(array_length(v_users, 1), 0) < 2 * p_n then return null; end if;

  select array_agg(t order by random()) into v_vice_tiers from unnest(v_tiers) t;
  select array_agg(t order by random()) into v_virtue_tiers from unnest(v_tiers) t;

  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, phase_ends_at,
                         role_assign_mode, eye_uses_left, free_uses_left)
      values (v_code, false, true, 'in_game', 'role_select',
              now() + interval '30 seconds', 'choose', 1, 1)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  for v_i in 1..(2 * p_n) loop
    v_user := v_users[v_i];
    select name into v_name from ranked_queue where user_id = v_user;
    insert into players (room_id, user_id, name, is_host)
    values (v_room_id, v_user, v_name, v_i = 1)
    returning id into v_player_id;
    insert into player_secrets (player_id, role, assigned_camp, assigned_tier)
    values (v_player_id, null,
            case when v_i <= p_n then 'vice' else 'virtue' end,
            case when v_i <= p_n then v_vice_tiers[v_i] else v_virtue_tiers[v_i - p_n] end);
    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_users);

  return v_code;
end; $$;

-- Try to form a match (5v5 first, then 3v3); advisory-locked so it runs once
-- at a time. Returns the new room code or null.
create or replace function ranked_matchmake()
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform pg_advisory_xact_lock(778899);
  v := ranked_form_match('5v5', 5);
  if v is not null then return v; end if;
  return ranked_form_match('3v3', 3);
end; $$;
grant execute on function ranked_matchmake() to authenticated;

-- ============================================
-- Live role selection (migration 063)
-- ============================================
-- The role_select phase: each player picks a role within their dealt camp +
-- tier. Tentative pick (p_lock=false) or final lock (p_lock=true). Validated
-- against the playable role set (collection-only roles can't be picked).
create or replace function select_role(p_player_id uuid, p_role text, p_lock boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_tier text; v_locked boolean;
  c_playable text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker'];
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_tier, (s.role is not null)
    into v_room, v_phase, v_camp, v_tier, v_locked
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_locked then
    return false;
  end if;
  if not (p_role = any(c_playable))
     or vv_role_camp(p_role) is distinct from v_camp
     or vv_role_tier(p_role) is distinct from v_tier then
    return false;
  end if;

  update player_secrets
  set role_choice = p_role,
      role = case when p_lock then p_role else role end
  where player_id = p_player_id;
  return true;
end;
$$;
grant execute on function select_role(uuid, text, boolean) to anon, authenticated;

-- The caller's camp's selection state, ANONYMOUS by tier (no names/ids), so
-- the team can coordinate composition without learning who their camp-mates
-- are. Only returns data during the role_select phase.
create or replace function team_selections(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_tier text; v_choice text; v_locked boolean;
  v_team jsonb;
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_tier, s.role_choice, (s.role is not null)
    into v_room, v_phase, v_camp, v_tier, v_choice, v_locked
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_camp is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tier', t.assigned_tier, 'choice', t.role_choice,
           'locked', t.locked, 'me', t.me)
           order by t.rank, t.created_at), '[]'::jsonb)
    into v_team
  from (
    select s.assigned_tier, s.role_choice, (s.role is not null) as locked,
           (p.id = p_player_id) as me, p.created_at,
           case s.assigned_tier when 'S' then 0 when 'A' then 1
                when 'B' then 2 when 'C' then 3 else 4 end as rank
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = v_room and s.assigned_camp = v_camp
  ) t;

  return jsonb_build_object(
    'camp', v_camp, 'tier', v_tier, 'choice', v_choice, 'locked', v_locked,
    'team', v_team);
end;
$$;
grant execute on function team_selections(uuid) to anon, authenticated;

-- Whether every player in the room has locked a role (host early-advance).
create or replace function roles_select_ready(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from players where room_id = p_room_id)
     and not exists (
       select 1 from players p join player_secrets s on s.player_id = p.id
       where p.room_id = p_room_id and s.role is null);
$$;
grant execute on function roles_select_ready(uuid) to anon, authenticated;

-- Ends the role_select phase: stragglers get their tentative pick, else a
-- random playable role of their dealt camp+tier; publishes role_pool; moves to
-- role_overview. Idempotent (only acts while the room is in role_select).
create or replace function resolve_role_select(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_role text;
  r record;
  c_playable text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker'];
begin
  select phase into v_phase from rooms where id = p_room_id;
  if v_phase is distinct from 'role_select' then return; end if;

  for r in
    select p.id, s.assigned_camp, s.assigned_tier, s.role_choice
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is null
  loop
    v_role := r.role_choice;
    if v_role is null then
      select x into v_role from unnest(c_playable) x
      where vv_role_camp(x) = r.assigned_camp and vv_role_tier(x) = r.assigned_tier
      order by random() limit 1;
    end if;
    if v_role is null then
      v_role := case when r.assigned_camp = 'virtue'
                     then 'virtue_seeker' else 'vice_worshipper' end;
    end if;
    update player_secrets set role = v_role, role_choice = v_role
    where player_id = r.id;
  end loop;

  update rooms set role_pool = (
    select jsonb_agg(distinct s.role)
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is not null
  ) where id = p_room_id;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'role_overview', phase_ends_at = null
  where id = p_room_id;
end;
$$;
grant execute on function resolve_role_select(uuid) to anon, authenticated;
