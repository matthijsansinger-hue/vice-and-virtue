-- ============================================
-- Vice and Virtue - database schema
-- MVP step 1: the lobby (rooms + players)
-- Run this in the Supabase SQL Editor.
-- ============================================
--
-- ⚠️ READ BEFORE WRITING A MIGRATION THAT TOUCHES A GATED FUNCTION ⚠️
--
-- Migrations 097 (host gate) and 098 (caller gate) split 46 security-sensitive
-- RPCs into two halves:
--
--     <name>_impl(...)   the real body. Internal. Revoked from PUBLIC.
--     <name>(...)        a thin wrapper that checks vv_is_host / vv_is_me and
--                        delegates. This is the only half clients may call.
--
-- To change the LOGIC of one of those functions, write to the **_impl** name.
-- Writing `create or replace function <name>(...)` with a full body REPLACES
-- THE GATE with your body and silently removes the security check. That has
-- already happened once: migration 111 did it to enter_store, buy_potion and
-- my_potions, and shipped to production ungated until migration 112 repaired
-- them. It passes review easily because the function still "works".
--
-- Also note revoking must include PUBLIC — `revoke ... from anon, authenticated`
-- leaves Postgres's default EXECUTE-to-PUBLIC grant in place, which left every
-- _impl callable by anonymous clients until migration 112. Use the form below:
--     revoke all on function X(...) from public, anon, authenticated;
--
-- Verification queries live at the bottom of db/112_host_gate_repair.sql.
--
-- And per PROJECT.md: this file is a MIRROR, not the source of truth. It has
-- been stale before. Probe the live database before trusting anything here.
-- ============================================

-- Rooms: one row per game lobby
create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'lobby',          -- lobby | in_game | ended
  is_public boolean not null default false,       -- discoverable via "Find Public Session" matchmaking (private = code-only)
  is_ranked boolean not null default false,       -- ranked game: ladder points apply at game end (migration 051)
  phase text not null default 'lobby',            -- lobby | game_overview | role_select | role_overview | lore_intro | wandering_soul_intro | role_reveal | role_action | murder_succession | event_summary | minigame | result | outreach | store | store_summary | group_action | consultation | new_day | vice_victory_intro | virtue_victory_intro | soul_victory_intro | game_over
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
  role_assign_mode text not null default 'choose',-- 'choose' (live role_select; skips role_reveal; lobby default since 064) | 'random' (secret deal + role_reveal)
  role_config jsonb,                              -- host per-tier role config for random mode (migration 064; validated by vv_config_slot)
  pride_target text,                              -- SECRET: player Pride blocked from scoring this minigame (migration 066); cleared each new day
  love_tiebreak text,                             -- SECRET: Love who armed the imprisonment tie-break this day (migration 067); cleared each new day
  bombs jsonb not null default '[]'::jsonb,       -- SECRET: Fanaticism's live bombs [{id,holder,since,pass_to}] (migration 068); never sent to clients
  bombs_planted integer not null default 0,       -- lifetime count of bombs Fanaticism has planted (cap 2; migration 068)
  kill_log jsonb not null default '[]'::jsonb,    -- SECRET during play: [{killer,victim,day}] for the game-over "who killed who" overview (migration 074); read only via get_kill_log once status='ended'
  winner text,                                    -- 'neutral' when the Wandering Soul escaped (migration 094); camp wins stay null (GameOver recomputes those)
  minigame_awarded_day integer,                   -- day whose minigame Soul Energy awards were paid; apply_minigame_awards pays once per day (migration 120)
  bots_acted_key text,
  server_hosted boolean not null default false, -- queue game run by the server's phase machine, no player host (migration 126)
  phase_started_at timestamptz default now(),     -- stamped by vv_stamp_phase_start on every phase/day change (migration 126)
  server_phase_key text,                          -- vv_tick_room: the phase/day/re-vote it last did entry work for (126)
  server_substate text,                           -- vv_tick_room sub-state; 'voted' = consultation result screen (126)                            -- run_bots idempotency: 'phase:day:revote-hash' it last acted on (migration 124)

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
  user_id uuid references auth.users(id) on delete set null,  -- ACCOUNT this row belongs to, NULL for guests
  -- SESSION identity (account OR anonymous), defaulting to the caller. This is
  -- what vv_is_me / vv_is_host check. Kept separate from user_id because the
  -- app reads "user_id is not null" as "logged-in account" (stats, rewards,
  -- badges, level star, invite button) — a guest must never get one.
  -- Migration 106.
  auth_uid uuid default auth.uid(),
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
  release_pool numeric not null default 0,        -- communal SE toward this prisoner's release (migration 092); resets to 0 on free
  acted_this_day boolean not null default false,  -- used role ability this day
  murder_kills integer not null default 0,        -- per-game kills landed while holding Murder (for badges)
  muted boolean not null default false,           -- silenced by moderation (auto-mute after repeated reports)
  is_bot boolean not null default false,          -- a server-played bot filling a public queue seat (migration 124); no account, never chats
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
  payload jsonb,                 -- premade sentence {s, about, role} (129, 132); null for free text
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
  avatar_url text,                               -- DEPRECATED (migration 091): old uploaded-photo URL, dormant
  appearance jsonb,                              -- customizable layered avatar config (migration 091), or null = not made yet ("character" is a reserved word)
  featured_badges text[] not null default '{}',  -- up to 2 badge ids shown next to your name
  name_color text,                               -- equipped name-color tier id (migration 080), or null = default
  banner_color text,                             -- equipped banner-color tier id (migration 080), or null = default
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
  -- Anonymous sessions (guests) carry no username — they get no profile /
  -- economy / ranked rows (account features). Without this guard the profiles
  -- insert violates NOT NULL and anonymous sign-in itself fails ("Database
  -- error creating anonymous user"), silently downgrading every guest to a
  -- session-less browser that the 096-099 caller gates reject. (Migration 106.)
  if new.raw_user_meta_data ->> 'username' is null then
    return new;
  end if;
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

-- ...but only the host may WRITE a room (migration 103): every legitimate client
-- write to rooms comes from the host's phase machine / lobby controls. The lone
-- exception (any participant claiming the re-queue slot) goes through the
-- claim_requeue SECURITY DEFINER RPC, which — like every resolver / matchmaking /
-- cleanup function — runs as the owner and so bypasses this guard.
-- vv_is_host (migration 096) is the host predicate keyed on auth.uid().
-- Matches EITHER identity column (migration 106): auth_uid for a normal client
-- insert (guest or account), user_id for a ranked seat that ranked_form_match
-- created on the player's behalf (its auth_uid holds the matchmaker's id) and
-- for any row written before 106.
create or replace function vv_is_host(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('vv.server_tick', true), '') = 'on'
      or exists (
        select 1 from players
        where room_id = p_room_id and is_host and auth.uid() is not null
          and (auth_uid = auth.uid() or user_id = auth.uid())
      );
$$;

-- "Is the caller this player?" — same two-column match as vv_is_host.
create or replace function vv_is_me(p_player_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from players
    where id = p_player_id and auth.uid() is not null
      and (auth_uid = auth.uid() or user_id = auth.uid())
  );
$$;

create or replace function vv_guard_room_writes()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') and not vv_is_host(new.id) then
    raise exception 'only the host can modify the room' using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists vv_guard_room_writes_trg on rooms;
create trigger vv_guard_room_writes_trg
  before update on rooms
  for each row execute function vv_guard_room_writes();

create policy "open access to players" on players
  for all using (true) with check (true);

-- ...but the crown-jewel columns are write-guarded (migration 102): a direct
-- client UPDATE may not change soul_energy / dead / in_prison / murder_kills /
-- is_host / muted. SECURITY DEFINER RPCs (resolve_* / buy_* / reveal_* /
-- apply_minigame_awards, etc.) run as the owner, not anon/authenticated, so their
-- legitimate writes pass. (Pacing columns — ready / acted_this_day / in_hospital /
-- minigame_* — stay client-writable until the phase machine moves server-side.)
create or replace function vv_guard_player_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.soul_energy  is distinct from old.soul_energy
    or new.dead         is distinct from old.dead
    or new.in_prison    is distinct from old.in_prison
    or new.murder_kills is distinct from old.murder_kills
    or new.is_host      is distinct from old.is_host
    or new.muted        is distinct from old.muted then
      raise exception 'cannot modify protected player columns' using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists vv_guard_player_columns_trg on players;
create trigger vv_guard_player_columns_trg
  before update on players
  for each row execute function vv_guard_player_columns();

-- Chat tables are scoped-read + RPC-only-write (migration 101). Sends go through
-- the caller-gated SECURITY DEFINER RPCs send_dm / send_dead_message /
-- send_consultation_message (defined in db/101_chat_lock.sql); there is no client
-- write policy, so only those RPCs can insert. (messages = dead camp-chat table.)
create policy "camp chat readable in room" on messages
  for select using (
    exists (select 1 from players p
            where p.room_id = messages.room_id and p.user_id = auth.uid())
  );

create policy "dm readable by participants or dead spectators" on dm_messages
  for select using (
    exists (select 1 from players p
            where p.user_id = auth.uid()
              and (p.id = dm_messages.sender_id or p.id = dm_messages.recipient_id))
    or exists (select 1 from players p
               where p.room_id = dm_messages.room_id and p.user_id = auth.uid() and p.dead)
  );

create policy "consultation chat readable in room" on consultation_messages
  for select using (
    exists (select 1 from players p
            where p.room_id = consultation_messages.room_id and p.user_id = auth.uid())
  );

create policy "dead chat readable by the dead" on dead_messages
  for select using (
    exists (select 1 from players p
            where p.room_id = dead_messages.room_id and p.user_id = auth.uid() and p.dead)
  );

-- Profiles use proper restrictive policies (they hold personal data,
-- unlike the open MVP game tables above).
alter table profiles enable row level security;
alter table game_results enable row level security;
alter table user_achievements enable row level security;
alter table friendships enable row level security;

create policy "profiles are readable by everyone"
  on profiles for select using (true);

-- World-readable (public profiles / leaderboard / friends games-together), but
-- write-locked: rows are written only by the host-gated SECURITY DEFINER RPC
-- record_game_results (db/100_game_results_lock.sql). No client write policy.
create policy "game_results are world-readable" on game_results
  for select using (true);

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
-- ...but revoked from clients (migration 104): only SECURITY DEFINER resolvers
-- (running as owner) may grant badges to others; self-badges use insert-your-own.
-- Host-only, called by resolvers running as owner. Must revoke from PUBLIC too:
-- revoking only anon/authenticated leaves the default PUBLIC grant (migration 112).
revoke all on function grant_achievements(jsonb) from public, anon, authenticated;

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

-- Realtime: let the app subscribe to live changes (chat messages appear, etc.).
-- rooms + players are deliberately NOT published (migration 121): per-row
-- Postgres Changes fanned out N rows x N phones and leaked the secret room
-- columns. They send a one-per-statement "room changed" broadcast nudge instead
-- (see "Room change nudges" below).
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table dm_messages;
alter publication supabase_realtime add table consultation_messages;
alter publication supabase_realtime add table dead_messages;
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table friendships;

-- ============================================
-- Room change nudges (migration 121)
-- ============================================
-- One tiny Broadcast-from-Database message per affected room per SQL statement
-- on the public topic 'room:<id>' (payload: just the room id). The room page
-- re-pulls public columns on receipt. Never raises: a failed nudge must not
-- break a game write — clients fall back to their safety-net poll.
create or replace function vv_broadcast_room_changed(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('room_id', p_room_id),
    'changed',
    'room:' || p_room_id::text,
    false
  );
exception when others then
  null;
end;
$$;
revoke all on function vv_broadcast_room_changed(uuid) from public, anon, authenticated;

create or replace function vv_players_changed_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid;
begin
  for v_room in
    select distinct room_id from changed_rows where room_id is not null
  loop
    perform vv_broadcast_room_changed(v_room);
  end loop;
  return null;
end;
$$;
revoke all on function vv_players_changed_stmt() from public, anon, authenticated;

create trigger vv_players_nudge_ins
  after insert on players
  referencing new table as changed_rows
  for each statement execute function vv_players_changed_stmt();
create trigger vv_players_nudge_upd
  after update on players
  referencing new table as changed_rows
  for each statement execute function vv_players_changed_stmt();
create trigger vv_players_nudge_del
  after delete on players
  referencing old table as changed_rows
  for each statement execute function vv_players_changed_stmt();

create or replace function vv_rooms_changed_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform vv_broadcast_room_changed(old.id);
  else
    perform vv_broadcast_room_changed(new.id);
  end if;
  return null;
end;
$$;
revoke all on function vv_rooms_changed_row() from public, anon, authenticated;

create trigger vv_rooms_nudge
  after update or delete on rooms
  for each row execute function vv_rooms_changed_row();

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
      ('murder','intoxication','envy','torment','vengeance','vice_worshipper',
       'wrath','gambling','fanaticism','pride','greed')
      then 'vice'
    when p_role in
      ('empathy','justice','truthfulness','certainty','sacrifice','virtue_seeker',
       'love','determination','generosity','diligence','sociability')
      then 'virtue'
    when p_role in ('wandering_soul','game_master') then 'neutral'
    else null
  end;
$$;

create or replace function vv_role_class(p_role text)
returns text
language sql
immutable
as $$
  select case p_role
    when 'murder' then 'exterminator'
    when 'fanaticism' then 'exterminator'
    when 'vengeance' then 'exterminator'
    when 'torment' then 'troublemaker'
    when 'gambling' then 'troublemaker'
    when 'intoxication' then 'obstructor'
    when 'pride' then 'obstructor'
    when 'greed' then 'obstructor'
    when 'wrath' then 'manipulator'
    when 'envy' then 'manipulator'
    when 'generosity' then 'protector'
    when 'determination' then 'protector'
    when 'truthfulness' then 'communicator'
    when 'sociability' then 'communicator'
    when 'empathy' then 'seeker'
    when 'certainty' then 'seeker'
    when 'diligence' then 'seeker'
    when 'love' then 'catalyst'
    when 'sacrifice' then 'catalyst'
    when 'justice' then 'catalyst'
    else null   -- vice_worshipper / virtue_seeker (fillers), wandering_soul
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
  potion_iron_will boolean not null default false,  -- Iron Will (migration 075): this consultation's imprisonment vote counts double; buyable from round 2 onwards; cleared after the vote
  -- Live role selection (migration 063): the camp + tier dealt to this player
  -- when the room uses role_assign_mode='choose', and their tentative pick
  -- (visible to camp-mates anonymously) until `role` is locked in.
  assigned_camp text,
  assigned_tier text,
  role_choice text,
  -- Extra lives (migration 066): a stored buffer that absorbs a would-be kill
  -- or hospitalisation (Determination buys, Generosity grants, Wrath earns).
  extra_lives integer not null default 0,
  minigame_correct integer,                        -- correct V/V tags this round (for Diligence's paid count, migration 066)
  minigame_no_score boolean not null default false, -- Gambling roll of 2 (migration 078): score nothing in this round's minigame; cleared on submit
  follower_of uuid,                                -- the Wrath this player was corrupted by + bound to (migration 067)
  -- Wandering Soul anomaly (migration 094): the 100 SE ward's imprisonment block,
  -- and the Soul's pending escape guess ({playerId: 'vice'|'virtue'}).
  potion_soul_protect boolean not null default false,
  soul_escape_guess jsonb,
  -- The Quiz choice (migration 122): {day, choice: points|hint|peek, points,
  -- dazzled, hint: {kind: opposite|at_least, camp?, a, b}, peek: {target, camp},
  -- awarded?, doubled?}. Written by submit_quiz_choice; paid by apply_quiz_awards.
  quiz jsonb,
  -- A bot's private knowledge (migration 125): {known: {id: camp}, hints: [...],
  -- sus: {id: score}}. Only the bot's own discoveries; revoked from clients.
  bot_memory jsonb not null default '{}'::jsonb
);

alter table player_secrets enable row level security;

-- Private per-player notices (e.g. Worshipper/Seeker/Pride revealing themselves)
-- — migration 056. Locked: written by reveal_self / pride_reveal, read via
-- get_my_secrets; not in realtime. The client remembers dismissals locally.
create table if not exists player_notices (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  recipient_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
alter table player_notices enable row level security;
create index if not exists player_notices_recipient_idx on player_notices (recipient_id);

-- player_secrets rows are created by assign_roles_and_start (game start)
-- and written only by the SECURITY DEFINER RPCs below (submit_vote,
-- queue_action, clear_room_votes, and the resolution functions). There is
-- no mirror trigger — the players.* secret columns were dropped (migration
-- 036), so nothing writes secrets to the players table.

-- Server-side minigame scoring (ports computeScore from Minigame.tsx):
-- +1 correct, +0.4 unknown/untagged, any explicit wrong tag => 0. The
-- client sends only its guesses; real roles never leave the database.
-- Migration 066: Diligence is immune to the wrong-tag zero (a wrong tag just
-- scores 0 for that row, the rest still count); a player Pride blocked this
-- round (rooms.pride_target) scores nothing at all.
create or replace function submit_minigame_guesses_impl(
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
  v_correct int := 0;
  v_target record;
  v_guess text;
  v_truth text;
  v_role text;
  v_pride text;
  v_diligent boolean;
  v_no_score boolean;
begin
  select p.room_id, s.role, r.pride_target, coalesce(s.minigame_no_score, false)
    into v_room_id, v_role, v_pride, v_no_score
  from players p
    join rooms r on r.id = p.room_id
    left join player_secrets s on s.player_id = p.id
  where p.id = p_player_id and not p.dead and not p.in_prison and not p.in_hospital;
  if v_room_id is null then
    return 0;
  end if;

  -- Pride dazzled this player, or Gambling rolled a 2 (migration 078): score
  -- nothing this round. The Gambling flag is cleared as it's consumed.
  if (v_pride is not null and v_pride = p_player_id::text) or v_no_score then
    update players set minigame_score = 0, minigame_submitted_at = now(), ready = true
    where id = p_player_id;
    update player_secrets set minigame_guesses = p_guesses, minigame_correct = 0,
      minigame_no_score = false
    where player_id = p_player_id;
    return 0;
  end if;

  v_diligent := (v_role = 'diligence');

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
      v_correct := v_correct + 1;
    elsif v_diligent then
      -- Diligence: a wrong tag scores 0 for this row but doesn't zero the round.
      null;
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

  -- minigame_correct is meaningful for Diligence (whose loop never exits early);
  -- for others it's the count up to their first wrong tag, which they never read.
  update player_secrets set minigame_guesses = p_guesses, minigame_correct = v_correct
  where player_id = p_player_id;

  return v_score;
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function submit_minigame_guesses_impl(uuid, jsonb) from public, anon, authenticated;

create or replace function submit_minigame_guesses(p_player_id uuid, p_guesses jsonb default '{}'::jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return submit_minigame_guesses_impl(p_player_id, p_guesses);
end; $$;
grant execute on function submit_minigame_guesses(uuid, jsonb) to anon, authenticated;

-- ============================================
-- New-role abilities, batch 1 (migration 066)
-- ============================================
-- Determination: buy a stackable extra life (100 SE each, repeatable). Acts in
-- role-action; not gated on acted_this_day so you can stack within the window.
create or replace function buy_extra_life_impl(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_lives int;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'determination'
     or v_dead or v_prison or v_hosp or v_se < 125 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 125, acted_this_day = true
  where id = p_player_id;
  update player_secrets set extra_lives = extra_lives + 1
  where player_id = p_player_id returning extra_lives into v_lives;
  return jsonb_build_object('ok', true, 'extra_lives', v_lives);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function buy_extra_life_impl(uuid) from public, anon, authenticated;

create or replace function buy_extra_life(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return buy_extra_life_impl(p_player_id);
end; $$;
grant execute on function buy_extra_life(uuid) to anon, authenticated;

-- Generosity: gift another player 100 Soul Energy (cost 100). One ability/day.
create or replace function gift_soul_energy_impl(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'generosity' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 or p_target_id = p_player_id
     or not exists (select 1 from players where id = p_target_id and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  update players set soul_energy = soul_energy + 100 where id = p_target_id;
  return jsonb_build_object('ok', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function gift_soul_energy_impl(uuid, uuid) from public, anon, authenticated;

create or replace function gift_soul_energy(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return gift_soul_energy_impl(p_player_id, p_target_id);
end; $$;
grant execute on function gift_soul_energy(uuid, uuid) to anon, authenticated;

-- Generosity: grant a player a lasting extra life (cost 200). One ability/day.
create or replace function grant_extra_life_impl(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'generosity' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 200
     or not exists (select 1 from players where id = p_target_id and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 200, acted_this_day = true where id = p_player_id;
  update player_secrets set extra_lives = extra_lives + 1 where player_id = p_target_id;
  return jsonb_build_object('ok', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function grant_extra_life_impl(uuid, uuid) from public, anon, authenticated;

create or replace function grant_extra_life(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return grant_extra_life_impl(p_player_id, p_target_id);
end; $$;
grant execute on function grant_extra_life(uuid, uuid) to anon, authenticated;

-- Gambling (migration 078): roll one die (cost 100) and the FACE decides the
-- ability — 1 hospitalise yourself, 2 score nothing in this minigame, 3 double
-- your minigame Soul Energy (reuses the Minigame x2 flag), 4 hospitalise a
-- chosen target, 5 gain a lasting extra life, 6 kill a chosen target. SE is
-- charged whatever the face. Faces 1/4/6 flow through the normal role-action
-- resolution (queued as intox/kill, so Justice protect + extra lives apply);
-- faces 4 and 6 park a 'gamble_pick_*' sentinel and the target is chosen after
-- the roll via gambling_pick_target. One roll/day.
create or replace function gambling_roll_impl(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_roll int;
  v_kind text; v_needs boolean := false;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'gambling' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;

  v_roll := 1 + floor(random() * 6)::int;
  update players set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  if v_roll = 1 then
    -- Hospitalise yourself: queue like an intox so protect + extra lives apply.
    v_kind := 'self_hospital';
    update player_secrets set pending_action = 'intox', pending_target = p_player_id::text
    where player_id = p_player_id;
  elsif v_roll = 2 then
    v_kind := 'no_minigame';
    update player_secrets set minigame_no_score = true where player_id = p_player_id;
  elsif v_roll = 3 then
    v_kind := 'minigame_mult';
    update player_secrets set potion_minigame_mult = true where player_id = p_player_id;
  elsif v_roll = 4 then
    -- Hospitalise a chosen target: park a sentinel; gambling_pick_target arms it.
    v_kind := 'hospital'; v_needs := true;
    update player_secrets set pending_action = 'gamble_pick_hosp', pending_target = null
    where player_id = p_player_id;
  elsif v_roll = 5 then
    v_kind := 'extra_life';
    update player_secrets set extra_lives = extra_lives + 1 where player_id = p_player_id;
  else
    -- Kill a chosen target.
    v_kind := 'kill'; v_needs := true;
    update player_secrets set pending_action = 'gamble_pick_kill', pending_target = null
    where player_id = p_player_id;
  end if;

  return jsonb_build_object('ok', true, 'roll', v_roll, 'kind', v_kind, 'needs_target', v_needs);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function gambling_roll_impl(uuid) from public, anon, authenticated;

create or replace function gambling_roll(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return gambling_roll_impl(p_player_id);
end; $$;
grant execute on function gambling_roll(uuid) to anon, authenticated;

-- Gambling (migration 078): after a roll of 4 or 6, choose who to hospitalise /
-- kill. Converts the 'gamble_pick_*' sentinel into the real queued action
-- (resolved like any intox/kill). No extra SE — the roll already charged it. An
-- unpicked sentinel simply resolves to nothing (the SE is still spent).
create or replace function gambling_pick_target_impl(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_role text; v_pending text; v_act text;
begin
  select p.room_id, r.phase, s.role, s.pending_action
    into v_room, v_phase, v_role, v_pending
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'gambling'
     or (v_pending is distinct from 'gamble_pick_hosp' and v_pending is distinct from 'gamble_pick_kill')
     or p_target_id = p_player_id
     or not exists (select 1 from players where id = p_target_id and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false);
  end if;
  v_act := case when v_pending = 'gamble_pick_kill' then 'kill' else 'intox' end;
  update player_secrets set pending_action = v_act, pending_target = p_target_id::text
  where player_id = p_player_id;
  return jsonb_build_object('ok', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function gambling_pick_target_impl(uuid, uuid) from public, anon, authenticated;

create or replace function gambling_pick_target(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return gambling_pick_target_impl(p_player_id, p_target_id);
end; $$;
grant execute on function gambling_pick_target(uuid, uuid) to anon, authenticated;

-- Pride: reveal yourself to a random active player and block them from scoring
-- this round's minigame (cost 50, migration 078). One use/day. Returns who you
-- revealed to.
create or replace function pride_reveal_impl(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_target uuid; v_target_name text; v_my_name text;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, p.name
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp, v_my_name
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'pride' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 50 then
    return jsonb_build_object('ok', false);
  end if;
  select p.id, p.name into v_target, v_target_name
  from players p where p.room_id = v_room and p.id <> p_player_id
    and not p.dead and not p.in_prison and not p.in_hospital
  order by random() limit 1;
  if v_target is null then return jsonb_build_object('ok', false); end if;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, v_target,
          v_my_name || ' revealed themselves to you as Pride — you will score nothing in this minigame.');
  update rooms set pride_target = v_target::text where id = v_room;
  update players set soul_energy = soul_energy - 50, acted_this_day = true where id = p_player_id;
  return jsonb_build_object('ok', true, 'target_name', v_target_name);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function pride_reveal_impl(uuid) from public, anon, authenticated;

create or replace function pride_reveal(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return pride_reveal_impl(p_player_id);
end; $$;
grant execute on function pride_reveal(uuid) to anon, authenticated;

-- Diligence: pay 100 SE to learn how many of this round's minigame guesses
-- were correct (stored at submit time). Usable on the result screen.
create or replace function diligence_count_impl(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean; v_correct int;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day, s.minigame_correct
    into v_room, v_phase, v_se, v_role, v_acted, v_correct
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'result'
     or v_role is distinct from 'diligence' or v_acted or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  return jsonb_build_object('ok', true, 'correct', coalesce(v_correct, 0));
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function diligence_count_impl(uuid) from public, anon, authenticated;

create or replace function diligence_count(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return diligence_count_impl(p_player_id);
end; $$;
grant execute on function diligence_count(uuid) to anon, authenticated;

-- ============================================
-- New-role abilities, batch 2 — Wrath / Love (migration 067)
-- ============================================
-- Conversion: Wrath corrupts a Virtue into a Vice Worshipper (bound to Wrath as
-- a follower); Love turns a Vice into a Virtue Seeker. The convert REPLACES the
-- target's role (they lose their old ability and switch camps for the win check
-- + minigame), cancels their queued action, marks them as having acted, and
-- privately tells them. 150 SE, one ability/day, charged even on a whiff (you
-- gamble on the camp; a "nothing happened" still reveals they were already on
-- the side you targeted). Instant (no resolve_role_action change).
create or replace function convert_player_impl(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_tgt_active boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role not in ('wrath','love') or v_acted
     or v_dead or v_prison or v_hosp or v_se < 200 or p_target_id = p_player_id then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target_id and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;

  -- Queue the conversion; it lands in resolve_role_action AFTER the target's own
  -- action this turn has fired, checked there against a camp/tier snapshot (only
  -- a non-S role of the wanted camp flips; S-tier roles — incl. Wrath/Love — are
  -- immune). Charged now (a gamble); the result comes back to you as a notice.
  update players set soul_energy = soul_energy - 200, acted_this_day = true
  where id = p_player_id;
  update player_secrets set pending_action = 'convert', pending_target = p_target_id::text
  where player_id = p_player_id;
  return jsonb_build_object('ok', true, 'queued', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function convert_player_impl(uuid, uuid) from public, anon, authenticated;

create or replace function convert_player(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return convert_player_impl(p_player_id, p_target_id);
end; $$;
grant execute on function convert_player(uuid, uuid) to anon, authenticated;

-- Wrath: give up one living follower for a lasting extra life (100 SE). The
-- follower dies (a consume — extra lives don't save them, like a Sacrifice).
-- One ability/day. Runs the win check (a death occurred).
create or replace function relinquish_follower_impl(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_follower uuid; v_winner text;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'wrath' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  select s.player_id into v_follower
  from player_secrets s join players p on p.id = s.player_id
  where s.follower_of = p_player_id and not p.dead
  order by p.created_at limit 1;
  if v_follower is null then return jsonb_build_object('ok', false); end if;

  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  update players set dead = true where id = v_follower;
  update player_secrets set extra_lives = extra_lives + 1 where player_id = p_player_id;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, v_follower, 'Wrath has consumed your life for their own.');
  -- Log the kill for the game-over overview (migration 074).
  update rooms set kill_log = coalesce(kill_log, '[]'::jsonb)
    || jsonb_build_object('killer', p_player_id, 'victim', v_follower,
                          'day', (select day from rooms where id = v_room))
  where id = v_room;

  v_winner := vv_check_winner(v_room);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro' else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = v_room;
  end if;
  return jsonb_build_object('ok', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function relinquish_follower_impl(uuid) from public, anon, authenticated;

create or replace function relinquish_follower(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return relinquish_follower_impl(p_player_id);
end; $$;
grant execute on function relinquish_follower(uuid) to anon, authenticated;

-- Love: arm the deciding vote (100 SE). In THIS day's consultation, a tie that
-- Love voted into breaks to Love's pick (see consultation_tally /
-- resolve_consultation). One ability/day. Cleared each new day.
create or replace function arm_tiebreak_impl(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'love' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  update rooms set love_tiebreak = p_player_id::text where id = v_room;
  return jsonb_build_object('ok', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function arm_tiebreak_impl(uuid) from public, anon, authenticated;

create or replace function arm_tiebreak(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return arm_tiebreak_impl(p_player_id);
end; $$;
grant execute on function arm_tiebreak(uuid) to anon, authenticated;

-- Wrath's count of living followers (for the UI's relinquish button).
create or replace function my_follower_count_impl(p_player_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from player_secrets s join players p on p.id = s.player_id
  where s.follower_of = p_player_id and not p.dead;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function my_follower_count_impl(uuid) from public, anon, authenticated;

create or replace function my_follower_count(p_player_id uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_follower_count_impl(p_player_id);
end; $$;
grant execute on function my_follower_count(uuid) to anon, authenticated;

-- ============================================
-- New-role abilities, batch 3 — Fanaticism / bombs (migration 068)
-- ============================================
-- Fanaticism plants up to 2 bombs (100 SE each, one reflection action/day) on
-- other players. A bomb is held secretly; from the day AFTER it lands, its
-- holder must pass it to another active player each reflection (auto-random if
-- they don't). Fanaticism can pay 100 to see who carries them, and 150 during
-- consultation to detonate one — instantly killing its current holder (no
-- protection: it's a consultation-phase kill, like instant Sacrifice). The
-- detonate UI is blind (no holder name) so the 100-SE check has real value and
-- a bomb that drifted onto a teammate kills them. Bombs live on rooms.bombs
-- (jsonb, SECRET — never in PUBLIC_ROOM_COLS); the holder learns they hold one
-- via get_my_secrets, nobody else does.

-- Plant a bomb on an active player (100 SE, role_action, one/day, cap 2/game).
create or replace function plant_bomb_impl(p_fanatic uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_day int; v_planted int;
  v_bombs jsonb; v_tgt_active boolean; v_holds boolean; v_id int;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, r.day, r.bombs_planted, r.bombs
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp,
         v_day, v_planted, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'fanaticism' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 50
     or coalesce(v_planted, 0) >= 2 or p_target = p_fanatic then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;
  -- One bomb per holder: don't stack a second bomb on a current carrier.
  select exists(
    select 1 from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
    where (b->>'holder')::uuid = p_target
  ) into v_holds;
  if v_holds then return jsonb_build_object('ok', false, 'reason', 'already_holding'); end if;

  v_id := coalesce(v_planted, 0) + 1;
  update players set soul_energy = soul_energy - 50, acted_this_day = true where id = p_fanatic;
  update rooms set bombs_planted = v_id,
    bombs = coalesce(bombs, '[]'::jsonb)
            || jsonb_build_object('id', v_id, 'holder', p_target::text,
                                  'since', v_day, 'pass_to', null)
  where id = v_room;
  -- Tell the receiver they're holding a bomb now (migration 072).
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, p_target,
    'A bomb has been slipped into your hands. From tomorrow you must pass it on each reflection — and if it goes off while you hold it, you die.');
  return jsonb_build_object('ok', true, 'bomb_id', v_id);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function plant_bomb_impl(uuid, uuid) from public, anon, authenticated;

create or replace function plant_bomb(p_fanatic uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return plant_bomb_impl(p_fanatic, p_target);
end; $$;
grant execute on function plant_bomb(uuid, uuid) to anon, authenticated;

-- See who currently carries your bombs (50 SE, STORE phase — migration 072).
-- No day-action gate (the shop is SE-limited, not acted_this_day): repeatable.
create or replace function bomb_carriers_impl(p_fanatic uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_bombs jsonb; v_list jsonb;
begin
  select p.room_id, r.phase, p.soul_energy, s.role,
         p.dead, p.in_prison, p.in_hospital, r.bombs
    into v_room, v_phase, v_se, v_role, v_dead, v_prison, v_hosp, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'store'
     or v_role is distinct from 'fanaticism'
     or v_dead or v_prison or v_hosp or v_se < 50 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 50 where id = p_fanatic;
  select coalesce(jsonb_agg(
           jsonb_build_object('id', (b->>'id')::int, 'name', pl.name)
           order by (b->>'id')::int), '[]'::jsonb)
    into v_list
  from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
  join players pl on pl.id = (b->>'holder')::uuid;
  return jsonb_build_object('ok', true, 'carriers', v_list);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function bomb_carriers_impl(uuid) from public, anon, authenticated;

create or replace function bomb_carriers(p_fanatic uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return bomb_carriers_impl(p_fanatic);
end; $$;
grant execute on function bomb_carriers(uuid) to anon, authenticated;

-- A bomb-holder chooses who to pass to this reflection (free; resolves at
-- resolve_role_action). Only valid for a bomb they must pass (held since a
-- previous day) and an active, non-self target.
create or replace function pass_bomb_impl(p_holder uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_day int; v_bombs jsonb; v_new jsonb := '[]'::jsonb;
  v_tgt_active boolean; b jsonb; v_found boolean := false;
begin
  select p.room_id, r.phase, r.day, r.bombs
    into v_room, v_phase, v_day, v_bombs
  from players p join rooms r on r.id = p.room_id where p.id = p_holder;
  if v_room is null or v_phase is distinct from 'role_action' or p_target = p_holder then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;
  for b in select * from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) loop
    if (b->>'holder')::uuid = p_holder
       and coalesce((b->>'since')::int, v_day) < v_day then
      v_new := v_new || (b || jsonb_build_object('pass_to', p_target::text));
      v_found := true;
    else
      v_new := v_new || b;
    end if;
  end loop;
  if not v_found then return jsonb_build_object('ok', false); end if;
  update rooms set bombs = v_new where id = v_room;
  return jsonb_build_object('ok', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function pass_bomb_impl(uuid, uuid) from public, anon, authenticated;

create or replace function pass_bomb(p_holder uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_holder) then raise exception 'forbidden' using errcode='42501'; end if;
  return pass_bomb_impl(p_holder, p_target);
end; $$;
grant execute on function pass_bomb(uuid, uuid) to anon, authenticated;

-- Arm one of your bombs for detonation (150 SE, STORE phase — migration 072).
-- It does NOT kill immediately: resolve_store kills the holder (unblockable)
-- when the shop closes, so the death shows in the after-shop summary. Charged
-- now; the result comes back to Fanaticism as a private notice at resolution.
create or replace function detonate_bomb_impl(p_fanatic uuid, p_bomb_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_dead boolean;
  v_bombs jsonb; v_holder uuid; v_holder_dead boolean; v_armed boolean;
  v_new jsonb := '[]'::jsonb; b jsonb; v_found boolean := false;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.dead, r.bombs
    into v_room, v_phase, v_se, v_role, v_dead, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'store'
     or v_role is distinct from 'fanaticism' or v_dead or v_se < 150 then
    return jsonb_build_object('ok', false);
  end if;
  select (b2->>'holder')::uuid, coalesce((b2->>'armed')::boolean, false)
    into v_holder, v_armed
  from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b2
  where (b2->>'id')::int = p_bomb_id;
  if v_holder is null or v_armed then return jsonb_build_object('ok', false); end if;
  select dead into v_holder_dead from players where id = v_holder;
  if coalesce(v_holder_dead, true) then return jsonb_build_object('ok', false); end if;

  -- Mark it armed; resolve_store finishes the job when the shop closes.
  for b in select * from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) loop
    if (b->>'id')::int = p_bomb_id then
      v_new := v_new || (b || '{"armed": true}'::jsonb); v_found := true;
    else v_new := v_new || b; end if;
  end loop;
  if not v_found then return jsonb_build_object('ok', false); end if;

  update players set soul_energy = soul_energy - 150 where id = p_fanatic;
  update rooms set bombs = v_new where id = v_room;
  return jsonb_build_object('ok', true, 'armed', true);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function detonate_bomb_impl(uuid, int) from public, anon, authenticated;

create or replace function detonate_bomb(p_fanatic uuid, p_bomb_id int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return detonate_bomb_impl(p_fanatic, p_bomb_id);
end; $$;
grant execute on function detonate_bomb(uuid, int) to anon, authenticated;

-- Fanaticism's own state for the plant UI: bombs planted / remaining / active.
create or replace function fanatic_state_impl(p_fanatic uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_room uuid; v_role text; v_planted int; v_bombs jsonb;
begin
  select p.room_id, s.role, r.bombs_planted, r.bombs
    into v_room, v_role, v_planted, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_role is distinct from 'fanaticism' then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true,
    'planted', coalesce(v_planted, 0),
    'remaining', greatest(0, 2 - coalesce(v_planted, 0)),
    'active', jsonb_array_length(coalesce(v_bombs, '[]'::jsonb)));
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function fanatic_state_impl(uuid) from public, anon, authenticated;

create or replace function fanatic_state(p_fanatic uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return fanatic_state_impl(p_fanatic);
end; $$;
grant execute on function fanatic_state(uuid) to anon, authenticated;

-- Fanaticism's active bombs for the detonate UI — blind: only id + whether the
-- (unknown) holder is alive (detonatable) + whether it's already armed this
-- shop. No holder name (that costs 50 via bomb_carriers).
create or replace function my_bombs_impl(p_fanatic uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_room uuid; v_role text; v_bombs jsonb;
begin
  select p.room_id, s.role, r.bombs into v_room, v_role, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_role is distinct from 'fanaticism' then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', (b->>'id')::int,
             'alive', exists(select 1 from players pl
                             where pl.id = (b->>'holder')::uuid and not pl.dead),
             'armed', coalesce((b->>'armed')::boolean, false))
           order by (b->>'id')::int)
    from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
  ), '[]'::jsonb);
end; $$;
-- Internal: only the gated wrapper below may call this.
revoke all on function my_bombs_impl(uuid) from public, anon, authenticated;

create or replace function my_bombs(p_fanatic uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_bombs_impl(p_fanatic);
end; $$;
grant execute on function my_bombs(uuid) to anon, authenticated;

-- Certainty (cost 100): reveal one target's exact role id (migration 029).
create or replace function reveal_role_impl(p_player_id uuid, p_target_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function reveal_role_impl(uuid, uuid) from public, anon, authenticated;

create or replace function reveal_role(p_player_id uuid, p_target_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return reveal_role_impl(p_player_id, p_target_id);
end; $$;
grant execute on function reveal_role(uuid, uuid) to anon, authenticated;

-- Empathy (cost 150): reveal who voted for whom last consultation as a
-- jsonb array [{ target_id, voter_ids:[...] }] (migration 029).
create or replace function reveal_votes_empathy_impl(p_player_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function reveal_votes_empathy_impl(uuid) from public, anon, authenticated;

create or replace function reveal_votes_empathy(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return reveal_votes_empathy_impl(p_player_id);
end; $$;
grant execute on function reveal_votes_empathy(uuid) to anon, authenticated;

-- Empathy's second ability (migration 123; replaced the ungated 100-SE
-- reveal_camp from 056, now dropped): for 150 SE, read the private Outreach
-- messages between two chosen players from the PREVIOUS day (Empathy acts
-- before that day's Outreach). Day 2+, role_action only, one ability per day.
create or replace function empathy_read_messages(
  p_player_id uuid,
  p_a uuid,
  p_b uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_se numeric;
  v_acted boolean;
  v_role text;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_phase text;
  v_day integer;
  v_msgs jsonb;
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.room_id, p.soul_energy, p.acted_this_day, s.role,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_se, v_acted, v_role, v_dead, v_prison, v_hosp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_player_id
   for update of p;

  if v_room is null or v_role is distinct from 'empathy' then
    return jsonb_build_object('ok', false, 'reason', 'not_empathy');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;

  select phase, day into v_phase, v_day from rooms where id = v_room;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_day < 2 then
    return jsonb_build_object('ok', false, 'reason', 'too_early');
  end if;
  if v_acted then
    return jsonb_build_object('ok', false, 'reason', 'already_acted');
  end if;
  if v_se < 150 then
    return jsonb_build_object('ok', false, 'reason', 'not_enough');
  end if;

  if p_a is null or p_b is null or p_a = p_b
     or p_a = p_player_id or p_b = p_player_id
     or (select count(*) from players where id in (p_a, p_b) and room_id = v_room) <> 2 then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;

  update players
     set soul_energy = soul_energy - 150, acted_this_day = true
   where id = p_player_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sender_id', m.sender_id,
           'text', m.text,
           'created_at', m.created_at
         ) order by m.created_at), '[]'::jsonb)
    into v_msgs
    from dm_messages m
   where m.room_id = v_room
     and m.day = v_day - 1
     and ((m.sender_id = p_a and m.recipient_id = p_b)
       or (m.sender_id = p_b and m.recipient_id = p_a));

  return jsonb_build_object('ok', true, 'day', v_day - 1, 'messages', v_msgs);
end;
$$;
grant execute on function empathy_read_messages(uuid, uuid, uuid) to anon, authenticated;

-- Win check (ports winConditions.checkWinner) — migration 030.
create or replace function vv_check_winner(p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vices int;
  v_virtues int;
begin
  -- Murder +1 instant-win endgame removed (migration 090): a lone Virtue can
  -- still win via the store potions, so play continues until a camp is out.
  select
    count(*) filter (where vv_role_camp(s.role) = 'vice'),
    count(*) filter (where vv_role_camp(s.role) = 'virtue')
  into v_vices, v_virtues
  from players p
  join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison;

  if v_vices = 0 and v_virtues > 0 then return 'virtue'; end if;
  if v_virtues = 0 and v_vices > 0 then return 'vice'; end if;
  return null;
end;
$$;

grant execute on function vv_check_winner(uuid) to anon, authenticated;

-- Role-action resolution (ports endRoleAction) — migration 030.
-- (Migration-056 ability rework + migration-059 combat potions folded in.)
create or replace function resolve_role_action_impl(p_room_id uuid)
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

  -- Protection potion: a buyer's shield lasts a full cycle (migration 073).
  v_protected := v_protected || coalesce((
    select array_agg(s.player_id)
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.potion_protect and not p.dead
  ), '{}'::uuid[]);

  -- Kills + sacrifices.
  for r in
    select p.id, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('kill','sacrifice','vengeance_kill') and s.pending_target is not null
  loop
    if r.act = 'kill' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    elsif r.act = 'vengeance_kill' then
      -- Imprisoned Vengeance takes as many of her jailers as she paid for
      -- (150 SE each, migration 113). Same protect-checked jsonb array as
      -- sacrifice, except the actor does NOT die with them.
      v_dead := v_dead || coalesce((
        select array_agg(e::uuid)
        from jsonb_array_elements_text(r.tgt::jsonb) e
        where not (e::uuid = any(v_protected))
      ), '{}'::uuid[]);
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

  -- Kill potion (inert in the new flow — combat potions resolve in the shop).
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

  -- Hospitalise potion (inert in the new flow).
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

  -- Extra lives (migration 066): absorb a would-be kill then hospitalisation.
  for r in
    select s.player_id as id
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.extra_lives > 0 and s.player_id = any(v_dead)
  loop
    v_dead := array_remove(v_dead, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;
  for r in
    select s.player_id as id
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.extra_lives > 0
      and s.player_id = any(v_hospital) and not (s.player_id = any(v_dead))
  loop
    v_hospital := array_remove(v_hospital, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;

  -- Attribute kills for the game-over overview (migration 074): one killer per
  -- actually-dead victim, derived in priority order (direct kill, then a
  -- sacrifice that took them, then a Worshipper's guess). A self-sacrifice logs
  -- killer = victim.
  declare
    v_kday int; v_kvic uuid; v_kkiller uuid; v_klog jsonb := '[]'::jsonb;
  begin
    select day into v_kday from rooms where id = p_room_id;
    for v_kvic in select distinct u from unnest(v_dead) u loop
      v_kkiller := null;
      select p.id into v_kkiller
      from players p join player_secrets s on s.player_id = p.id
      where p.room_id = p_room_id and s.pending_action = 'kill'
        and s.pending_target = v_kvic::text limit 1;
      if v_kkiller is null then
        select s.player_id into v_kkiller
        from player_secrets s join players p on p.id = s.player_id
        where p.room_id = p_room_id and s.pending_action = 'vengeance_kill'
          and s.pending_target is not null
          and s.pending_target::jsonb ? v_kvic::text
        limit 1;
      end if;
      if v_kkiller is null then
        select s.player_id into v_kkiller
        from player_secrets s join players p on p.id = s.player_id
        where p.room_id = p_room_id and s.pending_action = 'sacrifice'
          and (s.player_id = v_kvic
               or (s.pending_target is not null and s.pending_target::jsonb ? v_kvic::text))
        limit 1;
      end if;
      if v_kkiller is null then
        select p.id into v_kkiller
        from players p join player_secrets s on s.player_id = p.id
        where p.room_id = p_room_id and s.pending_action = 'worshipper_guess'
          and s.pending_target = v_kvic::text limit 1;
      end if;
      v_klog := v_klog
        || jsonb_build_object('killer', v_kkiller, 'victim', v_kvic, 'day', v_kday);
    end loop;
    if jsonb_array_length(v_klog) > 0 then
      update rooms set kill_log = coalesce(kill_log, '[]'::jsonb) || v_klog
      where id = p_room_id;
    end if;
  end;

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

  -- Wrath/Love conversions (migration 071): snapshot-evaluated, applied here.
  declare
    v_converts jsonb;
    cc jsonb;
    v_caster uuid; v_crole text; v_ctgt uuid;
    v_tcamp text; v_ttier text; v_want text; v_newrole text; v_tname text;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'caster', cp.player_id, 'crole', cp.role, 'tgt', cp.pending_target,
             'tcamp', vv_role_camp(ts.role), 'ttier', vv_role_tier(ts.role))), '[]'::jsonb)
      into v_converts
    from player_secrets cp
      join players p on p.id = cp.player_id
      join player_secrets ts on ts.player_id = cp.pending_target::uuid
    where p.room_id = p_room_id and cp.pending_action = 'convert'
      and cp.pending_target is not null;

    for cc in select * from jsonb_array_elements(v_converts) loop
      v_caster := (cc->>'caster')::uuid;
      v_crole  := cc->>'crole';
      v_ctgt   := (cc->>'tgt')::uuid;
      v_tcamp  := cc->>'tcamp';
      v_ttier  := cc->>'ttier';
      if v_crole = 'wrath' then v_want := 'virtue'; v_newrole := 'vice_worshipper';
      else v_want := 'vice'; v_newrole := 'virtue_seeker'; end if;
      select name into v_tname from players where id = v_ctgt;
      if not (v_ctgt = any(v_dead)) and v_tcamp = v_want and v_ttier is distinct from 'S' then
        update player_secrets set role = v_newrole,
          follower_of = case when v_crole = 'wrath' then v_caster else null end
        where player_id = v_ctgt;
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, v_caster,
          'Your influence took hold — ' || coalesce(v_tname, 'your target')
          || ' now serves your camp.');
      else
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, v_caster,
          coalesce(v_tname, 'Your target') || ' resisted your influence.');
      end if;
    end loop;
  end;

  -- Clear role actions + the (inert) combat potion fields.
  update player_secrets set pending_action = null, pending_target = null,
    potion_kill_target = null, potion_hosp_target = null, potion_protect = false
    where player_id in (select id from players where room_id = p_room_id);

  -- Fanaticism bombs (migration 068): move every bomb held since a previous day;
  -- the new holder is told they've received it (migration 072).
  declare
    v_day int;
    v_bombs jsonb;
    v_newbombs jsonb := '[]'::jsonb;
    b jsonb;
    v_holder uuid;
    v_since int;
    v_passto uuid;
    v_next uuid;
    v_holder_active boolean;
  begin
    select day, bombs into v_day, v_bombs from rooms where id = p_room_id;
    if v_bombs is not null and jsonb_array_length(v_bombs) > 0 then
      for b in select * from jsonb_array_elements(v_bombs) loop
        v_holder := (b->>'holder')::uuid;
        v_since := coalesce((b->>'since')::int, v_day);
        v_passto := nullif(b->>'pass_to', '')::uuid;
        select (not dead and not in_prison and not in_hospital)
          into v_holder_active from players where id = v_holder;
        if coalesce(v_holder_active, false) and v_since >= v_day then
          v_newbombs := v_newbombs
            || jsonb_build_object('id', b->'id', 'holder', v_holder::text,
                                  'since', v_since, 'pass_to', null);
        else
          v_next := null;
          if v_passto is not null then
            select id into v_next from players
            where id = v_passto and room_id = p_room_id
              and not dead and not in_prison and not in_hospital;
          end if;
          if v_next is null then
            select id into v_next from players
            where room_id = p_room_id and not dead and not in_prison and not in_hospital
              and id <> v_holder
            order by random() limit 1;
          end if;
          if v_next is null then v_next := v_holder; end if;
          v_newbombs := v_newbombs
            || jsonb_build_object('id', b->'id', 'holder', v_next::text,
                                  'since', v_day, 'pass_to', null);
          if v_next is distinct from v_holder then
            insert into player_notices (room_id, recipient_id, text)
            values (p_room_id, v_next,
              'A bomb has been passed into your hands. Pass it on next reflection — if it goes off while you hold it, you die.');
          end if;
        end if;
      end loop;
      update rooms set bombs = v_newbombs where id = p_room_id;
    end if;
  end;

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
-- Internal: only the gated wrapper may call this (migrations 097 + 112).
revoke all on function resolve_role_action_impl(uuid) from public, anon, authenticated;

-- Phase-guarded (migration 120): locks the room and no-ops unless it's still in
-- role_action, so a retried / duplicate host call can't re-resolve.
create or replace function resolve_role_action(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  select phase into v_phase from rooms where id = p_room_id for update;
  if v_phase is distinct from 'role_action' then return; end if; -- already resolved
  perform resolve_role_action_impl(p_room_id);
end; $$;
grant execute on function resolve_role_action(uuid) to anon, authenticated;

-- Host-gated minigame Soul Energy award (migration 102). Additive, so since
-- migration 120 it pays at most once per room per day (rooms.minigame_awarded_day)
-- and only during the minigame — a retried endMinigame can't double-pay.
create or replace function apply_minigame_awards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb; v_player uuid; v_award numeric;
  v_phase text; v_day integer; v_awarded integer;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then return; end if;

  select phase, day, minigame_awarded_day
    into v_phase, v_day, v_awarded
    from rooms where id = p_room_id for update;
  if v_phase is distinct from 'minigame' then return; end if;
  if v_awarded is not distinct from v_day then return; end if; -- already paid today

  for v_elem in select * from jsonb_array_elements(p_awards) loop
    v_player := (v_elem->>'player')::uuid;
    v_award  := (v_elem->>'award')::numeric;
    if v_player is null or v_award is null then continue; end if;
    if v_award < 0 or v_award > 200 then
      raise exception 'award out of range' using errcode = '22023';
    end if;
    update players set soul_energy = soul_energy + v_award
    where id = v_player and room_id = p_room_id;
  end loop;

  update rooms set minigame_awarded_day = v_day where id = p_room_id;
end;
$$;
grant execute on function apply_minigame_awards(uuid, jsonb) to anon, authenticated;

-- ============================================
-- Shop-phase resolution (migration 072)
-- ============================================
-- Runs when the STORE phase closes. Resolves everything that happened in the
-- shop — combat potions (kill/hospitalise/protection), bomb detonations, and
-- sacrifices — into one pass, then opens the store_summary screen (an anonymous
-- recap, like event_summary) before the camp abilities. Combat potions used to
-- resolve in the NEXT reflection; they now resolve here, the same day.
--   * Protection potion shields its buyer against shop kills.
--   * Kill / hospitalise potions are protect-checked + extra-life absorbable.
--   * Sacrifices (queued in the shop, pending_action='sacrifice') kill the actor
--     + their targets, protect-checked + extra-life absorbable.
--   * Armed bomb detonations kill the holder, UNBLOCKABLE (bypass protect +
--     extra lives), and privately notice the Fanaticism who armed them.
create or replace function resolve_store_impl(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protected uuid[] := '{}';
  v_dead uuid[] := '{}';       -- protect/extra-life eligible (potions + sacrifices)
  v_detonated uuid[] := '{}';  -- bomb deaths (unblockable, no extra life)
  v_hospital uuid[] := '{}';
  v_events jsonb;
  v_winner text;
  v_fanatic uuid;
  v_bombs jsonb;
  v_newbombs jsonb := '[]'::jsonb;
  r record;
  b jsonb;
begin
  -- Protection potions shield their (alive) buyer.
  select coalesce(array_agg(s.player_id), '{}') into v_protected
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.potion_protect and not p.dead;

  -- Kill potions: a live buyer kills a target unless protected or already dead.
  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_kill_target
    where p.room_id = p_room_id and s.potion_kill_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_dead := array_append(v_dead, r.tgt);
    end if;
  end loop;

  -- Sacrifices queued in the shop: the actor + a JSON array of targets, each
  -- protect-checked.
  for r in
    select p.id, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.pending_action = 'sacrifice'
      and s.pending_target is not null
  loop
    if not (r.id = any(v_protected)) then
      v_dead := array_append(v_dead, r.id);
    end if;
    v_dead := v_dead || coalesce((
      select array_agg(e::uuid)
      from jsonb_array_elements_text(r.tgt::jsonb) e
      where not (e::uuid = any(v_protected))
    ), '{}'::uuid[]);
  end loop;

  -- Hospitalise potions: a live buyer hospitalises a target unless protected or
  -- already dead.
  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_hosp_target
    where p.room_id = p_room_id and s.potion_hosp_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_hospital := array_append(v_hospital, r.tgt);
    end if;
  end loop;

  -- Extra lives absorb a would-be kill first, then a would-be hospitalisation
  -- (potions/sacrifices only — detonations bypass them).
  for r in
    select s.player_id as id from player_secrets s
    where s.player_id = any(v_dead) and s.extra_lives > 0
  loop
    v_dead := array_remove(v_dead, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;
  for r in
    select s.player_id as id from player_secrets s
    where s.player_id = any(v_hospital) and not (s.player_id = any(v_dead))
      and s.extra_lives > 0
  loop
    v_hospital := array_remove(v_hospital, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;

  -- Armed bomb detonations: kill the (still-alive) holder, unblockable. Drop the
  -- armed bombs from the room and privately tell the Fanaticism who died.
  select player_id into v_fanatic
  from player_secrets
  where role = 'fanaticism'
    and player_id in (select id from players where room_id = p_room_id)
  limit 1;
  select bombs into v_bombs from rooms where id = p_room_id;
  for b in select * from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) loop
    if coalesce((b->>'armed')::boolean, false)
       and exists (select 1 from players where id = (b->>'holder')::uuid and not dead) then
      v_detonated := array_append(v_detonated, (b->>'holder')::uuid);
      if v_fanatic is not null then
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, v_fanatic, 'Your bomb detonated and killed '
          || coalesce((select name from players where id = (b->>'holder')::uuid), 'someone') || '.');
      end if;
    elsif not coalesce((b->>'armed')::boolean, false) then
      v_newbombs := v_newbombs || b;  -- keep un-armed bombs
    end if;
  end loop;
  update rooms set bombs = v_newbombs where id = p_room_id;

  -- Apply deaths + hospitalisations.
  update players set dead = true where id = any(v_dead) or id = any(v_detonated);
  update players set in_hospital = true
    where id = any(v_hospital)
      and not (id = any(v_dead)) and not (id = any(v_detonated));

  -- Anonymous events for the store_summary (name + initial only, like the
  -- post-role-action event summary).
  v_events := coalesce(
    (select jsonb_agg(jsonb_build_object('type','killed','target_id', q.d))
       from (select distinct u as d from unnest(v_dead || v_detonated) u) q),
    '[]'::jsonb);
  v_events := v_events || coalesce(
    (select jsonb_agg(jsonb_build_object('type','hospitalized','target_id', q.h))
       from (select distinct u as h from unnest(v_hospital) u) q
       where not (q.h = any(v_dead)) and not (q.h = any(v_detonated))),
    '[]'::jsonb);

  -- Attribute shop kills for the game-over "who killed who" overview
  -- (migration 074): detonations are the Fanaticism's; otherwise the kill-potion
  -- buyer or the sacrifice actor. Run before the clear consumes the fields.
  declare
    v_kday int; v_kvic uuid; v_kkiller uuid; v_klog jsonb := '[]'::jsonb;
  begin
    select day into v_kday from rooms where id = p_room_id;
    for v_kvic in select distinct u from unnest(v_detonated) u loop
      v_klog := v_klog
        || jsonb_build_object('killer', v_fanatic, 'victim', v_kvic, 'day', v_kday);
    end loop;
    for v_kvic in select distinct u from unnest(v_dead) u loop
      v_kkiller := null;
      select s.player_id into v_kkiller
      from player_secrets s join players p on p.id = s.player_id
      where p.room_id = p_room_id and s.potion_kill_target = v_kvic limit 1;
      if v_kkiller is null then
        select s.player_id into v_kkiller
        from player_secrets s join players p on p.id = s.player_id
        where p.room_id = p_room_id and s.pending_action = 'sacrifice'
          and (s.player_id = v_kvic
               or (s.pending_target is not null and s.pending_target::jsonb ? v_kvic::text))
        limit 1;
      end if;
      v_klog := v_klog
        || jsonb_build_object('killer', v_kkiller, 'victim', v_kvic, 'day', v_kday);
    end loop;
    if jsonb_array_length(v_klog) > 0 then
      update rooms set kill_log = coalesce(kill_log, '[]'::jsonb) || v_klog
      where id = p_room_id;
    end if;
  end;

  -- Clear the kill/hospitalise potions + shop sacrifices (they fired). Leave
  -- the minigame multiplier + vote-reveal potions for their own resolvers, AND
  -- leave potion_protect set: it lasts a full cycle (migration 073), so it also
  -- shields the buyer against Murder/Intoxication in the NEXT reflection, where
  -- resolve_role_action's protect block uses it and then clears it.
  update player_secrets set
    potion_kill_target = null, potion_hosp_target = null,
    pending_action = null, pending_target = null
  where player_id in (select id from players where room_id = p_room_id);

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
  update rooms set phase = 'store_summary', phase_ends_at = null, last_events = v_events
  where id = p_room_id;
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function resolve_store_impl(uuid) from public, anon, authenticated;

-- Phase-guarded (migration 120): no-op unless the room is still in the store.
create or replace function resolve_store(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  select phase into v_phase from rooms where id = p_room_id for update;
  if v_phase is distinct from 'store' then return; end if; -- already resolved
  perform resolve_store_impl(p_room_id);
end; $$;
grant execute on function resolve_store(uuid) to anon, authenticated;

-- Murder succession (ports chooseMurderSuccessor) — migration 030.
create or replace function choose_murder_successor_impl(p_room_id uuid, p_successor_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function choose_murder_successor_impl(uuid, uuid) from public, anon, authenticated;

create or replace function choose_murder_successor(p_room_id uuid, p_successor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform choose_murder_successor_impl(p_room_id, p_successor_id);
end; $$;
grant execute on function choose_murder_successor(uuid, uuid) to anon, authenticated;

-- Consultation resolution (ports endConsultation) — migration 031; migration
-- 056 captures Vengeance's jailers; migration 060 clears the vote-reveal potion.
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
-- Internal: only the gated wrapper below may call this.
revoke all on function resolve_consultation_impl(uuid) from public, anon, authenticated;

-- Phase-guarded (migration 120): no-op unless the room is still in consultation.
create or replace function resolve_consultation(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  select phase into v_phase from rooms where id = p_room_id for update;
  if v_phase is distinct from 'consultation' then return; end if; -- already resolved
  perform resolve_consultation_impl(p_room_id);
end; $$;
grant execute on function resolve_consultation(uuid) to anon, authenticated;

-- Tie-breaker re-vote (ports startRevote) — migration 031.
create or replace function start_revote_impl(p_room_id uuid, p_candidate_ids jsonb)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function start_revote_impl(uuid, jsonb) from public, anon, authenticated;

create or replace function start_revote(p_room_id uuid, p_candidate_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform start_revote_impl(p_room_id, p_candidate_ids);
end; $$;
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

-- Truthfulness reveal (migration 033): verify caller, spend SE, set vote_reveal.
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
-- Internal: only the gated wrapper below may call this.
revoke all on function reveal_votes_truthfulness_impl(uuid) from public, anon, authenticated;

create or replace function reveal_votes_truthfulness(p_player_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return reveal_votes_truthfulness_impl(p_player_id);
end; $$;
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
create or replace function vengeance_available_impl(p_player_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function vengeance_available_impl(uuid) from public, anon, authenticated;

create or replace function vengeance_available(p_player_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return vengeance_available_impl(p_player_id);
end; $$;
grant execute on function vengeance_available(uuid) to anon, authenticated;

-- Group action resolution (ports endGroupAction) — migration 034.
create or replace function resolve_group_action_impl(p_room_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function resolve_group_action_impl(uuid) from public, anon, authenticated;

create or replace function resolve_group_action(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform resolve_group_action_impl(p_room_id);
end; $$;
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
create or replace function get_my_secrets_impl(p_player_id uuid)
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
  v_bomb_pass boolean := false;
  v_bomb_passto text := null;
begin
  select room_id into v_room_id from players where id = p_player_id;
  if v_room_id is not null then
    select
      coalesce(pending_murder_death = p_player_id::text, false),
      coalesce(recent_successor_id = p_player_id::text, false),
      coalesce(torment_target = p_player_id::text, false)
    into v_dying, v_succ, v_torment
    from rooms where id = v_room_id;

    -- Fanaticism bomb I'm holding that I must pass this reflection (received on
    -- an earlier day). Only the holder learns this — bombs are otherwise secret.
    select true, b->>'pass_to'
      into v_bomb_pass, v_bomb_passto
    from rooms r, jsonb_array_elements(r.bombs) b
    where r.id = v_room_id and (b->>'holder')::uuid = p_player_id
      and coalesce((b->>'since')::int, r.day) < r.day
    limit 1;
    v_bomb_pass := coalesce(v_bomb_pass, false);
  end if;

  select jsonb_build_object(
    'role', ps.role, 'vote', ps.vote,
    'pending_action', ps.pending_action, 'pending_target', ps.pending_target,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'extra_lives', coalesce(ps.extra_lives, 0),
    'bomb_must_pass', v_bomb_pass,
    'bomb_pass_to', v_bomb_passto)
  into v
  from player_secrets ps where ps.player_id = p_player_id;

  return coalesce(v, jsonb_build_object(
    'role', null, 'vote', null, 'pending_action', null, 'pending_target', null,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'extra_lives', 0,
    'bomb_must_pass', v_bomb_pass,
    'bomb_pass_to', v_bomb_passto));
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function get_my_secrets_impl(uuid) from public, anon, authenticated;

create or replace function get_my_secrets(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return get_my_secrets_impl(p_player_id);
end; $$;
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

-- The game-over "who killed who" overview (migration 074). Like reveal_all_roles
-- this is gated on the game being ENDED, so the kill attributions (which would
-- leak roles/abilities mid-game) only ever reach a client once it's all over.
create or replace function get_kill_log(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when status = 'ended' then coalesce(kill_log, '[]'::jsonb)
              else '[]'::jsonb end
  from rooms where id = p_room_id;
$$;

grant execute on function get_kill_log(uuid) to anon, authenticated;

-- ---- Write RPCs: secrets are written to player_secrets only (migration 036) ----

create or replace function submit_vote_impl(p_player_id uuid, p_vote text)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function submit_vote_impl(uuid, text) from public, anon, authenticated;

create or replace function submit_vote(p_player_id uuid, p_vote text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  perform submit_vote_impl(p_player_id, p_vote);
end; $$;
grant execute on function submit_vote(uuid, text) to anon, authenticated;

create or replace function queue_action_impl(
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
-- Internal: only the gated wrapper below may call this.
revoke all on function queue_action_impl(uuid, numeric, text, text) from public, anon, authenticated;

create or replace function queue_action(p_player_id uuid, p_cost numeric, p_action text, p_target text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  perform queue_action_impl(p_player_id, p_cost, p_action, p_target);
end; $$;
grant execute on function queue_action(uuid, numeric, text, text) to anon, authenticated;

-- ---- Wandering Soul anomaly (migration 094) -----------------------------
-- The Soul submits his escape guess in role_action; held in soul_escape_guess
-- (NOT pending_target) so resolve_role_action doesn't clear it first. Free.
create or replace function submit_soul_escape_impl(p_player_id uuid, p_guess jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_phase text; v_role text;
begin
  select r.phase, s.role into v_phase, v_role
  from players p join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_role is distinct from 'wandering_soul' or v_phase is distinct from 'role_action' then
    return false;
  end if;
  update player_secrets set soul_escape_guess = p_guess where player_id = p_player_id;
  update players set acted_this_day = true where id = p_player_id;
  return true;
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function submit_soul_escape_impl(uuid, jsonb) from public, anon, authenticated;

create or replace function submit_soul_escape(p_player_id uuid, p_guess jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return submit_soul_escape_impl(p_player_id, p_guess);
end; $$;
grant execute on function submit_soul_escape(uuid, jsonb) to anon, authenticated;

-- Resolve the escape — called by the host right AFTER resolve_role_action. If an
-- active Soul named every active player's camp correctly, the game ends with
-- winner = 'neutral'. The guess is consumed each day either way.
create or replace function resolve_soul_escape_impl(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_soul uuid; v_guess jsonb; v_ok boolean := true; v_active int := 0;
  r record;
begin
  select s.player_id, s.soul_escape_guess into v_soul, v_guess
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.role = 'wandering_soul'
    and s.soul_escape_guess is not null and not p.dead and not p.in_prison
  limit 1;

  update player_secrets set soul_escape_guess = null
  where player_id in (select id from players where room_id = p_room_id);

  if v_soul is null then return false; end if;

  for r in
    select p.id, vv_role_camp(s.role) as camp
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and p.id <> v_soul
      and not p.dead and not p.in_prison
  loop
    v_active := v_active + 1;
    if (v_guess ->> r.id::text) is distinct from r.camp then
      v_ok := false;
    end if;
  end loop;

  if v_ok and v_active > 0 then
    update rooms set phase = 'soul_victory_intro', winner = 'neutral',
      status = 'ended', phase_ends_at = null
    where id = p_room_id;
    return true;
  end if;
  return false;
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function resolve_soul_escape_impl(uuid) from public, anon, authenticated;

create or replace function resolve_soul_escape(p_room_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  return resolve_soul_escape_impl(p_room_id);
end; $$;
grant execute on function resolve_soul_escape(uuid) to anon, authenticated;

-- The Soul's SECOND win path (migration 108) — outlasting the castle. Called by
-- the host right after each resolution: when no alive, un-imprisoned Vice or
-- Virtue is left and the Soul is still alive, he wins alone. Like the escape it
-- OVERRIDES the phase the resolver just set, because vv_check_winner only speaks
-- 'vice'/'virtue' (with both camps at 0 it returns null = "play on").
-- A jailed-but-alive Soul still wins — with both camps gone nobody is left to
-- hold him, and the alternative is a game that can never end.
create or replace function resolve_soul_last_standing(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_soul uuid;
  v_camps int;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  -- Never override an ending that already landed (camp win, or the escape).
  if exists (select 1 from rooms where id = p_room_id and status = 'ended') then
    return false;
  end if;

  select s.player_id into v_soul
  from player_secrets s
  join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.role = 'wandering_soul' and not p.dead
  limit 1;

  if v_soul is null then return false; end if;

  select count(*) into v_camps
  from players p
  join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.dead and not p.in_prison
    and vv_role_camp(s.role) in ('vice', 'virtue');

  if v_camps > 0 then return false; end if;

  update rooms set
    phase = 'soul_victory_intro',
    winner = 'neutral',
    status = 'ended',
    phase_ends_at = null
  where id = p_room_id;

  return true;
end;
$$;

grant execute on function resolve_soul_last_standing(uuid) to anon, authenticated;

-- The Soul's 100 SE ward — his ROLE-ACTION ability (not a market potion). Reuses
-- potion_protect for the kill/hosp block (honoured by this reflection's
-- resolve_role_action) and sets potion_soul_protect for the imprisonment block
-- in this day's resolve_consultation.
create or replace function buy_soul_ward_impl(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_phase text; v_role text; v_se numeric; v_armed boolean;
begin
  select r.phase, s.role, p.soul_energy, s.potion_soul_protect
    into v_phase, v_role, v_se, v_armed
  from players p join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_role is distinct from 'wandering_soul' or v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_armed then
    return jsonb_build_object('ok', false, 'error', 'already_bought');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;
  update player_secrets set potion_protect = true, potion_soul_protect = true
  where player_id = p_player_id;
  update players set soul_energy = soul_energy - 100 where id = p_player_id;
  return jsonb_build_object('ok', true);
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function buy_soul_ward_impl(uuid) from public, anon, authenticated;

create or replace function buy_soul_ward(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return buy_soul_ward_impl(p_player_id);
end; $$;
grant execute on function buy_soul_ward(uuid) to anon, authenticated;

create or replace function clear_room_votes_impl(p_room_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function clear_room_votes_impl(uuid) from public, anon, authenticated;

create or replace function clear_room_votes(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform clear_room_votes_impl(p_room_id);
end; $$;
grant execute on function clear_room_votes(uuid) to anon, authenticated;

-- Role -> role tier (S/A/B/C/D), mirroring roles.ts. Defined here (before
-- vv_config_slot, whose SQL body is validated at creation) and again in the
-- ranked section below — identical create-or-replace, both harmless.
create or replace function vv_role_tier(p_role text)
returns text language sql immutable as $$
  select case p_role
    when 'murder' then 'S'        when 'empathy' then 'S'
    when 'wrath' then 'S'         when 'love' then 'S'
    when 'intoxication' then 'A'  when 'justice' then 'A'
    when 'gambling' then 'A'      when 'determination' then 'A'
    when 'envy' then 'B'          when 'certainty' then 'B'
    when 'fanaticism' then 'B'    when 'generosity' then 'B'
    when 'torment' then 'C'       when 'vengeance' then 'C'
    when 'truthfulness' then 'C'  when 'sacrifice' then 'C'
    when 'pride' then 'C'         when 'diligence' then 'C'
    when 'vice_worshipper' then 'D' when 'virtue_seeker' then 'D'
    else null end;
$$;

-- A configured slot role (rooms.role_config), validated: must be playable and
-- match the slot's camp + tier; anything else falls back to the default.
-- (Migration 064 — the host's random-mode per-tier role configuration.)
create function vv_config_slot(
  p_config jsonb, p_camp text, p_class text, p_default text
)
returns text
language sql
stable
as $$
  select case
    when (p_config #>> array[p_camp, p_class]) is not null
     and vv_role_camp(p_config #>> array[p_camp, p_class]) = p_camp
     and vv_role_class(p_config #>> array[p_camp, p_class]) = p_class
    then p_config #>> array[p_camp, p_class]
    else p_default
  end;
$$;

-- Start the game from the lobby, entirely server-side, branching on the
-- room's assignment mode (migration 064):
--   * 'choose': deal camps + tiers only -> role_select (players pick live).
--   * 'random': secret deal (host config via vv_config_slot) -> role_overview.
create or replace function assign_roles_and_start_impl(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_config jsonb;
  v_total int;
  v_soul int;     -- 1 on odd counts (the Wandering Soul), else 0
  v_rest int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_ids uuid[];
  v_vice_classes text[];
  v_virtue_classes text[];
  v_player record;
  v_i int := 1;
  v_j int;
  v_camp text;
  v_class text;
  v_filler text;
  -- Exterminator/Protector are dealt FIRST so every game has something that
  -- can kill and something that can save; the other three are shuffled for
  -- variety. A camp of 2-3 (small games) therefore always gets the guaranteed
  -- pair plus random extras, rather than risking a game nothing can end.
  c_vice_classes text[] := array['exterminator']
    || (select array_agg(c order by random())
        from unnest(array['troublemaker','obstructor','manipulator']) c);
  c_virtue_classes text[] := array['protector']
    || (select array_agg(c order by random())
        from unnest(array['communicator','seeker','catalyst']) c);
  -- Per-class defaults for the random deal, used when the host configured
  -- nothing for that slot. Every one is in the free starter set.
  c_vice_default jsonb := jsonb_build_object(
    'exterminator', 'murder', 'troublemaker', 'torment',
    'obstructor', 'intoxication', 'manipulator', 'envy');
  c_virtue_default jsonb := jsonb_build_object(
    'protector', 'generosity', 'communicator', 'truthfulness',
    'seeker', 'empathy', 'catalyst', 'justice');
begin
  select role_assign_mode, role_config into v_mode, v_config
  from rooms where id = p_room_id;

  select count(*) into v_total from players where room_id = p_room_id;
  -- Odd counts get one neutral Wandering Soul so the remainder splits evenly.
  v_soul := v_total % 2;
  v_rest := v_total - v_soul;
  v_vice := floor(v_rest / 2.0);
  v_virtue := v_rest - v_vice;

  if v_mode = 'choose' then
    -- Deal camps + tiers only; roles are picked live in role_select. The Soul
    -- (when present) is the first shuffled player: role auto-locked, no pick.
    select array_agg(id order by random()) into v_ids
    from players where room_id = p_room_id;

    -- One class per seat, in order, so the guaranteed pair lands first. Seats
    -- past the four classes get NULL and are dealt the filler role below.
    select array_agg(c_vice_classes[i] order by i) into v_vice_classes
    from generate_series(1, v_vice) i;
    select array_agg(c_virtue_classes[i] order by i) into v_virtue_classes
    from generate_series(1, v_virtue) i;

    for v_i in 1..v_total loop
      if v_soul = 1 and v_i = 1 then
        -- The anomaly seat is dealt EMPTY (migration 118): with more than one
        -- anomaly in the game the player chooses which to play, on the same
        -- role_select screen as everyone else. It used to be auto-locked to the
        -- Wandering Soul because he was the only one.
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_class,
                                    role_choice)
        values (v_ids[1], null, null, null, null, 'neutral', null, null)
        on conflict (player_id) do update
          set role = null, vote = null, pending_action = null,
              pending_target = null, role_choice = null,
              assigned_camp = 'neutral', assigned_class = null;
      else
        v_j := v_i - v_soul;  -- 1..v_rest
        v_camp := case when v_j <= v_vice then 'vice' else 'virtue' end;
        v_class := case when v_j <= v_vice then v_vice_classes[v_j]
                        else v_virtue_classes[v_j - v_vice] end;
        -- No class left for this seat: it's a filler. Deal the filler role
        -- outright and lock it (same shape as the Soul) instead of dropping the
        -- player into role_select with nothing they could possibly pick.
        v_filler := case when v_class is null then
          case when v_camp = 'virtue' then 'virtue_seeker' else 'vice_worshipper' end
        end;
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_class,
                                    role_choice)
        values (v_ids[v_i], v_filler, null, null, null, v_camp, v_class, v_filler)
        on conflict (player_id) do update
          set role = excluded.role, vote = null, pending_action = null,
              pending_target = null, role_choice = excluded.role_choice,
              assigned_camp = excluded.assigned_camp,
              assigned_class = excluded.assigned_class;
      end if;
      update players set soul_energy = 100, ready = false, has_voted = false
      where id = v_ids[v_i];
    end loop;

    update rooms set
      status = 'in_game', phase = 'role_select',
      phase_ends_at = now() + interval '30 seconds',
      role_pool = null, eye_uses_left = 1, free_uses_left = 1, winner = null
    where id = p_room_id;
    return;
  end if;

  -- 'random': secret deal. CLASS slots come from the host's config when valid.
  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'vice', c_vice_classes[1],
                       c_vice_default #>> array[c_vice_classes[1]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[2],
                       c_vice_default #>> array[c_vice_classes[2]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[3],
                       c_vice_default #>> array[c_vice_classes[3]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[4],
                       c_vice_default #>> array[c_vice_classes[4]])
      ])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'virtue', c_virtue_classes[1],
                       c_virtue_default #>> array[c_virtue_classes[1]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[2],
                       c_virtue_default #>> array[c_virtue_classes[2]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[3],
                       c_virtue_default #>> array[c_virtue_classes[3]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[4],
                       c_virtue_default #>> array[c_virtue_classes[4]])
      ])[i],
      'virtue_seeker'));
  end loop;
  -- Odd count: add the neutral Wandering Soul to the deal.
  if v_soul = 1 then
    -- Random mode has no picking, so the anomaly is chosen for them.
    v_roles := array_append(v_roles,
      (array['wandering_soul','game_master'])[1 + floor(random() * 2)::int]);
  end if;

  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action,
                                pending_target, assigned_camp, assigned_class,
                                role_choice)
    values (v_player.id, v_roles[v_i], null, null, null, null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null,
          assigned_camp = null, assigned_class = null, role_choice = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  update rooms set
    status = 'in_game', phase = 'role_overview', phase_ends_at = null,
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1, winner = null
  where id = p_room_id;
end;
$$;
revoke all on function assign_roles_and_start_impl(uuid) from public, anon, authenticated;

create or replace function assign_roles_and_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  select count(*) into v_count from players where room_id = p_room_id;
  if v_count < 5 then
    raise exception 'need at least 5 players to start (% in the lobby)', v_count
      using errcode = '42501';
  end if;

  perform assign_roles_and_start_impl(p_room_id);
end; $$;
grant execute on function assign_roles_and_start(uuid) to anon, authenticated;

-- Worldwide "most wins" leaderboard (profile screen). Returns the top players
-- by total wins with their public profile (username, character, featured badges,
-- equipped name/banner color so the in-game banner renders — migrations 085 + 091).
create or replace function leaderboard_top_wins(p_limit integer default 10)
returns table (
  user_id uuid,
  username text,
  appearance jsonb,
  featured_badges text[],
  name_color text,
  banner_color text,
  wins bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select gr.user_id, p.username, p.appearance, p.featured_badges,
         p.name_color, p.banner_color, count(*) as wins
  from game_results gr
  join profiles p on p.id = gr.user_id
  where gr.won
  group by gr.user_id, p.username, p.appearance, p.featured_badges,
           p.name_color, p.banner_color
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

create or replace function report_player_impl(
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
-- Internal: only the gated wrapper below may call this.
revoke all on function report_player_impl(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function report_player(p_room_id uuid, p_reporter_id uuid, p_reported_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_reporter_id) then raise exception 'forbidden' using errcode='42501'; end if;
  perform report_player_impl(p_room_id, p_reporter_id, p_reported_id, p_reason);
end; $$;
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
create or replace function buy_potion_impl(
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
  v_day int;
  v_se numeric;
  v_dead boolean; v_prison boolean; v_hospital boolean;
  v_cost numeric;
  v_target_role text;
  v_target_dead boolean;
  v_armed boolean;
begin
  select p.room_id, r.phase, r.day, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_phase, v_day, v_se, v_dead, v_prison, v_hospital
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
    when 'eye'           then 150
    when 'vote_reveal'   then 100
    when 'minigame_mult' then 60
    when 'iron_will'     then 200
    when 'comms'         then 100
    else null end;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion');
  end if;
  -- Iron Will is only sold from round 2 onwards (migration 075).
  if p_potion = 'iron_will' and coalesce(v_day, 1) < 2 then
    return jsonb_build_object('ok', false, 'error', 'not_round_2');
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

  -- Iron Will (arm once): your imprisonment vote counts double this consultation.
  if p_potion = 'iron_will' then
    select potion_iron_will into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_iron_will = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Communication (arm once): next outreach you may message ANY player
  -- instead of your single locked partner, and reports can't mute you.
  if p_potion = 'comms' then
    select potion_comms into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_comms = true
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

  -- Revealing Eye (instant info, repeatable): how many Vices/Virtues are still
  -- active. Returned to the BUYER only — no flag stored.
  if p_potion = 'eye' then
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object(
      'ok', true,
      'vices', (
        select count(*) from players p join player_secrets s on s.player_id = p.id
        where p.room_id = v_room_id and not p.dead and not p.in_prison and not p.in_hospital
          and vv_role_camp(s.role) = 'vice'
      ),
      'virtues', (
        select count(*) from players p join player_secrets s on s.player_id = p.id
        where p.room_id = v_room_id and not p.dead and not p.in_prison and not p.in_hospital
          and vv_role_camp(s.role) = 'virtue'
      )
    );
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
-- Internal: only the gated wrapper below may call this.
revoke all on function buy_potion_impl(uuid, text, uuid) from public, anon, authenticated;

create or replace function buy_potion(p_player_id uuid, p_potion text, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return buy_potion_impl(p_player_id, p_potion, p_target);
end; $$;
grant execute on function buy_potion(uuid, text, uuid) to anon, authenticated;

-- contribute_release (migration 092) — put 100 SE toward a prisoner's communal
-- 500-SE release pool (persists across market phases); frees them at 500.
create or replace function contribute_release_impl(p_player_id uuid, p_prisoner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_se numeric;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_pin boolean; v_pdead boolean; v_pool numeric; v_freed boolean := false;
  v_user uuid;
begin
  select p.room_id, r.phase, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_phase is distinct from 'store' then
    return jsonb_build_object('ok', false, 'error', 'not_store');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;

  select in_prison, dead into v_pin, v_pdead
  from players where id = p_prisoner and room_id = v_room for update;
  if not found or v_pdead or not v_pin then
    return jsonb_build_object('ok', false, 'error', 'not_prisoner');
  end if;

  update players set soul_energy = soul_energy - 100 where id = p_player_id;
  update players set release_pool = release_pool + 100
  where id = p_prisoner returning release_pool into v_pool;

  if v_pool >= 500 then
    update players set in_prison = false, release_pool = 0 where id = p_prisoner;
    select user_id into v_user from players where id = p_prisoner;
    if v_user is not null then
      insert into user_achievements (user_id, key)
      values (v_user, 'freed_prison') on conflict do nothing;
    end if;
    v_freed := true;
    v_pool := 0;
  end if;

  return jsonb_build_object('ok', true, 'freed', v_freed, 'pool', v_pool);
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function contribute_release_impl(uuid, uuid) from public, anon, authenticated;

create or replace function contribute_release(p_player_id uuid, p_prisoner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return contribute_release_impl(p_player_id, p_prisoner);
end; $$;
grant execute on function contribute_release(uuid, uuid) to anon, authenticated;

-- enter_store (migration 092) — open the store + grant +50 SE to every
-- non-imprisoned, non-dead player (hospital included). Idempotent.
create or replace function enter_store_impl(p_room_id uuid, p_ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select phase from rooms where id = p_room_id) = 'store' then
    return;
  end if;
  update players set soul_energy = soul_energy + 50
  where room_id = p_room_id and not in_prison and not dead;
  update player_secrets s set potion_comms = false
  from players p where p.id = s.player_id and p.room_id = p_room_id
    and s.potion_comms;
  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'store', phase_ends_at = p_ends_at where id = p_room_id;
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function enter_store_impl(uuid, timestamptz) from public, anon, authenticated;

create or replace function enter_store(p_room_id uuid, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform enter_store_impl(p_room_id, p_ends_at);
end; $$;
grant execute on function enter_store(uuid, timestamptz) to anon, authenticated;

-- The caller's own armed potions, for the store UI's "bought" state.
create or replace function my_potions_impl(p_player_id uuid)
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
    'vote_reveal',   coalesce(potion_vote_reveal, false),
    'iron_will',     coalesce(potion_iron_will, false),
    'comms',         coalesce(potion_comms, false)
  )
  from player_secrets where player_id = p_player_id;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function my_potions_impl(uuid) from public, anon, authenticated;

create or replace function my_potions(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_potions_impl(p_player_id);
end; $$;
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

  -- Gambling's roll-of-2 flag (migration 078) is normally cleared at submit;
  -- clear it room-wide here too so a gambler who couldn't submit (dead /
  -- hospitalised at minigame time) never carries a stale "score 0" into a
  -- later round.
  update player_secrets set minigame_no_score = false
  where player_id in (select id from players where room_id = p_room_id)
    and minigame_no_score;

  return v_ids;
end;
$$;
grant execute on function consume_minigame_mult(uuid) to anon, authenticated;

-- Vote-reveal potion (migration 060): who is voting to imprison the caller.
-- Gated on the armed flag + the consultation phase (during group-action,
-- player_secrets.vote holds eye/free choices, not imprisonment votes). Returns
-- the voters' player ids; the client maps them to display names.
create or replace function my_voters_impl(p_player_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function my_voters_impl(uuid) from public, anon, authenticated;

create or replace function my_voters(p_player_id uuid) returns uuid[]
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_voters_impl(p_player_id);
end; $$;
grant execute on function my_voters(uuid) to anon, authenticated;

-- ============================================
-- The Quiz — a three-way choice (migration 122)
-- ============================================
-- Replaces the tag-everyone Quiz. Each round a player picks ONE: 'points' (100
-- SE), 'hint' (50 SE + "A and B are on opposite sides" OR "at least one of A
-- and B is a <camp>", server-random, Vice/Virtue players only), or 'peek' (0 SE,
-- see one living player's camp; anomalies read 'neutral'). Pride's dazzle and
-- Gambling's roll-of-2 zero the points; the x2 multiplier doubles them. The old
-- tagging functions above (submit_minigame_guesses, compute_minigame_clue,
-- apply_minigame_awards, consume_minigame_mult, diligence_count) are unused.

create or replace function vv_random_pick(p_ids uuid[])
returns uuid
language sql
volatile
as $$
  select case
    when coalesce(array_length(p_ids, 1), 0) = 0 then null
    else p_ids[1 + floor(random() * array_length(p_ids, 1))::int]
  end;
$$;

create or replace function submit_quiz_choice_impl(
  p_player_id uuid,
  p_choice text,
  p_target uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_phase text; v_day integer; v_pride text;
  v_quiz jsonb; v_no_score boolean;
  v_points integer;
  v_dazzled boolean := false;
  v_hint jsonb;
  v_peek jsonb;
  v_vices uuid[]; v_virtues uuid[]; v_all uuid[];
  v_a uuid; v_b uuid; v_tmp uuid;
  v_camp text;
  v_target_role text;
begin
  select room_id, dead, in_prison, in_hospital
    into v_room, v_dead, v_prison, v_hosp
    from players where id = p_player_id
    for update;
  if v_room is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select phase, day, pride_target into v_phase, v_day, v_pride
    from rooms where id = v_room;
  if v_phase is distinct from 'minigame' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;

  select quiz, coalesce(minigame_no_score, false)
    into v_quiz, v_no_score
    from player_secrets where player_id = p_player_id;
  if v_quiz is not null and (v_quiz->>'day')::int = v_day then
    return jsonb_build_object('ok', true, 'quiz', v_quiz);
  end if;

  if p_choice = 'points' then
    v_points := 100;

  elsif p_choice = 'hint' then
    v_points := 50;
    select coalesce(array_agg(p.id) filter (where vv_role_camp(s.role) = 'vice'), '{}'),
           coalesce(array_agg(p.id) filter (where vv_role_camp(s.role) = 'virtue'), '{}')
      into v_vices, v_virtues
      from players p join player_secrets s on s.player_id = p.id
     where p.room_id = v_room and p.id <> p_player_id and not p.dead;
    v_all := v_vices || v_virtues;

    if coalesce(array_length(v_all, 1), 0) >= 2 then
      if coalesce(array_length(v_vices, 1), 0) > 0
         and coalesce(array_length(v_virtues, 1), 0) > 0
         and random() < 0.5 then
        v_a := vv_random_pick(v_vices);
        v_b := vv_random_pick(v_virtues);
        v_hint := jsonb_build_object('kind', 'opposite');
      else
        if coalesce(array_length(v_vices, 1), 0) = 0 then
          v_camp := 'virtue';
        elsif coalesce(array_length(v_virtues, 1), 0) = 0 then
          v_camp := 'vice';
        elsif random() < 0.5 then
          v_camp := 'vice';
        else
          v_camp := 'virtue';
        end if;
        v_a := vv_random_pick(case when v_camp = 'vice' then v_vices else v_virtues end);
        v_b := vv_random_pick(array_remove(v_all, v_a));
        v_hint := jsonb_build_object('kind', 'at_least', 'camp', v_camp);
      end if;
      if random() < 0.5 then
        v_tmp := v_a; v_a := v_b; v_b := v_tmp;
      end if;
      v_hint := v_hint || jsonb_build_object('a', v_a, 'b', v_b);
    end if;

  elsif p_choice = 'peek' then
    v_points := 0;
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    select s.role into v_target_role
      from players p left join player_secrets s on s.player_id = p.id
     where p.id = p_target and p.room_id = v_room and not p.dead;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'bad_target');
    end if;
    v_camp := vv_role_camp(v_target_role);
    if v_camp is null or v_camp not in ('vice', 'virtue') then
      v_camp := 'neutral';
    end if;
    v_peek := jsonb_build_object('target', p_target, 'camp', v_camp);

  else
    return jsonb_build_object('ok', false, 'reason', 'bad_choice');
  end if;

  if v_points > 0 and ((v_pride is not null and v_pride = p_player_id::text) or v_no_score) then
    v_points := 0;
    v_dazzled := true;
  end if;

  v_quiz := jsonb_build_object(
    'day', v_day,
    'choice', p_choice,
    'points', v_points,
    'dazzled', v_dazzled,
    'hint', v_hint,
    'peek', v_peek
  );

  update player_secrets set quiz = v_quiz, minigame_no_score = false
   where player_id = p_player_id;
  update players set ready = true, minigame_submitted_at = now()
   where id = p_player_id;

  return jsonb_build_object('ok', true, 'quiz', v_quiz);
end;
$$;
-- Internal: only the gated wrapper below and run_bots may call this.
revoke all on function submit_quiz_choice_impl(uuid, text, uuid) from public, anon, authenticated;

create or replace function submit_quiz_choice(
  p_player_id uuid,
  p_choice text,
  p_target uuid default null
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
  return submit_quiz_choice_impl(p_player_id, p_choice, p_target);
end;
$$;
grant execute on function submit_quiz_choice(uuid, text, uuid) to anon, authenticated;

create or replace function my_quiz(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_quiz jsonb; v_day integer;
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select s.quiz, r.day into v_quiz, v_day
    from players p
    join rooms r on r.id = p.room_id
    left join player_secrets s on s.player_id = p.id
   where p.id = p_player_id;
  if v_quiz is null or (v_quiz->>'day')::int is distinct from v_day then
    return null;
  end if;
  return v_quiz;
end;
$$;
grant execute on function my_quiz(uuid) to anon, authenticated;

create or replace function apply_quiz_awards(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text; v_day integer; v_awarded integer;
  r record;
  v_award integer;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  select phase, day, minigame_awarded_day
    into v_phase, v_day, v_awarded
    from rooms where id = p_room_id
    for update;
  if v_phase is distinct from 'minigame' then return; end if;
  if v_awarded is not distinct from v_day then return; end if;

  for r in
    select s.player_id, s.quiz, coalesce(s.potion_minigame_mult, false) as mult
      from player_secrets s join players p on p.id = s.player_id
     where p.room_id = p_room_id
       and s.quiz is not null
       and (s.quiz->>'day')::int = v_day
  loop
    v_award := coalesce((r.quiz->>'points')::int, 0) * (case when r.mult then 2 else 1 end);
    if v_award > 0 then
      update players set soul_energy = soul_energy + v_award where id = r.player_id;
    end if;
    update player_secrets
       set quiz = r.quiz || jsonb_build_object('awarded', v_award,
                                              'doubled', r.mult and v_award > 0)
     where player_id = r.player_id;
  end loop;

  update player_secrets set potion_minigame_mult = false
   where potion_minigame_mult
     and player_id in (select id from players where room_id = p_room_id);
  update player_secrets set minigame_no_score = false
   where minigame_no_score
     and player_id in (select id from players where room_id = p_room_id);

  update rooms set minigame_awarded_day = v_day where id = p_room_id;
end;
$$;
grant execute on function apply_quiz_awards(uuid) to anon, authenticated;

-- Dead-player spectator (migration 093): the secret per-player snapshot (role,
-- Soul Energy, queued role action, vote, Quiz choice, Market purchases) for
-- every player in the room — only when the CALLER is dead; else {ok:false}.
create or replace function spectator_secrets_impl(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_dead boolean;
  v_players jsonb;
begin
  select room_id, dead into v_room, v_dead from players where id = p_player_id;
  if v_room is null or not coalesce(v_dead, false) then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id,
    'role', s.role,
    'soul_energy', p.soul_energy,
    'pending_action', s.pending_action,
    'pending_target', s.pending_target,
    'vote', s.vote,
    'guesses', s.minigame_guesses,
    'quiz', s.quiz,
    'potions', jsonb_build_object(
      'kill', s.potion_kill_target,
      'hosp', s.potion_hosp_target,
      'protect', coalesce(s.potion_protect, false),
      'mult', coalesce(s.potion_minigame_mult, false),
      'vote_reveal', coalesce(s.potion_vote_reveal, false),
      'iron_will', coalesce(s.potion_iron_will, false)
    )
  ) order by p.created_at), '[]'::jsonb)
  into v_players
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = v_room;

  return jsonb_build_object('ok', true, 'players', v_players);
end;
$$;
-- Internal: only the gated wrapper below may call this.
revoke all on function spectator_secrets_impl(uuid) from public, anon, authenticated;

create or replace function spectator_secrets(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return spectator_secrets_impl(p_player_id);
end; $$;
grant execute on function spectator_secrets(uuid) to anon, authenticated;

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
create or replace function leave_room_impl(p_player_id uuid)
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
-- Internal: only the gated wrapper below may call this.
revoke all on function leave_room_impl(uuid) from public, anon, authenticated;

create or replace function leave_room(p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (vv_is_me(p_player_id)
          or vv_is_host((select room_id from players where id = p_player_id))) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  perform leave_room_impl(p_player_id);
end; $$;
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
  guaranteed_divine_shards integer not null default 0, -- while >0, the next opened fragment is forced Divine (migration 087)
  last_daily_shard_date date,                  -- last day a daily-login shard was granted
  last_first_win_date date,                    -- the day daily_win_count applies to (last day a win-shard was granted)
  daily_win_count integer not null default 0,  -- wins counted on last_first_win_date; first 3 wins/day each mint a shard (migration 077)
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

-- Shop colors a player has bought with Mano (migration 081). World-readable so
-- other players' equipped colors resolve in-game.
create table account_color_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  color text not null,                            -- shop color id (red..black)
  created_at timestamptz not null default now(),
  primary key (user_id, color)
);

alter table account_color_unlocks enable row level security;

create policy "read color unlocks"
  on account_color_unlocks for select
  using (true);

-- Season pass progress (migration 083). start_xp snapshots the account's xp at
-- season launch so season XP = xp - start_xp; tier = floor(season_xp / 300),
-- capped at 50. Claimed tier numbers are tracked per track.
create table account_season (
  user_id uuid primary key references auth.users(id) on delete cascade,
  start_xp integer not null default 0,
  premium boolean not null default false,
  claimed_free integer[] not null default '{}',
  claimed_premium integer[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table account_season enable row level security;
create policy "read own season" on account_season for select using (auth.uid() = user_id);

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

-- Soul Fragment: consume one + grant XP, then roll a five-tier RARITY (migration
-- 084). Each rarity has a Mano + an LP reward; the server picks one at random
-- (50/50). Divine adds a third option (instant role unlock) when a still-locked
-- role exists. Keyed on auth.uid() so a client only opens its own fragments.
--   Earthen 50%: 1/10 · Verdant 28%: 3/30 · Primal 15%: 8/80 ·
--   Noble 6%: 19/190 · Divine 1%: 50/1000 (+ role unlock)
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
  v_pick numeric;
  v_rarity text;
  v_kind text;
  v_amount int := 0;
  v_mano_amt int;
  v_le_amt int;
  v_role text := null;
  v_locked text[];
  v_has_locked boolean;
  v_forced_divine boolean := false;
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker',
    'wrath','love','gambling','determination',
    'fanaticism','generosity','pride','diligence'];
  c_default text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_xp constant int := 50;
begin
  if v_user is null then
    return jsonb_build_object('kind', 'none');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.unopened_shards <= 0 then
    return jsonb_build_object('kind', 'none');
  end if;

  if v_row.guaranteed_divine_shards > 0 then
    -- A pass-granted guaranteed Divine fragment: skip the roll (migration 087).
    v_forced_divine := true;
    v_rarity := 'divine'; v_mano_amt := 50; v_le_amt := 1000;
  else
    -- Roll the rarity tier (Earthen 50 / Verdant 28 / Primal 15 / Noble 6 / Divine 1).
    v_roll := random();
    if v_roll < 0.50 then
      v_rarity := 'earthen'; v_mano_amt := 1;  v_le_amt := 10;
    elsif v_roll < 0.78 then
      v_rarity := 'verdant'; v_mano_amt := 3;  v_le_amt := 30;
    elsif v_roll < 0.93 then
      v_rarity := 'primal';  v_mano_amt := 8;  v_le_amt := 80;
    elsif v_roll < 0.99 then
      v_rarity := 'noble';   v_mano_amt := 19; v_le_amt := 190;
    else
      v_rarity := 'divine';  v_mano_amt := 50; v_le_amt := 1000;
    end if;
  end if;

  -- Still-locked roles a role-unlock could grant (Divine's third option only).
  select array_agg(r) into v_locked
  from unnest(c_all_roles) r
  where not (r = any(c_default))
    and not exists (
      select 1 from account_role_unlocks u
      where u.user_id = v_user and u.role = r
    );
  v_has_locked := v_locked is not null and array_length(v_locked, 1) is not null;

  -- Server picks the reward at random from the rarity's options. Divine offers a
  -- third option (role unlock) at equal weight, but only when something's locked.
  v_pick := random();
  if v_rarity = 'divine' and v_has_locked then
    if v_pick < 1.0/3.0 then
      v_kind := 'role';
    elsif v_pick < 2.0/3.0 then
      v_kind := 'mano'; v_amount := v_mano_amt;
    else
      v_kind := 'le'; v_amount := v_le_amt;
    end if;
  elsif v_pick < 0.5 then
    v_kind := 'mano'; v_amount := v_mano_amt;
  else
    v_kind := 'le'; v_amount := v_le_amt;
  end if;

  if v_kind = 'role' then
    v_role := v_locked[1 + floor(random() * array_length(v_locked, 1))::int];
    insert into account_role_unlocks (user_id, role) values (v_user, v_role)
      on conflict do nothing;
  end if;

  update account_economy set
    unopened_shards = unopened_shards - 1,
    guaranteed_divine_shards = guaranteed_divine_shards - (case when v_forced_divine then 1 else 0 end),
    xp = xp + c_xp,
    life_experience = life_experience + case when v_kind = 'le' then v_amount else 0 end,
    mano = mano + case when v_kind = 'mano' then v_amount else 0 end
  where user_id = v_user
  returning * into v_row;

  return jsonb_build_object(
    'kind', v_kind, 'amount', v_amount, 'role', v_role, 'rarity', v_rarity,
    'xp_gained', c_xp, 'le', v_row.life_experience, 'mano', v_row.mano,
    'xp', v_row.xp, 'unopened_shards', v_row.unopened_shards
  );
end;
$$;

grant execute on function open_soul_shard() to authenticated;

-- Read any account's XP (level is derived client-side) so a visited profile can
-- show that player's current level. account_economy is otherwise read-own only.
-- (migration 088)
create or replace function get_account_xp(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(xp, 0) from account_economy where user_id = p_user;
$$;
grant execute on function get_account_xp(uuid) to anon, authenticated;

-- Batch version: xp totals for a set of users (lobby + outreach level stars).
-- (migration 089)
create or replace function get_account_levels(p_users uuid[])
returns table(user_id uuid, xp integer)
language sql
stable
security definer
set search_path = public
as $$
  select e.user_id, e.xp
  from account_economy e
  where e.user_id = any(p_users);
$$;
grant execute on function get_account_levels(uuid[]) to anon, authenticated;

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
  v_cost int := 1500;
  v_row account_economy;
  c_default text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker','generosity'];
  c_all_roles text[] := array[
    'murder','intoxication','envy','torment','vengeance','vice_worshipper',
    'empathy','justice','certainty','truthfulness','sacrifice','virtue_seeker',
    'wrath','love','gambling','determination','fanaticism','generosity','pride',
    'diligence','greed','sociability','game_master'];
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_role is null or not (p_role = any(c_all_roles)) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_role');
  end if;
  -- Free by default: nothing to buy (previously this would happily take 1500 LP
  -- for a role the account already had).
  if p_role = any(c_default) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  if exists (select 1 from account_role_unlocks where user_id = v_user and role = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;
  if v_row.life_experience < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'cost', v_cost);
  end if;

  update account_economy set life_experience = life_experience - v_cost
  where user_id = v_user;
  insert into account_role_unlocks (user_id, role) values (v_user, p_role)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'role', p_role, 'cost', v_cost);
end;
$$;
grant execute on function unlock_role(text) to authenticated;

-- Host-side, on game-over: per-match XP + first-win-of-the-day shard for every
-- account player. Idempotent per (user, room) via the ledger insert.
-- p_awards = [{ "u": <user_id uuid>, "won": <bool> }, ...]
-- Account level from total XP — mirrors levelFromXp() in src/lib/economy.ts
-- (migration 080). Used for level-up shards + cosmetic-color unlock checks.
create or replace function vv_level_from_xp(p_xp int)
returns int language sql immutable as $$
  select greatest(1, floor((100 + sqrt(100.0 * 100 + 8 * 100 * greatest(0, p_xp))) / 200.0)::int);
$$;

create or replace function grant_match_rewards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_user uuid;
  v_won boolean;
  c_match_xp constant int := 30;
  c_win_bonus constant int := 20;
  c_le_win constant int := 9;
  c_le_loss constant int := 3;
begin
  -- Winners derived from game_results (migration 104), NOT client p_awards, so a
  -- client can't claim win rewards for a loss or mint rewards for a non-participant.
  for rec in
    select user_id, bool_or(won) as won
    from game_results where room_id = p_room_id group by user_id
  loop
    v_user := rec.user_id;
    v_won := rec.won;

    insert into account_match_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;

    if found then
      insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
      -- All CASEs read the OLD row values, so they stay consistent within the
      -- one UPDATE. Shards = first-three-wins-of-day (migration 077) + one per
      -- level crossed by this match's XP gain (migration 080).
      update account_economy set
        xp = xp + c_match_xp + case when v_won then c_win_bonus else 0 end,
        life_experience = life_experience + case when v_won then c_le_win else c_le_loss end,
        unopened_shards = unopened_shards
          + case
              when v_won and (last_first_win_date is null or last_first_win_date < current_date
                              or daily_win_count < 3)
              then 1 else 0 end
          + greatest(0, vv_level_from_xp(xp + c_match_xp + case when v_won then c_win_bonus else 0 end)
                        - vv_level_from_xp(xp)),
        daily_win_count = case
          when not v_won then daily_win_count
          when last_first_win_date is null or last_first_win_date < current_date then 1
          when daily_win_count < 3 then daily_win_count + 1
          else daily_win_count end,
        last_first_win_date = case when v_won then current_date else last_first_win_date end
      where user_id = v_user;
    end if;
  end loop;
end;
$$;

grant execute on function grant_match_rewards(uuid, jsonb) to anon, authenticated;

-- Steam Microtransactions (migration 105): the backend (steam-purchase Edge
-- Function, holds the Steam publisher key) credits a finalized purchase here,
-- server-side, after Steam confirms. Idempotent per order id; backend-only.
create table if not exists steam_purchases (
  order_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  package text not null,
  created_at timestamptz not null default now()
);
alter table steam_purchases enable row level security; -- no client policies

create or replace function credit_steam_purchase(p_user uuid, p_package text, p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mano int;
begin
  if p_user is null or p_package is null or p_order is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_args');
  end if;
  insert into steam_purchases (order_id, user_id, package)
  values (p_order, p_user, p_package) on conflict (order_id) do nothing;
  if not found then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  insert into account_economy (user_id) values (p_user) on conflict (user_id) do nothing;
  v_mano := case p_package
    when 'mano_150' then 150 when 'mano_450' then 450 when 'mano_1000' then 1000
    when 'mano_2200' then 2200 when 'mano_6000' then 6000 else -1 end;
  if v_mano >= 0 then
    update account_economy set mano = mano + v_mano where user_id = p_user;
    return jsonb_build_object('ok', true, 'mano', v_mano);
  end if;
  if p_package = 'founder' then
    update account_economy set life_experience = life_experience + 4000, mano = mano + 1000
      where user_id = p_user;
    insert into account_color_unlocks (user_id, color) values (p_user, 'pioneer') on conflict do nothing;
    insert into account_color_unlocks (user_id, color) values (p_user, 'founder') on conflict do nothing;
    return jsonb_build_object('ok', true, 'pack', 'founder');
  end if;
  delete from steam_purchases where order_id = p_order;
  return jsonb_build_object('ok', false, 'reason', 'unknown_package');
end; $$;
revoke all on function credit_steam_purchase(uuid, text, text) from public, anon, authenticated;
grant execute on function credit_steam_purchase(uuid, text, text) to service_role;

-- Equip (or clear) a name/banner color the caller has earned by level
-- (migration 080). p_kind is 'name' or 'banner'; p_tier is a tier id
-- (earthen..divine) or null to reset to the default. Rejects a tier the
-- account's level hasn't unlocked (name: 5/15/25/35/45; banner: 10/20/30/40/50).
-- Spend 200 Mano to unlock a shop color for both slots (migration 081).
create or replace function buy_color(p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_mano int;
  c_price constant int := 200;
  c_colors text[] := array['red','orange','yellow','green','blue','indigo','violet','grey','white','black'];
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not (p_color = any(c_colors)) then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if exists (select 1 from account_color_unlocks where user_id = v_user and color = p_color) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select mano into v_mano from account_economy where user_id = v_user for update;
  if coalesce(v_mano, 0) < c_price then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'mano', coalesce(v_mano, 0));
  end if;

  update account_economy set mano = mano - c_price where user_id = v_user returning mano into v_mano;
  insert into account_color_unlocks (user_id, color) values (v_user, p_color) on conflict do nothing;
  return jsonb_build_object('ok', true, 'color', p_color, 'mano', v_mano);
end; $$;
grant execute on function buy_color(text) to authenticated;

-- Spend 1000 Mano for the one-time Founder Pack (migration 082): +4000 LP and
-- the 'pioneer' banner + 'founder' name cosmetics. The 'pioneer' unlock marks
-- ownership so the LP can't be farmed.
create or replace function buy_founder_pack()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_mano int;
  v_le int;
  c_price constant int := 1000;
  c_lp constant int := 4000;
  c_mano constant int := 1000; -- Mano granted by the pack (migration 086)
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  if exists (select 1 from account_color_unlocks where user_id = v_user and color = 'pioneer') then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  select mano into v_mano from account_economy where user_id = v_user for update;
  if coalesce(v_mano, 0) < c_price then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'mano', coalesce(v_mano, 0));
  end if;
  update account_economy
    set mano = mano - c_price + c_mano, life_experience = life_experience + c_lp
  where user_id = v_user
  returning mano, life_experience into v_mano, v_le;
  insert into account_color_unlocks (user_id, color)
  values (v_user, 'pioneer'), (v_user, 'founder')
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'mano', v_mano, 'le', v_le, 'lp_granted', c_lp, 'mano_granted', c_mano);
end; $$;
grant execute on function buy_founder_pack() to authenticated;

-- Equip a name/banner color: a level tier (gated by level), an owned shop color
-- (either slot, migration 081), or an owned founder-pack cosmetic ('founder'
-- name / 'pioneer' banner, slot-specific, migration 082). Null clears the slot.
create or replace function set_cosmetic_color(p_kind text, p_tier text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_level int;
  v_needed int;
  c_tiers text[] := array['earthen','verdant','primal','noble','divine'];
  c_colors text[] := array['red','orange','yellow','green','blue','indigo','violet','grey','white','black'];
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_kind not in ('name', 'banner') then return jsonb_build_object('ok', false, 'reason', 'kind'); end if;

  if p_tier is null then
    if p_kind = 'name' then update profiles set name_color = null where id = v_user;
    else update profiles set banner_color = null where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Special owned cosmetics (Founder pack + season pass), slot-specific.
  -- name: 'founder' / 'firstsouls'; banner: 'pioneer' / 'spirit'.
  if p_tier in ('founder', 'pioneer', 'firstsouls', 'spirit') then
    if (p_tier in ('founder', 'firstsouls') and p_kind <> 'name')
       or (p_tier in ('pioneer', 'spirit') and p_kind <> 'banner') then
      return jsonb_build_object('ok', false, 'reason', 'slot');
    end if;
    if not exists (select 1 from account_color_unlocks where user_id = v_user and color = p_tier) then
      return jsonb_build_object('ok', false, 'reason', 'unowned');
    end if;
    if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
    else update profiles set banner_color = p_tier where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Shop colors: equippable for either slot once bought.
  if p_tier = any(c_colors) then
    if not exists (select 1 from account_color_unlocks where user_id = v_user and color = p_tier) then
      return jsonb_build_object('ok', false, 'reason', 'unowned');
    end if;
    if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
    else update profiles set banner_color = p_tier where id = v_user; end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Level tiers: gated by account level.
  if not (p_tier = any(c_tiers)) then
    return jsonb_build_object('ok', false, 'reason', 'tier');
  end if;
  select vv_level_from_xp(coalesce(xp, 0)) into v_level
  from account_economy where user_id = v_user;
  v_level := coalesce(v_level, 1);
  v_needed := case when p_kind = 'name' then
      case p_tier when 'earthen' then 5 when 'verdant' then 15 when 'primal' then 25
                  when 'noble' then 35 when 'divine' then 45 end
    else
      case p_tier when 'earthen' then 10 when 'verdant' then 20 when 'primal' then 30
                  when 'noble' then 40 when 'divine' then 50 end
    end;
  if v_level < v_needed then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'level', v_level, 'needed', v_needed);
  end if;
  if p_kind = 'name' then update profiles set name_color = p_tier where id = v_user;
  else update profiles set banner_color = p_tier where id = v_user; end if;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function set_cosmetic_color(text, text) to authenticated;

-- ============================================
-- Season pass "The First Souls" (migration 083)
-- ============================================
create or replace function vv_season_tier(p_xp int, p_start int)
returns int language sql immutable as $$
  select least(50, greatest(0, floor((greatest(0, p_xp - p_start)) / 300.0)::int));
$$;

create or replace function get_season()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_xp int; v_start int; v_premium boolean; v_cf int[]; v_cp int[];
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select coalesce(xp, 0) into v_xp from account_economy where user_id = v_user;
  insert into account_season (user_id, start_xp) values (v_user, v_xp) on conflict (user_id) do nothing;
  select start_xp, premium, claimed_free, claimed_premium
    into v_start, v_premium, v_cf, v_cp
  from account_season where user_id = v_user;
  return jsonb_build_object(
    'ok', true,
    'tier', vv_season_tier(v_xp, v_start),
    'premium', v_premium,
    'season_xp', greatest(0, v_xp - v_start),
    'claimed_free', to_jsonb(v_cf),
    'claimed_premium', to_jsonb(v_cp)
  );
end; $$;
grant execute on function get_season() to authenticated;

create or replace function buy_season_premium()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_mano int; c_price constant int := 1000;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  insert into account_season (user_id, start_xp)
    values (v_user, (select coalesce(xp, 0) from account_economy where user_id = v_user))
  on conflict (user_id) do nothing;
  if (select premium from account_season where user_id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  select mano into v_mano from account_economy where user_id = v_user for update;
  if coalesce(v_mano, 0) < c_price then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'mano', coalesce(v_mano, 0));
  end if;
  update account_economy set mano = mano - c_price where user_id = v_user returning mano into v_mano;
  update account_season set premium = true where user_id = v_user;
  return jsonb_build_object('ok', true, 'mano', v_mano);
end; $$;
grant execute on function buy_season_premium() to authenticated;

create or replace function claim_season_tier(p_tier int, p_premium boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_xp int; v_start int; v_premium boolean; v_cf int[]; v_cp int[]; v_tier int; v_kind text;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_tier < 1 or p_tier > 50 then return jsonb_build_object('ok', false, 'reason', 'tier'); end if;
  select coalesce(xp, 0) into v_xp from account_economy where user_id = v_user;
  insert into account_season (user_id, start_xp) values (v_user, v_xp) on conflict (user_id) do nothing;
  select start_xp, premium, claimed_free, claimed_premium
    into v_start, v_premium, v_cf, v_cp
  from account_season where user_id = v_user for update;

  v_tier := vv_season_tier(v_xp, v_start);
  if p_tier > v_tier then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if p_premium and not v_premium then return jsonb_build_object('ok', false, 'reason', 'no_premium'); end if;
  if (p_premium and p_tier = any(v_cp)) or (not p_premium and p_tier = any(v_cf)) then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;

  if p_premium and p_tier = 1 then
    insert into account_color_unlocks (user_id, color)
    values (v_user, 'spirit'), (v_user, 'firstsouls')
    on conflict do nothing;
    v_kind := 'cosmetic';
  elsif p_premium and p_tier = 50 then
    insert into user_achievements (user_id, key) values (v_user, 'pass_s1_premium') on conflict do nothing;
    v_kind := 'badge';
  elsif (not p_premium) and p_tier = 50 then
    -- Free tier 50: a fragment guaranteed to open as Divine (migration 087).
    update account_economy
      set unopened_shards = unopened_shards + 1,
          guaranteed_divine_shards = guaranteed_divine_shards + 1
    where user_id = v_user;
    v_kind := 'divine_fragment';
  else
    v_kind := (array['fragment','lp','mano'])[((p_tier - 1) % 3) + 1];
    if v_kind = 'fragment' then
      update account_economy set unopened_shards = unopened_shards + 1 where user_id = v_user;
    elsif v_kind = 'lp' then
      update account_economy set life_experience = life_experience + 100 where user_id = v_user;
    else
      update account_economy set mano = mano + 10 where user_id = v_user;
    end if;
  end if;

  if p_premium then
    update account_season set claimed_premium = array_append(claimed_premium, p_tier) where user_id = v_user;
  else
    update account_season set claimed_free = array_append(claimed_free, p_tier) where user_id = v_user;
  end if;

  return jsonb_build_object('ok', true, 'kind', v_kind);
end; $$;
grant execute on function claim_season_tier(int, boolean) to authenticated;

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
    when 'wrath' then 'S'         when 'love' then 'S'
    when 'intoxication' then 'A'  when 'justice' then 'A'
    when 'gambling' then 'A'      when 'determination' then 'A'
    when 'envy' then 'B'          when 'certainty' then 'B'
    when 'fanaticism' then 'B'    when 'generosity' then 'B'
    when 'torment' then 'C'       when 'vengeance' then 'C'
    when 'truthfulness' then 'C'  when 'sacrifice' then 'C'
    when 'pride' then 'C'         when 'diligence' then 'C'
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
create or replace function ranked_form_match(p_mode text, p_n integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users uuid[];
  -- Same guaranteed-pair-then-shuffle rule as the casual deal, sliced to the
  -- mode's seat count. p_n = 5 (5v5) leaves one filler seat per camp.
  v_vice_classes text[] := (array['exterminator']
    || (select array_agg(c order by random())
        from unnest(array['troublemaker','obstructor','manipulator']) c))[1:p_n];
  v_virtue_classes text[] := (array['protector']
    || (select array_agg(c order by random())
        from unnest(array['communicator','seeker','catalyst']) c))[1:p_n];
  v_class text; v_camp text; v_filler text;
  v_code text; v_room_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_i int; v_name text; v_player_id uuid; v_user uuid;
begin
  select array_agg(user_id order by random()) into v_users
  from (select user_id from ranked_queue
        where status = 'waiting' and mode = p_mode
        order by joined_at limit 2 * p_n) q;

  if coalesce(array_length(v_users, 1), 0) < 2 * p_n then return null; end if;

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
    v_camp := case when v_i <= p_n then 'vice' else 'virtue' end;
    v_class := case when v_i <= p_n then v_vice_classes[v_i]
                    else v_virtue_classes[v_i - p_n] end;
    -- A seat past the four classes is a filler: deal the role outright so the
    -- player isn't sent to role_select with nothing to pick (mirrors casual).
    v_filler := case when v_class is null then
      case when v_camp = 'virtue' then 'virtue_seeker' else 'vice_worshipper' end
    end;
    insert into player_secrets (player_id, role, role_choice, assigned_camp, assigned_class)
    values (v_player_id, v_filler, v_filler, v_camp, v_class);
    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_users);

  return v_code;
end; 
$$;
grant execute on function ranked_form_match(text, integer) to anon, authenticated;
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
-- tier. Tentative pick (p_lock=false) or final lock (p_lock=true). The role
-- must match the dealt camp + tier; roles beyond the default 12 also need to
-- be unlocked on the caller's account (migration 065). Guests get the 12.
create or replace function select_role_impl(p_player_id uuid, p_role text, p_lock boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_class text; v_locked boolean;
  v_user uuid;
  c_default text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker','generosity'];  -- generosity is free so Protectors has a
                                    -- free option like every other class
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_class,
         (s.role is not null), p.user_id
    into v_room, v_phase, v_camp, v_class, v_locked, v_user
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_locked then
    return false;
  end if;
  -- The anomaly seat (camp 'neutral') has no class: it picks among the anomaly
  -- roles instead. Anomalies are outside the unlock economy, so no ownership
  -- check applies to them.
  if v_camp = 'neutral' then
    if vv_role_camp(p_role) is distinct from 'neutral' then
      return false;
    end if;
    -- The Wandering Soul stays FREE so the anomaly seat always has something it
    -- can legally pick; every other anomaly must be unlocked on the account.
    -- Without that guarantee a free player dealt this seat would face an empty
    -- picker — the same trap the Protectors class had before Generosity was
    -- made free.
    if p_role <> 'wandering_soul' then
      if v_user is null or not exists (
        select 1 from account_role_unlocks u
        where u.user_id = v_user and u.role = p_role
      ) then
        return false;
      end if;
    end if;
    update player_secrets
    set role_choice = p_role,
        role = case when p_lock then p_role else role end,
        -- The Game Master's three lives are part of the role, so they're granted
        -- the moment it's locked in rather than at some later phase hook.
        extra_lives = case when p_lock and p_role = 'game_master'
                           then 3 else extra_lives end
    where player_id = p_player_id;
    return true;
  end if;

  -- Must be a real role matching the dealt camp + CLASS (an unknown id yields
  -- null from both lookups and fails either comparison). A filler seat has a
  -- null class and its role is already locked, so it never reaches here.
  if vv_role_camp(p_role) is distinct from v_camp
     or vv_role_class(p_role) is distinct from v_class then
    return false;
  end if;
  -- Beyond the default set, the player's account must have unlocked the role.
  if not (p_role = any(c_default)) then
    if v_user is null or not exists (
      select 1 from account_role_unlocks u
      where u.user_id = v_user and u.role = p_role
    ) then
      return false;
    end if;
  end if;

  update player_secrets
  set role_choice = p_role,
      role = case when p_lock then p_role else role end
  where player_id = p_player_id;
  return true;
end;
$$;
revoke all on function select_role_impl(uuid, text, boolean) from public, anon, authenticated;

create or replace function select_role(p_player_id uuid, p_role text, p_lock boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return select_role_impl(p_player_id, p_role, p_lock);
end; $$;
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
  v_room uuid; v_phase text; v_camp text; v_class text; v_choice text; v_locked boolean;
  v_team jsonb;
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_class, s.role_choice, (s.role is not null)
    into v_room, v_phase, v_camp, v_class, v_choice, v_locked
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_camp is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'class', t.assigned_class, 'choice', t.role_choice,
           'locked', t.locked, 'me', t.me)
           order by t.rank, t.created_at), '[]'::jsonb)
    into v_team
  from (
    select s.assigned_class, s.role_choice, (s.role is not null) as locked,
           (p.id = p_player_id) as me, p.created_at,
           -- Display order = the canonical class-pair order (the same top-to-
           -- bottom order as the Roles tab), NOT the shuffled deal order, so the
           -- team panel doesn't reshuffle between games. Filler seats sort last.
           case s.assigned_class
                when 'exterminator' then 0 when 'protector' then 0
                when 'troublemaker' then 1 when 'communicator' then 1
                when 'obstructor' then 2 when 'seeker' then 2
                when 'manipulator' then 3 when 'catalyst' then 3
                else 4 end as rank
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = v_room and s.assigned_camp = v_camp
  ) t;

  return jsonb_build_object(
    'camp', v_camp, 'class', v_class, 'choice', v_choice, 'locked', v_locked,
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
create or replace function resolve_role_select_impl(p_room_id uuid)
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
    'virtue_seeker','generosity'];
begin
  select phase into v_phase from rooms where id = p_room_id;
  if v_phase is distinct from 'role_select' then return; end if;

  for r in
    select p.id, s.assigned_camp, s.assigned_class, s.role_choice
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is null
  loop
    v_role := r.role_choice;
    if v_role is null and r.assigned_camp = 'neutral' then
      -- An anomaly who never picked gets a random one they can actually USE:
      -- the free Soul always, plus any anomaly their account has unlocked.
      -- Handing someone a role they don't own would quietly give away a 1500 LP
      -- purchase.
      select x into v_role
      from unnest(array['wandering_soul','game_master']) x
      where x = 'wandering_soul'
         or exists (
           select 1 from players p2
           join account_role_unlocks u on u.user_id = p2.user_id and u.role = x
           where p2.id = r.id
         )
      order by random() limit 1;
    end if;
    if v_role is null then
      select x into v_role from unnest(c_playable) x
      where vv_role_camp(x) = r.assigned_camp and vv_role_class(x) = r.assigned_class
      order by random() limit 1;
    end if;
    if v_role is null then
      v_role := case when r.assigned_camp = 'virtue'
                     then 'virtue_seeker' else 'vice_worshipper' end;
    end if;
    update player_secrets
    set role = v_role, role_choice = v_role,
        extra_lives = case when v_role = 'game_master' then 3 else extra_lives end
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
revoke all on function resolve_role_select_impl(uuid) from public, anon, authenticated;

create or replace function resolve_role_select(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform resolve_role_select_impl(p_room_id);
end; $$;
grant execute on function resolve_role_select(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Steam sign-in (migration 110)
-- ---------------------------------------------------------------------------
-- SteamID -> auth user, written only by the steam-auth Edge Function (service
-- role). No client policies. See db/110_steam_auth.sql for the full rationale.
create table if not exists steam_accounts (
  steam_id   text primary key,
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table steam_accounts enable row level security;

-- Claim a username for an account that has none yet (the Steam first-launch
-- step), creating the three rows handle_new_user() skips for username-less
-- users. Guests (anonymous sessions) may not mint accounts.
create or replace function set_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_username, ''));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous');
  end if;
  if v_name !~ '^[A-Za-z0-9_]{3,20}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from profiles where id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'has_profile');
  end if;

  begin
    insert into profiles (id, username) values (v_uid, v_name);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;

  insert into account_economy (user_id) values (v_uid) on conflict (user_id) do nothing;
  insert into account_ranked  (user_id) values (v_uid) on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true, 'username', v_name);
end;
$$;
grant execute on function set_username(text) to authenticated;

-- Mano -> Life Proficiency conversion (migration 111).
create or replace function convert_mano_to_lp(p_mano int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lp  int;
  v_bal int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_lp := case p_mano
    when 100  then 300
    when 500  then 1650
    when 1000 then 3600
    else null end;
  if v_lp is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_tier');
  end if;

  select mano into v_bal from account_economy where user_id = v_uid;
  if v_bal is null or v_bal < p_mano then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_mano');
  end if;

  update account_economy
     set mano = mano - p_mano,
         life_experience = life_experience + v_lp
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'mano', p_mano, 'lp', v_lp);
end;
$$;
grant execute on function convert_mano_to_lp(int) to authenticated;

-- Outreach DM send, with the one-partner-per-cycle lock (migrations 101 + 111).
-- NOTE: send_dm was never mirrored here before; this is its first appearance.
create or replace function send_dm(
  p_room_id uuid, p_sender_id uuid, p_recipient_id uuid, p_day int, p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_dead boolean; v_rec_room uuid;
  v_comms boolean; v_existing uuid;
  v_role text; v_muted boolean; v_muted_day int; v_day int;
begin
  if not vv_is_me(p_sender_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_text is null or length(btrim(p_text)) = 0 then return; end if;
  select room_id, dead into v_room, v_dead from players where id = p_sender_id;
  if v_room is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_room is distinct from p_room_id then raise exception 'wrong room' using errcode = '42501'; end if;
  if v_dead then raise exception 'cannot chat' using errcode = '42501'; end if;
  select room_id into v_rec_room from players where id = p_recipient_id;
  if v_rec_room is distinct from v_room then raise exception 'recipient not in room' using errcode = '42501'; end if;

  select coalesce(s.potion_comms, false), s.role, p.muted, p.ability_muted_day, r.day
    into v_comms, v_role, v_muted, v_muted_day, v_day
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_sender_id;

  -- NEW: mutes enforced server-side. Covers the report auto-mute (previously
  -- client-only) as well as Sociability's.
  --
  -- Deliberately NOT exempted by the Communication potion: letting a purchase
  -- lift a moderation mute would sell a way out of being reported. The potion's
  -- immunity is applied at mute TIME instead — sociability_mute simply doesn't
  -- silence a buyer — so it counters the ability without touching moderation.
  if coalesce(v_muted, false) or v_muted_day is not distinct from v_day then
    raise exception 'muted' using errcode = '42501';
  end if;

  -- One partner per cycle. Sociability is passively exempt (she may write to
  -- everyone, every night), as is a Communication-potion buyer.
  if not coalesce(v_comms, false) and v_role is distinct from 'sociability' then
    select recipient_id into v_existing
    from dm_messages
    where room_id = v_room and sender_id = p_sender_id and day = p_day
    order by created_at
    limit 1;

    if v_existing is not null and v_existing is distinct from p_recipient_id then
      raise exception 'partner locked' using errcode = '42501';
    end if;
  end if;

  insert into dm_messages (room_id, sender_id, recipient_id, day, text)
  values (v_room, p_sender_id, p_recipient_id, p_day, p_text);
end;
$$;
grant execute on function send_dm(uuid, uuid, uuid, int, text) to anon, authenticated;

create or replace function vengeance_revenge_targets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_role text;
  v_prison boolean;
  v_list jsonb;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.in_prison into v_room, v_role, v_prison
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'vengeance' or not v_prison then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name)), '[]'::jsonb)
    into v_list
  from rooms rm
  join players pl on pl.room_id = rm.id and not pl.dead
  where rm.id = v_room and rm.vengeance_imprisoners ? pl.id::text;

  return v_list;
end;
$$;
grant execute on function vengeance_revenge_targets(uuid) to anon, authenticated;

create or replace function queue_vengeance_revenge(p_player_id uuid, p_targets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_se numeric;
  v_role text;
  v_prison boolean;
  v_acted boolean;
  v_count int;
  v_cost numeric;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, p.soul_energy, s.role, p.in_prison, p.acted_this_day
    into v_room, v_se, v_role, v_prison, v_acted
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'vengeance' or not v_prison then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_acted then
    return jsonb_build_object('ok', false, 'reason', 'already_acted');
  end if;
  if p_targets is null or jsonb_typeof(p_targets) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  select count(distinct e) into v_count from jsonb_array_elements_text(p_targets) e;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  -- Every target must be one of HER jailers and still alive. Counting the valid
  -- ones and comparing to the requested count rejects the whole batch if any
  -- single id is bogus, rather than silently charging for a target that can't die.
  if (
    select count(distinct e)
    from jsonb_array_elements_text(p_targets) e
    where exists (select 1 from rooms where id = v_room and vengeance_imprisoners ? e)
      and exists (select 1 from players where id = e::uuid and room_id = v_room and not dead)
  ) <> v_count then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  v_cost := 150 * v_count;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', v_cost);
  end if;

  -- Resolved by resolve_role_action_impl's 'vengeance_kill' branch, so protect
  -- and extra lives apply per target exactly like any other queued kill.
  update player_secrets
     set pending_action = 'vengeance_kill',
         pending_target = (select jsonb_agg(distinct e) from jsonb_array_elements_text(p_targets) e)::text
   where player_id = p_player_id;
  update players
     set soul_energy = soul_energy - v_cost, acted_this_day = true
   where id = p_player_id;

  return jsonb_build_object('ok', true, 'targets', v_count, 'spent', v_cost);
end;
$$;
grant execute on function queue_vengeance_revenge(uuid, jsonb) to anon, authenticated;

create or replace function sociability_mute(p_player_id uuid, p_targets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_se numeric; v_day int;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_phase text;
  v_count int; v_cost numeric;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.soul_energy, r.day, p.dead, p.in_prison, p.in_hospital, r.phase
    into v_room, v_role, v_se, v_day, v_dead, v_prison, v_hosp, v_phase
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'sociability' then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if p_targets is null or jsonb_typeof(p_targets) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  select count(distinct e) into v_count from jsonb_array_elements_text(p_targets) e;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  -- Every target must be a living player in this room, and not herself.
  if (
    select count(distinct e) from jsonb_array_elements_text(p_targets) e
    where e <> p_player_id::text
      and exists (select 1 from players where id = e::uuid and room_id = v_room and not dead)
  ) <> v_count then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  v_cost := 75 * v_count;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', v_cost);
  end if;

  -- The Communication potion grants mute immunity (migration 111), so a buyer
  -- silently shrugs it off — she still pays, and is not told which target held.
  update players p set ability_muted_day = v_day
  where p.room_id = v_room
    and p.id::text in (select e from jsonb_array_elements_text(p_targets) e)
    and not coalesce(
      (select s.potion_comms from player_secrets s where s.player_id = p.id), false);

  update players set soul_energy = soul_energy - v_cost where id = p_player_id;

  return jsonb_build_object('ok', true, 'muted', v_count, 'spent', v_cost);
end;
$$;
grant execute on function sociability_mute(uuid, jsonb) to anon, authenticated;

create or replace function queue_greed(p_player_id uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_se numeric; v_phase text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_acted boolean;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.soul_energy, r.phase, p.dead, p.in_prison, p.in_hospital, p.acted_this_day
    into v_room, v_role, v_se, v_phase, v_dead, v_prison, v_hosp, v_acted
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'greed' then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if v_acted then
    return jsonb_build_object('ok', false, 'reason', 'already_acted');
  end if;
  if p_target is null or p_target = p_player_id
     or not exists (select 1 from players where id = p_target and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', 100);
  end if;

  update player_secrets set greed_target = p_target where player_id = p_player_id;
  update players set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function queue_greed(uuid, uuid) to anon, authenticated;

create or replace function resolve_greed(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_amt numeric;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;

  for r in
    select s.player_id as thief, s.greed_target as victim
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.greed_target is not null
  loop
    -- A Greed who died or was jailed during resolution collects nothing.
    if exists (select 1 from players
               where id = r.thief and not dead and not in_prison and not in_hospital) then
      select soul_energy into v_amt from players
      where id = r.victim and room_id = p_room_id and not dead for update;

      if coalesce(v_amt, 0) > 0 then
        update players set soul_energy = 0 where id = r.victim;
        update players set soul_energy = soul_energy + v_amt where id = r.thief;
        -- Both sides learn what moved; neither learns who the other is, so the
        -- victim can't identify Greed from the notice.
        insert into player_notices (room_id, recipient_id, text) values
          (p_room_id, r.thief,
           format('Your hand closed on %s Soul Energy.', round(v_amt))),
          (p_room_id, r.victim,
           format('Something emptied your purse — %s Soul Energy is gone.', round(v_amt)));
      end if;
    end if;
  end loop;

  update player_secrets s set greed_target = null
  from players p where p.id = s.player_id and p.room_id = p_room_id
    and s.greed_target is not null;
end;
$$;
grant execute on function resolve_greed(uuid) to anon, authenticated;

create or replace function vv_class_camp(p_class text)
returns text
language sql
immutable
as $$
  select case p_class
    when 'exterminator' then 'vice'
    when 'troublemaker' then 'vice'
    when 'obstructor' then 'vice'
    when 'manipulator' then 'vice'
    when 'protector' then 'virtue'
    when 'communicator' then 'virtue'
    when 'seeker' then 'virtue'
    when 'catalyst' then 'virtue'
    else null
  end;
$$;

create or replace function join_queue(
  p_kind text, p_name text, p_pref_vice text, p_pref_virtue text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_kind is null or p_kind not in ('ranked', 'public') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if vv_class_camp(p_pref_vice) is distinct from 'vice'
     or vv_class_camp(p_pref_virtue) is distinct from 'virtue' then
    return jsonb_build_object('ok', false, 'reason', 'bad_preference');
  end if;

  insert into ranked_queue (user_id, mode, name, status, room_code,
                            pref_vice, pref_virtue)
  values (v_user, p_kind, coalesce(nullif(btrim(p_name), ''), 'Player'),
          'waiting', null, p_pref_vice, p_pref_virtue)
  on conflict (user_id) do update
    set mode = excluded.mode,
        name = excluded.name,
        status = 'waiting',
        room_code = null,
        pref_vice = excluded.pref_vice,
        pref_virtue = excluded.pref_virtue,
        -- keep joined_at when already queued for the same kind
        joined_at = case when ranked_queue.mode = excluded.mode
                              and ranked_queue.status = 'waiting'
                         then ranked_queue.joined_at else now() end;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function join_queue(text, text, text, text) to authenticated;

create or replace function leave_queue()
returns void
language sql
security definer
set search_path = public
as $$
  delete from ranked_queue where user_id = auth.uid();
$$;
grant execute on function leave_queue() to authenticated;

create or replace function queue_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ranked', count(*) filter (where mode = 'ranked' and status = 'waiting'),
    'public', count(*) filter (where mode = 'public' and status = 'waiting')
  )
  from ranked_queue;
$$;
grant execute on function queue_counts() to anon, authenticated;

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
  v_pick_s double precision;
  v_lock_s double precision;
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

      -- NOT locked yet (migration 127): seats that locked the instant the game
      -- formed gave the bots away in the anonymous team panel. Each bot shows a
      -- tentative pick after 2-12s and locks 2-12s after that, like a person
      -- deciding; vv_tick_room plays the plan out (vv_bot_role_select_step).
      v_pick_s := 2 + random() * 10;
      v_lock_s := v_pick_s + 2 + random() * 10;
      insert into player_secrets (player_id, role, role_choice, assigned_camp,
                                  assigned_class, bot_memory)
      values (v_player_id, null, null, r.elem ->> 'camp', r.elem ->> 'class',
              jsonb_build_object(
                'plan', v_role,
                'pick_at', now() + make_interval(secs => v_pick_s),
                'lock_at', now() + make_interval(secs => v_lock_s)));
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

create or replace function matchmake()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  if not pg_try_advisory_xact_lock(778899) then
    return null;
  end if;
  v_code := form_match('ranked');
  if v_code is null then
    v_code := form_match('public');
  end if;
  return v_code;
end;
$$;
grant execute on function matchmake() to authenticated;

-- ============================================
-- Bots: memory + camp-aware play (migration 125)
-- ============================================
-- ===========================================================================
-- reveal_self: gated wrapper + impl (body from 056, plus phase/active checks)
-- ===========================================================================
create or replace function reveal_self_impl(p_player_id uuid, p_target_id uuid)
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
  v_name text;
  v_role_name text;
  v_phase text;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role, p.name, r.phase,
         p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_se, v_acted, v_role, v_name, v_phase, v_dead, v_prison, v_hosp
  from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room_id is null or v_role not in ('vice_worshipper','virtue_seeker')
     or v_acted or v_se < 100 or v_phase is distinct from 'role_action'
     or v_dead or v_prison or v_hosp or p_target_id = p_player_id then
    return false;
  end if;

  if not exists (select 1 from players where id = p_target_id and room_id = v_room_id) then
    return false;
  end if;

  v_role_name := case v_role when 'vice_worshipper' then 'Vice Worshipper'
                             else 'Virtue Seeker' end;

  update players
  set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  insert into player_notices (room_id, recipient_id, text)
  values (v_room_id, p_target_id, v_name || ' revealed themselves to you: ' || v_role_name);

  return true;
end;
$$;
revoke all on function reveal_self_impl(uuid, uuid) from public, anon, authenticated;

create or replace function reveal_self(p_player_id uuid, p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return reveal_self_impl(p_player_id, p_target_id);
end;
$$;
grant execute on function reveal_self(uuid, uuid) to anon, authenticated;

-- ===========================================================================
-- Memory
-- ===========================================================================

-- Record a camp the bot now knows for certain.
create or replace function vv_bot_learn(p_bot uuid, p_target uuid, p_camp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp text; v_mem jsonb; c jsonb;
  v_keep jsonb := '[]'::jsonb; v_trust jsonb; v_liars jsonb;
  v_phase text; v_day int;
begin
  if p_bot is null or p_target is null or p_camp is null then return; end if;
  v_camp := case when p_camp in ('vice', 'virtue') then p_camp else 'neutral' end;

  update player_secrets
     set bot_memory = jsonb_set(bot_memory, '{known}',
           coalesce(bot_memory->'known', '{}'::jsonb) || jsonb_build_object(p_target::text, v_camp))
   where player_id = p_bot;

  -- Where it learned it (134), for "How do you know that?". Bots act inside
  -- the phase, so the phase says how: its ability (role action), a camp
  -- reveal potion (store), else the Quiz. The first source is kept.
  select r.phase, r.day into v_phase, v_day
    from players p join rooms r on r.id = p.room_id
   where p.id = p_bot;
  update player_secrets
     set bot_memory = jsonb_set(bot_memory, '{src}',
           coalesce(bot_memory->'src', '{}'::jsonb) || jsonb_build_object(p_target::text,
             jsonb_build_object('how', case v_phase when 'role_action' then 'ability'
                                                    when 'store' then 'market'
                                                    else 'quiz' end,
                                'day', v_day)))
   where player_id = p_bot
     and not (coalesce(bot_memory->'src', '{}'::jsonb) ? p_target::text);

  select bot_memory into v_mem from player_secrets where player_id = p_bot;
  v_trust := coalesce(v_mem->'trust', '{}'::jsonb);
  v_liars := coalesce(v_mem->'liars', '[]'::jsonb);

  for c in select * from jsonb_array_elements(coalesce(v_mem->'claims', '[]'::jsonb)) loop
    if c->>'about' = p_target::text then
      if c->>'from' is null then
        null;   -- told while inked (131): nobody to credit or blame
      elsif c->>'camp' = v_camp then
        v_trust := v_trust || jsonb_build_object(c->>'from',
                     coalesce((v_trust->>(c->>'from'))::numeric, 0) + 1);
      else
        if not (v_liars ? (c->>'from')) then
          v_liars := v_liars || jsonb_build_array(c->>'from');
        end if;
        perform vv_bot_suspect(p_bot, (c->>'from')::uuid, 2);
      end if;
    else
      v_keep := v_keep || jsonb_build_array(c);
    end if;
  end loop;

  -- Merge onto the CURRENT memory (vv_bot_suspect just wrote 'sus').
  update player_secrets
     set bot_memory = bot_memory || jsonb_build_object('claims', v_keep, 'trust', v_trust, 'liars', v_liars)
   where player_id = p_bot;
end;
$$;
revoke all on function vv_bot_learn(uuid, uuid, text) from public, anon, authenticated;

-- Remember a Quiz hint ({kind, camp?, a, b}).
create or replace function vv_bot_hint(p_bot uuid, p_hint jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update player_secrets
     set bot_memory = jsonb_set(
           bot_memory, '{hints}',
           coalesce(bot_memory->'hints', '[]'::jsonb) || jsonb_build_array(p_hint))
   where player_id = p_bot and p_hint is not null and jsonb_typeof(p_hint) = 'object';
$$;
revoke all on function vv_bot_hint(uuid, jsonb) from public, anon, authenticated;

-- Raise (or lower) suspicion of a player.
create or replace function vv_bot_suspect(p_bot uuid, p_target uuid, p_delta numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update player_secrets
     set bot_memory = jsonb_set(
           bot_memory, '{sus}',
           coalesce(bot_memory->'sus', '{}'::jsonb)
             || jsonb_build_object(p_target::text,
                  coalesce((bot_memory->'sus'->>p_target::text)::numeric, 0) + p_delta))
   where player_id = p_bot and p_target is not null and p_target <> p_bot;
$$;
revoke all on function vv_bot_suspect(uuid, uuid, numeric) from public, anon, authenticated;

-- Everything the bot knows for certain, INCLUDING what its hints imply.
create or replace function vv_bot_known(p_bot uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mem jsonb;
  v_known jsonb;
  h jsonb;
  ca text; cb text;
  v_changed boolean;
  v_i int;
begin
  select bot_memory into v_mem from player_secrets where player_id = p_bot;
  v_known := coalesce(v_mem->'known', '{}'::jsonb);

  -- A few passes so one inference can unlock the next.
  for v_i in 1..3 loop
    v_changed := false;
    for h in select * from jsonb_array_elements(coalesce(v_mem->'hints', '[]'::jsonb)) loop
      ca := v_known->>(h->>'a');
      cb := v_known->>(h->>'b');
      if h->>'kind' = 'opposite' then
        if ca in ('vice','virtue') and cb is null then
          v_known := v_known || jsonb_build_object(h->>'b',
                       case when ca = 'vice' then 'virtue' else 'vice' end);
          v_changed := true;
        elsif cb in ('vice','virtue') and ca is null then
          v_known := v_known || jsonb_build_object(h->>'a',
                       case when cb = 'vice' then 'virtue' else 'vice' end);
          v_changed := true;
        end if;
      elsif h->>'kind' = 'at_least' then
        if ca is not null and ca <> (h->>'camp') and cb is null then
          v_known := v_known || jsonb_build_object(h->>'b', h->>'camp');
          v_changed := true;
        elsif cb is not null and cb <> (h->>'camp') and ca is null then
          v_known := v_known || jsonb_build_object(h->>'a', h->>'camp');
          v_changed := true;
        end if;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  return v_known;
end;
$$;
revoke all on function vv_bot_known(uuid) from public, anon, authenticated;

-- ===========================================================================
-- Targeting
-- ===========================================================================

-- An enemy-directed target. Order: a known enemy → the most suspicious unknown
-- → any unknown. Never the bot itself, never a known ally.
--   p_candidates   restrict to these ids (a re-vote's tied players); null = any
--   p_active_only  exclude jailed / hospitalised players
--   p_known_only   only a KNOWN enemy (null if there is none)
--   p_prefer_humans  pick among humans when any qualify (Torment)
create or replace function vv_bot_enemy(
  p_bot uuid,
  p_candidates uuid[] default null,
  p_active_only boolean default true,
  p_known_only boolean default false,
  p_prefer_humans boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_camp text; v_sus jsonb; v_known jsonb;
  v_pool uuid[]; v_humans uuid[]; v_pick uuid; v_max numeric;
begin
  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_camp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  if v_room is null then return null; end if;
  v_known := vv_bot_known(p_bot);

  select coalesce(array_agg(p.id), '{}') into v_pool
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and (not p_active_only or (not p.in_prison and not p.in_hospital))
     and (p_candidates is null or p.id = any(p_candidates))
     and (v_known->>p.id::text) is distinct from v_camp;          -- never an ally

  if p_prefer_humans then
    select coalesce(array_agg(id), '{}') into v_humans
      from players where id = any(v_pool) and not is_bot;
    if coalesce(array_length(v_humans, 1), 0) > 0 then v_pool := v_humans; end if;
  end if;

  -- 1) a known enemy (allies are already out of the pool)
  select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
    from unnest(v_pool) x where v_known ? x::text;
  if v_pick is not null or p_known_only then return v_pick; end if;

  -- 2) the most suspicious of the rest
  select max(coalesce((v_sus->>x::text)::numeric, 0)) into v_max from unnest(v_pool) x;
  if coalesce(v_max, 0) > 0 then
    select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
      from unnest(v_pool) x
     where coalesce((v_sus->>x::text)::numeric, 0) = v_max;
    if v_pick is not null then return v_pick; end if;
  end if;

  -- 3) anyone left — but not someone it BELIEVES is on its side (negative
  --    suspicion, e.g. a believed "I'm a Virtue"), while anyone else qualifies
  --    (migration 129).
  select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
    from unnest(v_pool) x where coalesce((v_sus->>x::text)::numeric, 0) >= 0;
  return coalesce(v_pick, vv_random_pick(v_pool));
end;
$$;
revoke all on function vv_bot_enemy(uuid, uuid[], boolean, boolean, boolean) from public, anon, authenticated;

-- A known, active ally (null if the bot knows none).
create or replace function vv_bot_ally(p_bot uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_camp text; v_known jsonb; v_pick uuid;
begin
  select p.room_id, vv_role_camp(s.role) into v_room, v_camp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_known := vv_bot_known(p_bot);
  select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_pick
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and not p.in_prison and not p.in_hospital
     and (v_known->>p.id::text) = v_camp;
  return v_pick;
end;
$$;
revoke all on function vv_bot_ally(uuid) from public, anon, authenticated;

-- A living player whose camp the bot doesn't know yet (for info abilities).
create or replace function vv_bot_unknown(p_bot uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_known jsonb;
begin
  select room_id into v_room from players where id = p_bot;
  v_known := vv_bot_known(p_bot);
  return (
    select vv_random_pick(coalesce(array_agg(p.id), '{}'))
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not (v_known ? p.id::text)
  );
end;
$$;
revoke all on function vv_bot_unknown(uuid) from public, anon, authenticated;

-- Queue a role action for a bot — the same checks the player-facing
-- queue_action wrapper makes, so a bot can never do what a player couldn't.
create or replace function vv_bot_queue(p_bot uuid, p_cost numeric, p_action text, p_target text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_se numeric; v_dead boolean; v_prison boolean; v_hosp boolean;
        v_phase text; v_acted boolean;
begin
  select s.role, p.soul_energy, p.dead, p.in_prison, p.in_hospital, r.phase, p.acted_this_day
    into v_role, v_se, v_dead, v_prison, v_hosp, v_phase, v_acted
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_role is null or v_phase is distinct from 'role_action' or v_acted
     or v_dead or v_prison or v_hosp or v_se < p_cost or p_target is null then
    return false;
  end if;
  if not (
       (p_action = 'kill'      and v_role in ('murder', 'justice'))
    or (p_action = 'protect'   and v_role = 'justice')
    or (p_action = 'intox'     and v_role in ('intoxication', 'vengeance'))
    or (p_action = 'envy_swap' and v_role = 'envy')
    or (p_action = 'torment'   and v_role = 'torment')
    or (p_action = 'sacrifice' and v_role = 'sacrifice')
    or (p_action like '%guess' and v_role in ('vice_worshipper', 'virtue_seeker'))
  ) then
    return false;
  end if;
  perform queue_action_impl(p_bot, p_cost, p_action, p_target);
  return true;
end;
$$;
revoke all on function vv_bot_queue(uuid, numeric, text, text) from public, anon, authenticated;

-- ===========================================================================
-- Phase actors
-- ===========================================================================

-- Bot economy helpers (migration 128).
-- Memory helpers: set / clear one top-level key of a bot's memory.
create or replace function vv_bot_set(p_bot uuid, p_key text, p_value jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update player_secrets
     set bot_memory = case when p_value is null then bot_memory - p_key
                           else jsonb_set(bot_memory, array[p_key], p_value) end
   where player_id = p_bot;
$$;
revoke all on function vv_bot_set(uuid, text, jsonb) from public, anon, authenticated;

-- A target the bot has REAL information on: a known enemy, else the most
-- suspicious non-ally with suspicion >= p_min_sus. Null when it knows nothing.
create or replace function vv_bot_target(
  p_bot uuid,
  p_active_only boolean default true,
  p_prefer_humans boolean default false,
  p_min_sus numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t uuid; v_room uuid; v_camp text; v_sus jsonb; v_known jsonb;
  v_pool uuid[]; v_humans uuid[]; v_max numeric;
begin
  v_t := vv_bot_enemy(p_bot, null, p_active_only, true, p_prefer_humans);
  if v_t is not null then return v_t; end if;

  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_camp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_known := vv_bot_known(p_bot);

  select coalesce(array_agg(p.id), '{}') into v_pool
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and (not p_active_only or (not p.in_prison and not p.in_hospital))
     and (v_known->>p.id::text) is distinct from v_camp
     and coalesce((v_sus->>p.id::text)::numeric, 0) >= p_min_sus;

  if p_prefer_humans then
    select coalesce(array_agg(id), '{}') into v_humans
      from players where id = any(v_pool) and not is_bot;
    if coalesce(array_length(v_humans, 1), 0) > 0 then v_pool := v_humans; end if;
  end if;

  select max(coalesce((v_sus->>x::text)::numeric, 0)) into v_max from unnest(v_pool) x;
  select vv_random_pick(coalesce(array_agg(x), '{}')) into v_t
    from unnest(v_pool) x
   where coalesce((v_sus->>x::text)::numeric, 0) = v_max;
  return v_t;
end;
$$;
revoke all on function vv_bot_target(uuid, boolean, boolean, numeric) from public, anon, authenticated;

-- Is this bot's camp in danger? From its last Revealing Eye (this day or the
-- one before): outnumbered, or down to its last two. False when it has no
-- recent count (it doesn't know).
create or replace function vv_bot_threatened(p_bot uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_camp text; v_eye jsonb; v_day integer; v_mine int; v_theirs int;
begin
  select vv_role_camp(s.role), s.bot_memory->'eye', r.day
    into v_camp, v_eye, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_eye is null or v_camp not in ('vice', 'virtue')
     or coalesce((v_eye->>'day')::int, 0) < v_day - 1 then
    return false;
  end if;
  v_mine   := case when v_camp = 'vice' then (v_eye->>'vices')::int else (v_eye->>'virtues')::int end;
  v_theirs := case when v_camp = 'vice' then (v_eye->>'virtues')::int else (v_eye->>'vices')::int end;
  return v_mine < v_theirs or v_mine <= 2;
end;
$$;
revoke all on function vv_bot_threatened(uuid) from public, anon, authenticated;

-- Soul Energy the bot is holding back for its savings goal (0 if none). A goal
-- whose target is dead or jailed, or that is 3+ days old, is dropped.
create or replace function vv_bot_reserve(p_bot uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_goal jsonb; v_day integer; v_alive boolean;
begin
  select s.bot_memory->'goal', r.day into v_goal, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_goal is null then return 0; end if;

  select not dead and not in_prison into v_alive
    from players where id = (v_goal->>'target')::uuid;
  if not coalesce(v_alive, false) or coalesce((v_goal->>'day')::int, 0) < v_day - 2 then
    perform vv_bot_set(p_bot, 'goal', null);
    return 0;
  end if;
  return case v_goal->>'kind' when 'kill' then 300 when 'hosp' then 200 else 0 end;
end;
$$;
revoke all on function vv_bot_reserve(uuid) from public, anon, authenticated;

-- Role-action phase: pass any bomb it must pass, then use its role's ability.
create or replace function vv_bot_role_action(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_camp text; v_se numeric; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_day integer;
  v_t uuid; v_ally uuid; v_role_seen text; v_res jsonb; e jsonb; v jsonb;
  v_jailers uuid[]; v_enemies uuid[]; v_known jsonb;
  v_spend numeric;        -- what it may spend without touching its savings
  v_sure boolean;         -- target is a KNOWN enemy (not just suspected)
  v_threat boolean;
begin
  select p.room_id, s.role, vv_role_camp(s.role), p.soul_energy, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, r.day
    into v_room, v_role, v_camp, v_se, v_acted, v_dead, v_prison, v_hosp, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_room is null or v_dead then return; end if;

  -- A bomb that has sat a full day must be passed: to an enemy it has
  -- information on, else (left alone) it relocates randomly anyway.
  if exists (
       select 1 from rooms r, jsonb_array_elements(coalesce(r.bombs, '[]'::jsonb)) b
       where r.id = v_room and (b->>'holder')::uuid = p_bot
         and coalesce((b->>'since')::int, v_day) < v_day) then
    v_t := vv_bot_target(p_bot);
    if v_t is not null then perform pass_bomb_impl(p_bot, v_t); end if;
  end if;

  -- Imprisoned: only Vengeance acts — revenge on a jailer (she knows them).
  if v_prison then
    if v_role = 'vengeance' and not v_acted and v_se >= 150 then
      select coalesce(array_agg(pl.id), '{}') into v_jailers
        from rooms rm join players pl on pl.room_id = rm.id and not pl.dead
       where rm.id = v_room and rm.vengeance_imprisoners ? pl.id::text;
      foreach v_t in array v_jailers loop
        perform vv_bot_suspect(p_bot, v_t, 1);
      end loop;
      v_t := vv_bot_enemy(p_bot, v_jailers, false);
      if v_t is not null and random() < 0.8 then
        update player_secrets
           set pending_action = 'vengeance_kill',
               pending_target = jsonb_build_array(v_t::text)::text
         where player_id = p_bot;
        update players set soul_energy = soul_energy - 150, acted_this_day = true
         where id = p_bot;
      end if;
    end if;
    return;
  end if;
  if v_hosp or v_acted then return; end if;

  v_spend := v_se - vv_bot_reserve(p_bot);
  v_known := vv_bot_known(p_bot);

  if v_role = 'murder' then
    v_t := vv_bot_target(p_bot);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null and v_spend >= 150
       and random() < (case when v_sure then 0.9 else 0.5 end) then
      perform vv_bot_queue(p_bot, 150, 'kill', v_t::text);
    end if;

  elsif v_role in ('intoxication', 'vengeance') then
    v_t := vv_bot_target(p_bot);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null
       and v_spend >= (case when v_role = 'vengeance' then 150 else 100 end)
       and random() < (case when v_sure then 0.75 else 0.35 end) then
      perform vv_bot_queue(p_bot, case when v_role = 'vengeance' then 150 else 100 end,
                           'intox', v_t::text);
    end if;

  elsif v_role = 'envy' then
    -- Wearing a known enemy's face sends their votes astray.
    v_t := vv_bot_enemy(p_bot, null, true, true);
    if v_t is not null and v_spend >= 100 and random() < 0.45 then
      perform vv_bot_queue(p_bot, 100, 'envy_swap', v_t::text);
    end if;

  elsif v_role = 'torment' then
    -- Any enemy it has information on, bot or human: since migration 131 a
    -- tormented bot can't tell who it's talking to either.
    v_t := vv_bot_target(p_bot, true, false);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null and v_spend >= 100
       and random() < (case when v_sure then 0.6 else 0.3 end) then
      perform vv_bot_queue(p_bot, 100, 'torment', v_t::text);
    end if;

  elsif v_role = 'justice' then
    v_t := vv_bot_enemy(p_bot, null, true, true);      -- a KNOWN Vice only
    v_threat := vv_bot_threatened(p_bot);
    if v_t is not null and v_spend >= 200 and random() < 0.75 then
      perform vv_bot_queue(p_bot, 200, 'kill', v_t::text);
    elsif v_spend >= 100 then
      v_ally := vv_bot_ally(p_bot);
      -- Shield only when it matters: the team is in danger, or a known ally
      -- is worth guarding now and then.
      if v_threat and random() < 0.7 then
        perform vv_bot_queue(p_bot, 100, 'protect',
          (case when v_ally is not null and random() < 0.4 then v_ally else p_bot end)::text);
      elsif v_ally is not null and random() < 0.3 then
        perform vv_bot_queue(p_bot, 100, 'protect', v_ally::text);
      end if;
    end if;

  elsif v_role = 'certainty' then
    -- An information role: reading a role IS how it learns. Holds back while
    -- saving, and once it already has someone to act on.
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null and v_spend >= 125
       and random() < (case when vv_bot_target(p_bot) is null then 0.75 else 0.3 end) then
      v_role_seen := reveal_role_impl(p_bot, v_t);
      if v_role_seen is not null then
        perform vv_bot_learn(p_bot, v_t, vv_role_camp(v_role_seen));
      end if;
    end if;

  elsif v_role = 'empathy' then
    -- Who voted against me / my known allies last time is suspicious.
    if v_day >= 2 and v_spend >= 150
       and random() < (case when vv_bot_target(p_bot) is null then 0.6 else 0.25 end) then
      v_res := reveal_votes_empathy_impl(p_bot);
      for e in select * from jsonb_array_elements(coalesce(v_res, '[]'::jsonb)) loop
        if (e->>'target_id') = p_bot::text
           or (vv_bot_known(p_bot)->>(e->>'target_id')) = v_camp then
          for v in select * from jsonb_array_elements(coalesce(e->'voter_ids', '[]'::jsonb)) loop
            perform vv_bot_suspect(p_bot, (v #>> '{}')::uuid, 1);
          end loop;
        end if;
      end loop;
    end if;

  elsif v_role in ('vice_worshipper', 'virtue_seeker') then
    v_ally := vv_bot_ally(p_bot);
    v_t := vv_bot_enemy(p_bot, null, false, true);      -- guess only among KNOWN enemies
    if v_ally is not null and v_spend >= 100 and random() < 0.5 then
      perform reveal_self_impl(p_bot, v_ally);
    elsif v_t is not null and v_day >= 2 and v_spend >= 100 and random() < 0.3 then
      perform vv_bot_queue(p_bot, 100,
        case when v_role = 'vice_worshipper' then 'worshipper_guess' else 'seeker_guess' end,
        v_t::text);
    end if;

  elsif v_role = 'sacrifice' then
    -- Only worth dying for two KNOWN, active enemies.
    select coalesce(array_agg(p.id order by random()), '{}') into v_enemies
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not p.in_prison and not p.in_hospital
       and v_known ? p.id::text
       and (v_known->>p.id::text) <> v_camp;
    if coalesce(array_length(v_enemies, 1), 0) >= 2 and v_spend >= 400 and random() < 0.7 then
      perform vv_bot_queue(p_bot, 400, 'sacrifice',
        (select jsonb_agg(x::text) from unnest(v_enemies[1:2]) x)::text);
    end if;

  elsif v_role = 'generosity' then
    v_ally := vv_bot_ally(p_bot);
    v_threat := vv_bot_threatened(p_bot);
    if v_ally is not null and v_spend >= 200 and random() < 0.5 then
      perform grant_extra_life_impl(p_bot, v_ally);
    elsif v_threat and v_spend >= 200 and random() < 0.5 then
      perform grant_extra_life_impl(p_bot, p_bot);
    elsif v_ally is not null and v_spend >= 100 and random() < 0.3 then
      perform gift_soul_energy_impl(p_bot, v_ally);
    end if;
  end if;
  -- truthfulness: its ability is on the consultation result screen; bots skip it.
end;
$$;
revoke all on function vv_bot_role_action(uuid) from public, anon, authenticated;

-- Quiz: points vs information. Low on Soul Energy (or nothing left to learn) →
-- bank the 100. Otherwise Virtue bots lean to information, Vice bots to points
-- (the designed asymmetry: Virtues must find the Vices).
create or replace function vv_bot_quiz(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_se numeric; v_camp text; v_unknown uuid; v_choice text := 'points';
  v_res jsonb; v_quiz jsonb; r numeric; v_saving boolean; v_has_target boolean;
  v_check uuid;
begin
  select p.soul_energy, vv_role_camp(s.role) into v_se, v_camp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_unknown := vv_bot_unknown(p_bot);
  v_saving := vv_bot_reserve(p_bot) > 0;
  v_has_target := vv_bot_target(p_bot) is not null;
  -- Something it was told and hasn't checked (migration 130).
  v_check := vv_bot_claim_to_check(p_bot);

  -- Saving up, already holding a target, short on Soul Energy, or nothing left
  -- to learn → bank the 100.
  if v_check is not null and random() < (case when v_saving then 0.4 else 0.8 end) then
    -- Check a claim: read the soul of the player it was about. vv_bot_learn
    -- then settles every claim about them (sender trusted, or a liar).
    v_choice := 'peek';
    v_unknown := v_check;
  elsif not v_saving and v_unknown is not null and v_se >= 100 then
    r := random();
    if v_has_target then
      v_choice := case when r < 0.2 then 'hint' else 'points' end;
    elsif v_camp = 'virtue' then
      v_choice := case when r < 0.55 then 'peek' when r < 0.8 then 'hint' else 'points' end;
    else
      v_choice := case when r < 0.4 then 'peek' when r < 0.65 then 'hint' else 'points' end;
    end if;
  end if;

  v_res := submit_quiz_choice_impl(p_bot, v_choice,
             case when v_choice = 'peek' then v_unknown end);
  if coalesce((v_res->>'ok')::boolean, false) then
    v_quiz := v_res->'quiz';
    if v_quiz->>'choice' = 'peek' and jsonb_typeof(v_quiz->'peek') = 'object' then
      perform vv_bot_learn(p_bot, (v_quiz->'peek'->>'target')::uuid, v_quiz->'peek'->>'camp');
    elsif v_quiz->>'choice' = 'hint' and jsonb_typeof(v_quiz->'hint') = 'object' then
      perform vv_bot_hint(p_bot, v_quiz->'hint');
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_quiz(uuid) from public, anon, authenticated;

-- Market: a couple of sensible buys, otherwise save.
create or replace function vv_bot_store(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_se numeric; v_camp text; v_role text; v_day integer;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_kill_armed boolean; v_hosp_armed boolean; v_protected boolean; v_iron boolean; v_mult boolean;
  v_t uuid; v_res jsonb; v_known jsonb; v_buys int := 0;
  v_role_kills boolean; v_threat boolean; v_eye_fresh boolean;
begin
  select p.room_id, p.soul_energy, vv_role_camp(s.role), s.role, r.day,
         p.dead, p.in_prison, p.in_hospital,
         s.potion_kill_target is not null, s.potion_hosp_target is not null,
         coalesce(s.potion_protect, false), coalesce(s.potion_iron_will, false),
         coalesce(s.potion_minigame_mult, false),
         coalesce((s.bot_memory->'eye'->>'day')::int, 0) >= r.day
    into v_room, v_se, v_camp, v_role, v_day, v_dead, v_prison, v_hosp,
         v_kill_armed, v_hosp_armed, v_protected, v_iron, v_mult, v_eye_fresh
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_room is null or v_dead or v_prison or v_hosp then return; end if;

  -- Its own role can already kill (and the next role phase will fund it).
  v_role_kills := v_role in ('murder', 'justice');

  -- (1) A KNOWN enemy: deal with it here unless the role will. Can't afford it
  --     yet → set a savings goal (the role phase and the Quiz respect it).
  v_t := vv_bot_enemy(p_bot, null, true, true);
  if v_t is not null and not v_role_kills and not v_kill_armed then
    if v_se >= 300 and random() < 0.75 then
      v_res := buy_potion_impl(p_bot, 'kill', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 300;
        perform vv_bot_set(p_bot, 'goal', null);
      end if;
    elsif not v_hosp_armed and v_se >= 200 and random() < 0.4 then
      v_res := buy_potion_impl(p_bot, 'hospitalise', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 200;
      end if;
    else
      perform vv_bot_set(p_bot, 'goal', jsonb_build_object(
        'kind', 'kill', 'target', v_t::text, 'day', v_day));
    end if;
  elsif v_t is null and not v_kill_armed then
    -- A strongly suspected enemy and plenty to spend: take the shot.
    v_t := vv_bot_target(p_bot, true, false, 2);
    if v_t is not null and not v_role_kills
       and v_se >= 450 and random() < 0.35 then
      v_res := buy_potion_impl(p_bot, 'kill', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 300;
      end if;
    end if;
  end if;

  -- (2) Team in danger → protection. No recent count → maybe check with the Eye.
  v_threat := vv_bot_threatened(p_bot);
  if not v_eye_fresh and v_day >= 2 and v_se >= 300 and random() < 0.3 then
    v_res := buy_potion_impl(p_bot, 'eye', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      perform vv_bot_set(p_bot, 'eye', jsonb_build_object(
        'vices', (v_res->>'vices')::int, 'virtues', (v_res->>'virtues')::int, 'day', v_day));
      v_buys := v_buys + 1; v_se := v_se - 150;
      v_threat := vv_bot_threatened(p_bot);
    end if;
  end if;
  if v_buys < 3 and v_threat and not v_protected and v_se >= 200 and random() < 0.8 then
    v_res := buy_potion_impl(p_bot, 'protect', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (2b) Rich, and told something it hasn't checked → check it now with a
  --      camp reveal instead of waiting for the next Quiz (migration 130).
  v_t := vv_bot_claim_to_check(p_bot);
  if v_buys < 3 and v_t is not null and v_se >= 400 and random() < 0.6 then
    v_res := buy_potion_impl(p_bot, 'camp_reveal', v_t);
    if coalesce((v_res->>'ok')::boolean, false) then
      perform vv_bot_learn(p_bot, v_t, v_res->>'camp');
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (3) Blind → buy information: a camp reveal on someone unknown.
  if v_buys < 3 and vv_bot_target(p_bot) is null and v_se >= 250
     and random() < (case when v_camp = 'virtue' then 0.5 else 0.35 end) then
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null then
      v_res := buy_potion_impl(p_bot, 'camp_reveal', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        perform vv_bot_learn(p_bot, v_t, v_res->>'camp');
        v_buys := v_buys + 1; v_se := v_se - 200;
      end if;
    end if;
  end if;

  -- (4) A known enemy still free to vote out → double this vote (day 2+).
  if v_buys < 3 and v_day >= 2 and not v_iron
     and vv_bot_reserve(p_bot) = 0 and v_se >= 250 and random() < 0.4
     and vv_bot_enemy(p_bot, null, false, true) is not null then
    v_res := buy_potion_impl(p_bot, 'iron_will', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (5) Cheap spare Soul Energy, nothing to save for → double the next Quiz.
  if v_buys < 3 and not v_mult and vv_bot_reserve(p_bot) = 0
     and v_se between 60 and 260 and random() < 0.25 then
    v_res := buy_potion_impl(p_bot, 'minigame_mult', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 60;
    end if;
  end if;

  -- (6) Chip in to free a jailed KNOWN ally.
  if vv_bot_reserve(p_bot) = 0 and v_se >= 250 and random() < 0.5 then
    v_known := vv_bot_known(p_bot);
    select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_t
      from players p
     where p.room_id = v_room and p.in_prison and not p.dead and p.id <> p_bot
       and (v_known->>p.id::text) = v_camp;
    if v_t is not null then
      perform contribute_release_impl(p_bot, v_t);
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_store(uuid) from public, anon, authenticated;

-- Consultation: vote a known or suspected enemy; with nothing to go on, vote at
-- random a little over half the time and skip otherwise. In a re-vote only the
-- tied players (p_candidates) are eligible.
create or replace function vv_bot_vote(p_bot uuid, p_candidates uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_t uuid; v_sus jsonb;
begin
  select p.dead, p.in_prison, p.in_hospital, coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_dead, v_prison, v_hosp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  if v_dead or v_prison or v_hosp then return; end if;

  -- Imprisoned / hospitalised players can still be voted on (p_active_only = false).
  v_t := vv_bot_enemy(p_bot, p_candidates, false, true);      -- a known enemy
  if v_t is null then
    v_t := vv_bot_enemy(p_bot, p_candidates, false, false);   -- suspicion, else anyone
    if v_t is not null
       and coalesce((v_sus->>v_t::text)::numeric, 0) <= 0
       and random() < 0.45 then
      v_t := null;                                             -- no real read: skip
    end if;
  end if;

  perform submit_vote_impl(p_bot, coalesce(v_t::text, 'skip'));
end;
$$;
revoke all on function vv_bot_vote(uuid, uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- The runner (replaces 124's safe-moves version; same signature + gate)
-- ===========================================================================
create or replace function run_bots(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text; v_day integer; v_revote jsonb; v_done text; v_key text;
  v_cands uuid[];
  r record;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  select phase, day, revote_candidates, bots_acted_key
    into v_phase, v_day, v_revote, v_done
    from rooms where id = p_room_id
    for update;
  if v_phase is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_key := v_phase || ':' || v_day || ':' || coalesce(md5(v_revote::text), '-');
  if v_done is not distinct from v_key then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if not exists (select 1 from players where room_id = p_room_id and is_bot) then
    return jsonb_build_object('ok', true, 'bots', 0);
  end if;

  if v_revote is not null and jsonb_typeof(v_revote) = 'array' then
    select coalesce(array_agg(x::uuid), '{}') into v_cands
      from jsonb_array_elements_text(v_revote) x;
  end if;

  -- Every living bot (an imprisoned Vengeance still acts). Each bot is isolated:
  -- one bot's failure is logged and skipped, never allowed to break the phase.
  for r in
    select p.id from players p
    where p.room_id = p_room_id and p.is_bot and not p.dead
    order by random()
  loop
    begin
      if v_phase = 'role_action' then
        perform vv_bot_role_action(r.id);
      elsif v_phase = 'minigame' then
        perform vv_bot_quiz(r.id);
      elsif v_phase = 'store' then
        perform vv_bot_store(r.id);
      elsif v_phase = 'consultation' then
        perform vv_bot_vote(r.id, v_cands);
      end if;
    exception when others then
      raise warning 'run_bots: bot % failed in %: %', r.id, v_phase, sqlerrm;
    end;
  end loop;

  -- Bots are always "ready" — they never hold up a gate. (The clients count
  -- humans only, so this matters just when no human is left active.)
  update players set ready = true
   where room_id = p_room_id and is_bot and not dead;

  update rooms set bots_acted_key = v_key where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function run_bots(uuid) to anon, authenticated;

create or replace function gm_free_prisoner(p_player_id uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_se numeric; v_day int; v_phase text;
  v_dead boolean; v_used int;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.soul_energy, r.day, r.phase, p.dead, s.gm_free_day
    into v_room, v_role, v_se, v_day, v_phase, v_dead, v_used
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'game_master' then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  -- Note: NOT blocked by in_prison. Being jailed is precisely when he needs it.
  if v_dead then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if v_used is not distinct from v_day then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', 100);
  end if;
  if not exists (select 1 from players
                 where id = p_target and room_id = v_room and in_prison and not dead) then
    return jsonb_build_object('ok', false, 'reason', 'not_imprisoned');
  end if;

  update players set in_prison = false where id = p_target;
  update players set soul_energy = soul_energy - 100 where id = p_player_id;
  update player_secrets set gm_free_day = v_day where player_id = p_player_id;

  -- Freeing only ever ADDS an active player, so it can't end the game and needs
  -- no win check (same reasoning as the communal release in migration 092).
  return jsonb_build_object('ok', true, 'freed', p_target);
end;
$$;
grant execute on function gm_free_prisoner(uuid, uuid) to anon, authenticated;

create or replace function resolve_gm_endurance(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_day int; v_status text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;

  select day, status into v_day, v_status from rooms where id = p_room_id;
  if v_status is distinct from 'in_game' or coalesce(v_day, 1) < 9 then
    return false;
  end if;
  if not exists (
    select 1 from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role = 'game_master' and not p.dead
  ) then
    return false;
  end if;

  update rooms
     set winner = 'neutral', anomaly_win = 'gm_endurance',
         phase = 'soul_victory_intro', phase_ends_at = null
   where id = p_room_id;
  update players set ready = false where room_id = p_room_id;
  return true;
end;
$$;
grant execute on function resolve_gm_endurance(uuid) to anon, authenticated;

-- ============================================
-- Server-hosted queue games (migration 126)
-- ============================================
-- Queue rooms (quick play + ranked) have no host: vv_tick_room runs their phase
-- machine, driven by pg_cron every 2s and by each client's tick_room. The tick
-- sets the transaction-local vv.server_tick flag, which vv_is_host accepts, so
-- the existing host-gated resolvers run unchanged. See db/126_server_hosted.sql.
create table if not exists room_presence (
  player_id uuid primary key references players(id) on delete cascade,
  room_id uuid not null references rooms(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists room_presence_room_idx on room_presence (room_id);
alter table room_presence enable row level security;   -- no policies: server-only

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
    -- A bot counts as ready ALWAYS (migration 131): bots act instantly and
    -- must never hold a screen, even after a mid-phase ready reset.
    select pl.is_bot as bot, (pl.ready or pl.is_bot) as rdy from players pl
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
-- Premade Outreach sentences + bot chat (migration 129).
-- ---------------------------------------------------------------------------
-- Sentences
create or replace function vv_sentence_needs_about(p_key text)
returns boolean language sql immutable as $$
  select p_key in ('claim_vice', 'claim_virtue', 'suspect', 'trust', 'vote', 'src_told');
$$;

create or replace function vv_sentence_bot_only(p_key text)
returns boolean language sql immutable as $$
  select p_key in ('src_quiz_today', 'src_quiz', 'src_hint', 'src_market',
                   'src_ability', 'src_told', 'src_hunch', 'huh');
$$;

create or replace function vv_sentence_text(p_key text, p_about_name text)
returns text language sql immutable as $$
  select case p_key
    when 'claim_vice'     then coalesce(p_about_name, 'Someone') || ' is a Vice.'
    when 'claim_virtue'   then coalesce(p_about_name, 'Someone') || ' is a Virtue.'
    when 'self_virtue'    then 'I''m a Virtue.'
    when 'self_vice'      then 'I''m a Vice.'
    when 'self_role'      then 'I''m the ' || coalesce(p_about_name, '…') || '.'
    when 'suspect'        then 'I suspect ' || coalesce(p_about_name, 'someone') || '.'
    when 'trust'          then 'I trust ' || coalesce(p_about_name, 'someone') || '.'
    when 'vote'           then 'Let''s vote ' || coalesce(p_about_name, 'someone') || ' out.'
    when 'ask_suspect'    then 'Who do you suspect?'
    when 'ask_side'       then 'Which side are you on?'
    when 'ask_role'       then 'Which role are you?'
    when 'ask_vote'       then 'Who should we vote for?'
    when 'ask_info'       then 'Do you have any information on anyone?'
    when 'ask_how'        then 'How do you know that?'
    when 'believe'        then 'I believe you.'
    when 'disbelieve'     then 'I don''t believe you.'
    when 'check'          then 'I''ll check that.'
    when 'no_idea'        then 'No idea yet.'
    when 'thanks'         then 'Thanks.'
    when 'bye'            then 'Talk tomorrow.'
    when 'src_quiz_today' then 'I read their soul in today''s Quiz.'
    when 'src_quiz'       then 'I read their soul in an earlier Quiz.'
    when 'src_hint'       then 'I worked it out from a Quiz hint.'
    when 'src_market'     then 'I used a camp reveal potion on them.'
    when 'src_ability'    then 'My ability showed me their role.'
    when 'src_told'       then coalesce(p_about_name, 'Someone') || ' told me.'
    when 'src_hunch'      then 'Just a hunch.'
    when 'huh'            then 'What do you mean?'
    else null end;
$$;

-- Internal send — every rule send_dm applies, for players (via the gated
-- wrapper below) and for bots (called from the bot step).
create or replace function vv_send_sentence(
  p_sender uuid, p_recipient uuid, p_key text, p_about uuid default null, p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_dead boolean; v_rec_room uuid; v_comms boolean; v_existing uuid;
  v_role text; v_muted boolean; v_muted_day int; v_day int; v_phase text;
  v_about_name text; v_text text;
begin
  select p.room_id, p.dead, coalesce(s.potion_comms, false), s.role,
         p.muted, p.ability_muted_day, r.day, r.phase
    into v_room, v_dead, v_comms, v_role, v_muted, v_muted_day, v_day, v_phase
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_sender;
  if v_room is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_phase is distinct from 'outreach' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead then return jsonb_build_object('ok', false, 'reason', 'cannot_chat'); end if;
  if p_recipient is null or p_recipient = p_sender then
    return jsonb_build_object('ok', false, 'reason', 'bad_recipient');
  end if;
  select room_id into v_rec_room from players where id = p_recipient;
  if v_rec_room is distinct from v_room then
    return jsonb_build_object('ok', false, 'reason', 'bad_recipient');
  end if;
  if coalesce(v_muted, false) or v_muted_day is not distinct from v_day then
    return jsonb_build_object('ok', false, 'reason', 'muted');
  end if;

  if vv_sentence_text(p_key, null) is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_sentence');
  end if;
  if vv_sentence_needs_about(p_key) then
    if p_about is null or p_about = p_sender then
      return jsonb_build_object('ok', false, 'reason', 'bad_about');
    end if;
    select name into v_about_name from players where id = p_about and room_id = v_room;
    if v_about_name is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_about');
    end if;
  end if;
  -- A role claim names a real role (any camp — it may be a bluff).
  if p_key = 'self_role' then
    if p_role is null or vv_role_camp(p_role) is null then
      return jsonb_build_object('ok', false, 'reason', 'bad_role');
    end if;
    v_about_name := initcap(replace(p_role, '_', ' '));
  end if;

  -- One partner per cycle (same rule and exemptions as send_dm).
  if not v_comms and v_role is distinct from 'sociability' then
    select recipient_id into v_existing
      from dm_messages
     where room_id = v_room and sender_id = p_sender and day = v_day
     order by created_at
     limit 1;
    if v_existing is not null and v_existing is distinct from p_recipient then
      return jsonb_build_object('ok', false, 'reason', 'partner_locked');
    end if;
  end if;

  v_text := vv_sentence_text(p_key, v_about_name);
  -- clock_timestamp, not the default now(): a bot's answer and its follow-up
  -- question are sent in one transaction and must keep their order.
  insert into dm_messages (room_id, sender_id, recipient_id, day, text, payload, created_at)
  values (v_room, p_sender, p_recipient, v_day, v_text,
          jsonb_build_object('s', p_key,
                             'about', case when vv_sentence_needs_about(p_key)
                                           then p_about::text end,
                             'role', case when p_key = 'self_role' then p_role end),
          clock_timestamp());
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function vv_send_sentence(uuid, uuid, text, uuid, text) from public, anon, authenticated;

create or replace function send_dm_sentence(
  p_sender_id uuid, p_recipient_id uuid, p_sentence text,
  p_about uuid default null, p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_sender_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if vv_sentence_bot_only(p_sentence) then
    return jsonb_build_object('ok', false, 'reason', 'bad_sentence');
  end if;
  return vv_send_sentence(p_sender_id, p_recipient_id, p_sentence, p_about, p_role);
end;
$$;
grant execute on function send_dm_sentence(uuid, uuid, text, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bot personality: how readily it believes (trusting / balanced / skeptical)
-- and how often it bluffs. Rolled once per bot, on first use.
create or replace function vv_bot_persona(p_bot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_p jsonb; v_camp text; r numeric;
begin
  select s.bot_memory->'persona', vv_role_camp(s.role) into v_p, v_camp
    from player_secrets s where s.player_id = p_bot;
  if v_p is not null then return v_p; end if;
  r := random();
  v_p := jsonb_build_object(
    'style', case when r < 1.0/3 then 'trusting' when r < 2.0/3 then 'balanced' else 'skeptical' end,
    'bluff', round((case when v_camp = 'vice' then 0.35 + random() * 0.25
                         else 0.10 + random() * 0.20 end)::numeric, 2));
  perform vv_bot_set(p_bot, 'persona', v_p);
  return v_p;
end;
$$;
revoke all on function vv_bot_persona(uuid) from public, anon, authenticated;

-- Does the bot take this sender at their word? Personality, then what it knows
-- of the sender: a caught liar or known enemy almost never; a known ally almost
-- always; earned trust and suspicion nudge it.
-- Is this bot under Torment's ink today? (rooms.torment_target, cleared at the
-- next new day.) Its Outreach then hides who is talking — just as for a human.
create or replace function vv_bot_tormented(p_bot uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select r.torment_target = p_bot::text
                     from players p join rooms r on r.id = p.room_id
                    where p.id = p_bot), false);
$$;
revoke all on function vv_bot_tormented(uuid) from public, anon, authenticated;

create or replace function vv_bot_believes(p_bot uuid, p_sender uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_style text; v_camp text; v_mem jsonb; v_known jsonb; v_p numeric;
  v_trust numeric; v_sus numeric;
begin
  v_style := vv_bot_persona(p_bot)->>'style';
  -- Inked (migration 131): it can't see who this is, so only its personality
  -- decides.
  if vv_bot_tormented(p_bot) then
    return random() < case v_style when 'trusting' then 0.75
                                   when 'skeptical' then 0.2 else 0.5 end;
  end if;
  select vv_role_camp(s.role), s.bot_memory into v_camp, v_mem
    from player_secrets s where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);

  if coalesce(v_mem->'liars', '[]'::jsonb) ? p_sender::text then return random() < 0.05; end if;

  v_p := case v_style when 'trusting' then 0.75 when 'skeptical' then 0.2 else 0.5 end;
  if (v_known->>p_sender::text) = v_camp then
    v_p := case v_style when 'trusting' then 0.97 when 'skeptical' then 0.75 else 0.9 end;
  elsif v_known ? p_sender::text then
    v_p := case v_style when 'trusting' then 0.2 when 'skeptical' then 0.03 else 0.1 end;
  end if;

  v_trust := coalesce((v_mem->'trust'->>p_sender::text)::numeric, 0);
  v_sus := coalesce((v_mem->'sus'->>p_sender::text)::numeric, 0);
  v_p := least(0.98, greatest(0.02, v_p + 0.15 * v_trust - 0.15 * greatest(v_sus, 0)));
  return random() < v_p;
end;
$$;
revoke all on function vv_bot_believes(uuid, uuid) from public, anon, authenticated;

-- Take in one message. Returns how it landed:
--   known_true / known_false   the bot could already check it
--   believed / doubted         an unchecked claim or opinion
--   question / none            nothing to weigh
create or replace function vv_bot_hear(p_bot uuid, p_sender uuid, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_about uuid;
  v_subj uuid; v_camp text; v_truth text; v_mycamp text; v_day integer;
  v_known jsonb; v_believed boolean; v_delta numeric; v_mem jsonb;
  v_ink boolean := vv_bot_tormented(p_bot);   -- can't see who's talking (131)
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  select vv_role_camp(s.role), r.day, s.bot_memory into v_mycamp, v_day, v_mem
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);

  if v_key in ('ask_suspect', 'ask_side', 'ask_role', 'ask_vote', 'ask_info', 'ask_how') then
    return 'question';
  end if;
  -- Inked: "I'm a Virtue" from someone it can't identify tells it nothing.
  if v_ink and v_key in ('self_vice', 'self_virtue', 'self_role') then return 'doubted'; end if;

  -- Camp claims: about someone else, or the sender about themselves.
  if v_key in ('claim_vice', 'claim_virtue') then
    v_subj := v_about;
    v_camp := case when v_key = 'claim_vice' then 'vice' else 'virtue' end;
  elsif v_key in ('self_vice', 'self_virtue') then
    v_subj := p_sender;
    v_camp := case when v_key = 'self_vice' then 'vice' else 'virtue' end;
  elsif v_key = 'self_role' then
    -- "I'm the Justice." claims that role's camp (migration 132).
    v_subj := p_sender;
    v_camp := vv_role_camp(p_payload->>'role');
    if v_camp is null then return 'none'; end if;
  end if;

  if v_subj is not null then
    v_truth := case when v_subj = p_bot then v_mycamp else v_known->>v_subj::text end;
    if v_truth is not null then
      -- (Inked, it knows whether the claim is true but not whom to credit.)
      if v_truth = v_camp then
        if not v_ink then
          perform vv_bot_set(p_bot, 'trust', coalesce(v_mem->'trust', '{}'::jsonb)
            || jsonb_build_object(p_sender::text,
                 coalesce((v_mem->'trust'->>p_sender::text)::numeric, 0) + 1));
        end if;
        return 'known_true';
      end if;
      -- Caught in a lie: strongly suspect the liar.
      if not v_ink then
        perform vv_bot_suspect(p_bot, p_sender, 2);
        if not (coalesce(v_mem->'liars', '[]'::jsonb) ? p_sender::text) then
          perform vv_bot_set(p_bot, 'liars',
            coalesce(v_mem->'liars', '[]'::jsonb) || jsonb_build_array(p_sender::text));
        end if;
      end if;
      return 'known_false';
    end if;

    v_believed := vv_bot_believes(p_bot, p_sender);
    -- Remember it either way: batch 2 checks unverified claims in the Quiz /
    -- Market. Keep the last 30.
    perform vv_bot_set(p_bot, 'claims', (
      select coalesce(jsonb_agg(c), '[]'::jsonb) from (
        select c from jsonb_array_elements(
          coalesce(v_mem->'claims', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'from', case when v_ink then null else p_sender::text end,
            'about', v_subj::text, 'camp', v_camp,
            'day', v_day, 'believed', v_believed))) with ordinality t(c, n)
        order by n desc limit 30) x));
    if v_believed then
      perform vv_bot_suspect(p_bot, v_subj, case when v_camp = v_mycamp then -1 else 1 end);
      return 'believed';
    end if;
    return 'doubted';
  end if;

  -- Opinions about a third player.
  if v_key in ('suspect', 'trust', 'vote') and v_about is not null and v_about <> p_bot then
    v_believed := vv_bot_believes(p_bot, p_sender);
    if v_believed then
      v_delta := case when v_key = 'trust' then -0.5 else 0.5 end;
      -- Never start suspecting someone it KNOWS is on its side.
      if not (v_delta > 0 and (v_known->>v_about::text) = v_mycamp) then
        perform vv_bot_suspect(p_bot, v_about, v_delta);
      end if;
      return 'believed';
    end if;
    return 'doubted';
  end if;

  return 'none';
end;
$$;
revoke all on function vv_bot_hear(uuid, uuid, jsonb) from public, anon, authenticated;

-- A role a bot can CLAIM in the given camp: one in this game's cast other than
-- its own, else a sensible default — never null.
create or replace function vv_bot_role_bluff(p_bot uuid, p_camp text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_my text; v_pool jsonb; v_pick text;
begin
  select s.role, r.role_pool into v_my, v_pool
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if jsonb_typeof(v_pool) = 'array' then
    select x into v_pick from jsonb_array_elements_text(v_pool) x
     where vv_role_camp(x) = p_camp and x is distinct from v_my
     order by random() limit 1;
  end if;
  if v_pick is null then
    select x into v_pick
      from unnest(case when p_camp = 'vice'
                       then array['murder', 'intoxication', 'envy', 'torment', 'vengeance']
                       else array['justice', 'empathy', 'certainty', 'truthfulness', 'sacrifice'] end) x
     where x is distinct from v_my
     order by random() limit 1;
  end if;
  return v_pick;
end;
$$;
revoke all on function vv_bot_role_bluff(uuid, text) from public, anon, authenticated;

-- What a bot won't ask a player again today: the questions it already asked
-- them, and whatever they volunteered ("I'm a Virtue." covers "Which side are
-- you on?"). bot_memory.asked = {day, <player id>: [question keys]}.
create or replace function vv_bot_mark_asked(p_bot uuid, p_other uuid, p_q text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_asked jsonb; v_day int; v_list jsonb;
begin
  select coalesce(s.bot_memory->'asked', '{}'::jsonb), r.day into v_asked, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce((v_asked->>'day')::int, -1) <> v_day then
    v_asked := jsonb_build_object('day', v_day);
  end if;
  v_list := coalesce(v_asked->p_other::text, '[]'::jsonb);
  if v_list ? p_q then return; end if;
  perform vv_bot_set(p_bot, 'asked',
    v_asked || jsonb_build_object(p_other::text, v_list || jsonb_build_array(p_q)));
end;
$$;
revoke all on function vv_bot_mark_asked(uuid, uuid, text) from public, anon, authenticated;

-- How carefully a bot lies (0.5–0.9, rolled once): the chance an invented
-- story holds up. The rest of the time it slips.
create or replace function vv_bot_care(p_bot uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v numeric;
begin
  select (bot_memory->>'care')::numeric into v from player_secrets where player_id = p_bot;
  if v is null then
    v := round((0.5 + random() * 0.4)::numeric, 2);
    perform vv_bot_set(p_bot, 'care', to_jsonb(v));
  end if;
  return v;
end;
$$;
revoke all on function vv_bot_care(uuid) from public, anon, authenticated;

-- What a bot tells this player about ITSELF ('side' → 'vice'/'virtue', or
-- 'role' → a role id), kept consistent: whether the player gets the truth is
-- settled the first time they ask (allies always do; a Vice lies to everyone
-- else; a Virtue sometimes hides its role behind another Virtue role), and the
-- answer is repeated after that. Liars share one cover role for the whole game
-- — so comparing notes doesn't catch a careful one — but a careless liar may
-- make up a fresh role, or change its story when asked twice.
-- bot_memory.told = {<player id>: {lie, side, role}}, bot_memory.cover = role.
create or replace function vv_bot_story(p_bot uuid, p_partner uuid, p_what text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mem jsonb; v_role text; v_camp text; v_told jsonb; v_lie boolean; v_val text;
  v_care numeric; v_bluff numeric; v_ally boolean; v_cover text;
begin
  select s.bot_memory, s.role, vv_role_camp(s.role) into v_mem, v_role, v_camp
    from player_secrets s where s.player_id = p_bot;
  v_care := vv_bot_care(p_bot);
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  v_told := coalesce(v_mem->'told'->p_partner::text, '{}'::jsonb);

  if v_told ? 'lie' then
    v_lie := (v_told->>'lie')::boolean;
  else
    v_ally := coalesce((vv_bot_known(p_bot)->>p_partner::text) = v_camp
                       and not vv_bot_tormented(p_bot), false);
    v_lie := not v_ally and (v_camp is distinct from 'virtue' or random() < v_bluff);
  end if;

  v_val := v_told->>p_what;
  if v_val is not null then
    if not (p_what = 'role' and v_lie and random() > (1 + v_care) / 2) then
      return v_val;                          -- the same answer as before
    end if;
    v_val := vv_bot_role_bluff(p_bot, 'virtue');   -- slipped: a different role
  elsif p_what = 'side' then
    v_val := case when v_camp = 'vice' and not v_lie then 'vice' else 'virtue' end;
  elsif not v_lie then
    v_val := v_role;
  else
    v_cover := v_mem->>'cover';
    if v_cover is null then
      v_cover := vv_bot_role_bluff(p_bot, 'virtue');
      perform vv_bot_set(p_bot, 'cover', to_jsonb(v_cover));
    end if;
    v_val := case when random() > v_care then vv_bot_role_bluff(p_bot, 'virtue') else v_cover end;
  end if;

  perform vv_bot_set(p_bot, 'told',
    coalesce((select bot_memory->'told' from player_secrets where player_id = p_bot), '{}'::jsonb)
    || jsonb_build_object(p_partner::text, v_told || jsonb_build_object('lie', v_lie, p_what, v_val)));
  return v_val;
end;
$$;
revoke all on function vv_bot_story(uuid, uuid, text) from public, anon, authenticated;

-- How it REALLY knows about p_about: {s: the src_* sentence, from}. A camp it
-- learned → where (bot_memory.src, recorded by vv_bot_learn since 134); one it
-- worked out → a Quiz hint; a claim it believed → who told it; else a hunch.
create or replace function vv_bot_true_source(p_bot uuid, p_about uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_mem jsonb; v_day int; v_src jsonb; v_from text;
begin
  select s.bot_memory, r.day into v_mem, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce(v_mem->'known', '{}'::jsonb) ? p_about::text then
    v_src := v_mem->'src'->p_about::text;
    return jsonb_build_object('s', case v_src->>'how'
      when 'ability' then 'src_ability'
      when 'market' then 'src_market'
      else (case when coalesce((v_src->>'day')::int, v_day) = v_day
                 then 'src_quiz_today' else 'src_quiz' end) end);
  end if;
  if vv_bot_known(p_bot) ? p_about::text then
    return jsonb_build_object('s', 'src_hint');
  end if;
  select c->>'from' into v_from
    from jsonb_array_elements(coalesce(v_mem->'claims', '[]'::jsonb)) c
   where c->>'about' = p_about::text and c->>'from' is not null
     and coalesce((c->>'believed')::boolean, false)
   limit 1;
  if v_from is not null then
    return jsonb_build_object('s', 'src_told', 'from', v_from);
  end if;
  return jsonb_build_object('s', 'src_hunch');
end;
$$;
revoke all on function vv_bot_true_source(uuid, uuid) from public, anon, authenticated;

-- An INVENTED source for a claim it's lying about. A careful liar picks one it
-- can stand behind: an informant who's alive to ask, a hunch, one Quiz read a
-- day, the Market only from day 2 (it opens after Outreach), "my ability" only
-- if it claimed Certainty. A careless one says something that can't be true:
-- "<you> told me.", a second Quiz read today, an earlier Quiz or a potion on
-- day 1, or "my ability" behind a role that has no such power.
create or replace function vv_bot_fake_source(p_bot uuid, p_partner uuid, p_about uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_day int; v_mem jsonb; v_said jsonb; v_role text;
  v_qtaken boolean; v_opts text[] := '{}'; v_pick text; v_from uuid;
begin
  select p.room_id, r.day, s.bot_memory into v_room, v_day, v_mem
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  v_said := case when coalesce((v_mem->'said'->>'day')::int, -1) = v_day
                 then v_mem->'said' else '{}'::jsonb end;
  -- Has it already claimed today's Quiz read for someone else?
  select exists (
    select 1
      from jsonb_each(v_said) k,
           jsonb_array_elements(case when jsonb_typeof(k.value) = 'array'
                                     then k.value else '[]'::jsonb end) e
     where e->>'s' = 'src_quiz_today' and e->>'about' is distinct from p_about::text)
    into v_qtaken;
  -- The role it told this player it has (or will: its cover).
  v_role := coalesce(v_mem->'told'->p_partner::text->>'role', v_mem->>'cover');

  if random() > vv_bot_care(p_bot) then
    v_opts := array['told_you'];
    if v_qtaken then v_opts := v_opts || array['src_quiz_today']; end if;
    if v_day <= 1 then v_opts := v_opts || array['src_quiz', 'src_market']; end if;
    if v_role is distinct from 'certainty' then v_opts := v_opts || array['src_ability']; end if;
  else
    select p.id into v_from
      from players p
     where p.room_id = v_room and p.id not in (p_bot, p_partner, p_about)
     order by p.dead, random() limit 1;
    if v_from is not null then v_opts := v_opts || array['src_told']; end if;
    if p_key = 'vote' then v_opts := v_opts || array['src_hunch']; end if;
    if not v_qtaken then v_opts := v_opts || array['src_quiz_today']; end if;
    if v_day >= 2 then v_opts := v_opts || array['src_quiz', 'src_market']; end if;
    if v_role = 'certainty' then v_opts := v_opts || array['src_ability']; end if;
  end if;

  select x into v_pick from unnest(v_opts) x order by random() limit 1;
  if v_pick = 'told_you' then
    return jsonb_build_object('s', 'src_told', 'from', p_partner::text);
  elsif v_pick = 'src_told' then
    return jsonb_build_object('s', 'src_told', 'from', v_from::text);
  end if;
  return jsonb_build_object('s', coalesce(v_pick, 'src_hunch'));
end;
$$;
revoke all on function vv_bot_fake_source(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Send a claim about a third player ("X is a Vice.", "Let's vote X out.") and
-- settle, there and then, how it'll say it knows: the truth when p_honest,
-- else an invented source — or, for a careful liar, the one it already gave
-- someone today for this player. bot_memory.said = {day, <player id>:
-- [{about, key, s, from}]}. Returns whether it was sent.
create or replace function vv_bot_say(
  p_bot uuid, p_partner uuid, p_key text, p_about uuid, p_honest boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_res jsonb; v_src jsonb; v_day int; v_said jsonb;
begin
  v_res := vv_send_sentence(p_bot, p_partner, p_key, p_about);
  if not coalesce((v_res->>'ok')::boolean, false) then return false; end if;
  if p_about is null or p_key not in ('claim_vice', 'claim_virtue', 'vote') then return true; end if;

  select coalesce(s.bot_memory->'said', '{}'::jsonb), r.day into v_said, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce((v_said->>'day')::int, -1) <> v_day then
    v_said := jsonb_build_object('day', v_day);
  end if;

  if p_honest then
    v_src := vv_bot_true_source(p_bot, p_about);
  else
    if random() <= vv_bot_care(p_bot) then
      select e - 'about' - 'key' into v_src
        from jsonb_each(v_said) k,
             jsonb_array_elements(case when jsonb_typeof(k.value) = 'array'
                                       then k.value else '[]'::jsonb end) e
       where e->>'about' = p_about::text
         and (e->>'from') is distinct from p_partner::text
       limit 1;
    end if;
    v_src := coalesce(v_src, vv_bot_fake_source(p_bot, p_partner, p_about, p_key));
  end if;

  perform vv_bot_set(p_bot, 'said', v_said || jsonb_build_object(p_partner::text,
    coalesce(v_said->p_partner::text, '[]'::jsonb)
    || jsonb_build_array(v_src || jsonb_build_object('about', p_about::text, 'key', p_key))));
  return true;
end;
$$;
revoke all on function vv_bot_say(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;

-- Four questions now (side, role, vote, info); each at most once per player per
-- day. "How do you know that?" is asked by players only — answering it takes
-- the bot-only sentences.
create or replace function vv_bot_next_question(p_bot uuid, p_other uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_asked jsonb; v_day int; v_q text;
begin
  select coalesce(s.bot_memory->'asked', '{}'::jsonb), r.day into v_asked, v_day
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  if coalesce((v_asked->>'day')::int, -1) <> v_day then v_asked := '{}'::jsonb; end if;
  select q into v_q from unnest(array['ask_side', 'ask_role', 'ask_vote', 'ask_info']) q
   where not (coalesce(v_asked->p_other::text, '[]'::jsonb) ? q)
   order by random() limit 1;
  return v_q;
end;
$$;
revoke all on function vv_bot_next_question(uuid, uuid) from public, anon, authenticated;

-- Answer one message (132's, extended). New: "Who should we vote for?", "Do
-- you have any information on anyone?" and "How do you know that?" — the last
-- answered with the source it settled on when it made its latest claim to this
-- player. What it says about itself comes from vv_bot_story; claims about
-- others go through vv_bot_say.
create or replace function vv_bot_reply(
  p_bot uuid, p_sender uuid, p_payload jsonb, p_outcome text, p_last boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_about uuid;
  v_style text; v_bluff numeric; v_mycamp text; v_known jsonb; v_room uuid; v_day int;
  v_reply text; v_reply_about uuid; v_reply_role text; v_claim_honest boolean;
  v_t uuid; v_tcamp text; v_honest boolean; v_ally boolean;
  v_next text; v_follow boolean := false; v_res jsonb; v_ok boolean;
  v_said jsonb; v_last jsonb;
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  v_style := vv_bot_persona(p_bot)->>'style';
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  select vv_role_camp(s.role), p.room_id, r.day, s.bot_memory->'said'
    into v_mycamp, v_room, v_day, v_said
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);
  v_honest := random() >= v_bluff;
  v_ally := coalesce((v_known->>p_sender::text) = v_mycamp and not vv_bot_tormented(p_bot), false);

  -- What they just volunteered needn't be asked.
  if v_key in ('self_vice', 'self_virtue', 'self_role') then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_side');
  end if;
  if v_key = 'self_role' then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_role');
  elsif v_key = 'vote' then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_vote');
  elsif v_key in ('claim_vice', 'claim_virtue') then
    perform vv_bot_mark_asked(p_bot, p_sender, 'ask_info');
  end if;
  v_next := vv_bot_next_question(p_bot, p_sender);

  if v_key = 'bye' then
    return;                                   -- the conversation is over
  elsif v_key = 'thanks' then
    v_reply := case when v_next is not null and random() < 0.5 then v_next else 'bye' end;
  elsif v_key in ('believe', 'disbelieve', 'check', 'no_idea') or vv_sentence_bot_only(v_key) then
    -- Keep it going while it still has something to ask.
    if v_next is not null and random() < 0.8 then
      v_reply := v_next;
    else
      v_reply := case when random() < 0.6 then 'thanks' else 'bye' end;
    end if;

  elsif v_key = 'ask_side' then
    v_reply := case when vv_bot_story(p_bot, p_sender, 'side') = 'vice'
                    then 'self_vice' else 'self_virtue' end;
    v_follow := true;

  elsif v_key = 'ask_role' then
    v_reply := 'self_role';
    v_reply_role := vv_bot_story(p_bot, p_sender, 'role');
    v_follow := true;

  elsif v_key in ('ask_vote', 'ask_suspect') then
    -- Who it really wants out (for a Vice, that's a Virtue it knows of), else
    -- — if it's a Vice, or bluffing — someone anyway.
    v_t := vv_bot_target(p_bot, false);
    if v_t = p_sender then v_t := null; end if;
    if v_t is not null and (v_honest or v_mycamp <> 'virtue') then
      v_reply := 'vote'; v_reply_about := v_t; v_claim_honest := true;
    elsif v_mycamp <> 'virtue' or not v_honest then
      select p.id into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender)
         and (v_known->>p.id::text) is distinct from v_mycamp
       order by random() limit 1;
      if v_t is not null and random() < 0.6 then
        v_reply := 'vote'; v_reply_about := v_t; v_claim_honest := false;
      else
        v_reply := 'no_idea';
      end if;
    else
      v_reply := 'no_idea';
    end if;
    v_follow := true;

  elsif v_key = 'ask_info' then
    -- Someone whose camp it knows (not itself, not the asker), an enemy first.
    select k.key::uuid, k.value #>> '{}' into v_t, v_tcamp
      from jsonb_each(v_known) k
      join players p on p.id::text = k.key and p.room_id = v_room and not p.dead
     where k.key not in (p_bot::text, p_sender::text)
       and (k.value #>> '{}') in ('vice', 'virtue')
     order by (k.value #>> '{}') = v_mycamp, random()
     limit 1;
    if v_ally or (v_mycamp = 'virtue' and v_honest) then
      if v_t is not null then
        v_reply := 'claim_' || v_tcamp; v_reply_about := v_t; v_claim_honest := true;
      else
        v_reply := 'no_idea';
      end if;
    elsif v_mycamp = 'virtue' then
      v_reply := 'no_idea';                   -- keeping it to itself today
    elsif v_t is not null and v_tcamp = 'virtue' and random() < 0.7 then
      v_reply := 'claim_vice'; v_reply_about := v_t; v_claim_honest := false;   -- frame
    elsif v_t is not null and v_tcamp = 'vice' and random() < 0.5 then
      v_reply := 'claim_virtue'; v_reply_about := v_t; v_claim_honest := false; -- cover
    elsif random() < 0.5 then
      select p.id into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender)
         and (v_known->>p.id::text) is distinct from v_mycamp
       order by random() limit 1;
      if v_t is not null then
        v_reply := 'claim_vice'; v_reply_about := v_t; v_claim_honest := false;   -- invent
      else
        v_reply := 'no_idea';
      end if;
    else
      v_reply := 'no_idea';
    end if;
    v_follow := true;

  elsif v_key = 'ask_how' then
    -- Its latest claim to this player today, backed by the story it settled
    -- on then (true, or invented — and an invented one may not hold up).
    if coalesce((v_said->>'day')::int, -1) = v_day
       and jsonb_typeof(v_said->p_sender::text) = 'array' then
      v_last := v_said->p_sender::text->(-1);
    end if;
    if v_last is not null then
      v_reply := v_last->>'s';
      v_reply_about := (v_last->>'from')::uuid;
    else
      v_reply := 'huh';                       -- nothing it said needs backing up
    end if;
    v_follow := true;

  elsif v_key in ('suspect', 'vote') and v_about = p_bot then
    -- Accused: defend itself (its story, which for a Vice is a lie).
    v_reply := case when vv_bot_story(p_bot, p_sender, 'side') = 'vice'
                    then 'disbelieve' else 'self_virtue' end;
    v_follow := true;
  elsif v_key = 'trust' and v_about = p_bot then
    v_reply := 'thanks';
    v_follow := true;

  elsif p_outcome in ('known_true', 'believed') then
    v_reply := case when p_outcome = 'believed' and v_style <> 'trusting' and random() < 0.3
                    then 'check' else 'believe' end;
    v_follow := true;
  elsif p_outcome in ('known_false', 'doubted') then
    if random() < v_bluff then
      v_reply := 'believe';                   -- keep its doubts to itself
    elsif p_outcome = 'known_false' then
      v_reply := 'disbelieve';
    else
      v_reply := case when v_style = 'skeptical' and random() < 0.5 then 'check'
                      when random() < 0.6 then 'disbelieve' else 'check' end;
    end if;
    v_follow := true;
  else
    v_reply := 'no_idea';                     -- never leave it unanswered
  end if;

  if v_claim_honest is not null then
    v_ok := vv_bot_say(p_bot, p_sender, v_reply, v_reply_about, v_claim_honest);
  else
    v_res := vv_send_sentence(p_bot, p_sender, v_reply, v_reply_about, v_reply_role);
    v_ok := coalesce((v_res->>'ok')::boolean, false);
  end if;
  if not v_ok then return; end if;
  if v_reply in ('ask_side', 'ask_role', 'ask_vote', 'ask_info') then
    perform vv_bot_mark_asked(p_bot, p_sender, v_reply);
    return;
  end if;

  -- Curious: follow its answer with a question of its own.
  if v_follow and p_last and v_next is not null and random() < 0.65 then
    v_res := vv_send_sentence(p_bot, p_sender, v_next);
    if coalesce((v_res->>'ok')::boolean, false) then
      perform vv_bot_mark_asked(p_bot, p_sender, v_next);
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_reply(uuid, uuid, jsonb, text, boolean) from public, anon, authenticated;

-- Every tick during Outreach: each living bot reads what arrived since it last
-- looked (after a short, human-ish delay) and answers its partner.
create or replace function vv_bot_claim_to_check(p_bot uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_known jsonb; v_t uuid;
begin
  v_known := vv_bot_known(p_bot);
  select (c->>'about')::uuid into v_t
    from player_secrets s,
         jsonb_array_elements(coalesce(s.bot_memory->'claims', '[]'::jsonb)) with ordinality t(c, n)
   where s.player_id = p_bot
     and c->>'about' <> p_bot::text
     and not (v_known ? (c->>'about'))
     and exists (select 1 from players pl where pl.id = (c->>'about')::uuid and not pl.dead)
   order by n
   limit 1;
  return v_t;
end;
$$;
revoke all on function vv_bot_claim_to_check(uuid) from public, anon, authenticated;

-- Open a conversation (133's): claims go through vv_bot_say, "I'm a Virtue."
-- through the bot's story, and it can open with any of the four questions.
create or replace function vv_bot_initiate(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_mycamp text; v_bluff numeric; v_known jsonb; v_sus jsonb;
  v_partner uuid; v_ally boolean; v_t uuid; v_tcamp text; v_lie boolean;
  v_key text; v_about uuid; v_honest boolean; v_res jsonb;
  v_ink boolean := vv_bot_tormented(p_bot);   -- inked: can't pick by who (131)
begin
  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_mycamp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  v_known := vv_bot_known(p_bot);

  select p.id into v_partner
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and not v_ink
     and ((v_known->>p.id::text) = v_mycamp
          or coalesce((v_sus->>p.id::text)::numeric, 0) < 0)
   order by random() limit 1;
  if v_partner is null then
    select p.id into v_partner
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not v_ink
       and (v_known->>p.id::text) is distinct from case when v_mycamp = 'vice' then 'virtue' else 'vice' end
     order by random() limit 1;
  end if;
  if v_partner is null then
    select p.id into v_partner
      from players p where p.room_id = v_room and p.id <> p_bot and not p.dead
     order by random() limit 1;
  end if;
  if v_partner is null then return; end if;

  v_ally := not v_ink and coalesce((v_known->>v_partner::text) = v_mycamp
            or coalesce((v_sus->>v_partner::text)::numeric, 0) < 0, false);
  v_lie := not v_ally and random() < case when v_mycamp = 'vice'
                                          then least(0.9, v_bluff + 0.35)
                                          else v_bluff end;

  v_t := vv_bot_target(p_bot, false);
  if v_t = v_partner then v_t := null; end if;
  v_tcamp := v_known->>v_t::text;

  if v_t is not null and random() < 0.6 then
    if not v_lie then
      -- What it actually knows (or suspects).
      v_key := case when v_tcamp in ('vice', 'virtue') then 'claim_' || v_tcamp else 'vote' end;
      v_about := v_t; v_honest := true;
    elsif v_mycamp = 'vice' and v_tcamp = 'virtue' then
      v_key := 'claim_vice'; v_about := v_t; v_honest := false;   -- frame a known Virtue
    elsif v_mycamp = 'vice' then
      v_key := case when vv_bot_story(p_bot, v_partner, 'side') = 'vice'
                    then 'self_vice' else 'self_virtue' end;
    else
      -- A Virtue's bluff: point at someone it has no case against.
      select p.id into v_about
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, v_partner, v_t)
       order by random() limit 1;
      if v_about is not null then
        v_key := 'vote'; v_honest := false;
      else
        v_key := coalesce(vv_bot_next_question(p_bot, v_partner), 'ask_side');
      end if;
    end if;
  else
    -- Nothing it wants to share right now: ask.
    v_key := coalesce(vv_bot_next_question(p_bot, v_partner), 'ask_side');
  end if;

  if v_honest is not null then
    perform vv_bot_say(p_bot, v_partner, v_key, v_about, v_honest);
    return;
  end if;
  v_res := vv_send_sentence(p_bot, v_partner, v_key, v_about);
  if coalesce((v_res->>'ok')::boolean, false)
     and v_key in ('ask_side', 'ask_role', 'ask_vote', 'ask_info') then
    perform vv_bot_mark_asked(p_bot, v_partner, v_key);
  end if;
end;
$$;
revoke all on function vv_bot_initiate(uuid) from public, anon, authenticated;

create or replace function vv_bot_outreach_step(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day integer; v_started timestamptz; b record; m record;
  v_seen timestamptz; v_last timestamptz; v_outcome text;
  v_replies int; v_rday int; v_init_at timestamptz; v_more boolean;
begin
  select day, coalesce(phase_started_at, now()) into v_day, v_started
    from rooms where id = p_room_id;

  for b in
    select p.id, s.bot_memory from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and p.is_bot and not p.dead
  loop
    begin
      perform vv_bot_persona(b.id);
      v_seen := coalesce((b.bot_memory->>'dm_seen')::timestamptz, '-infinity'::timestamptz);
      v_last := null;
      v_rday := coalesce((b.bot_memory->'replies'->>'day')::int, -1);
      v_replies := case when v_rday = v_day
                        then coalesce((b.bot_memory->'replies'->>'n')::int, 0) else 0 end;

      for m in
        select sender_id, payload, created_at from dm_messages
        where room_id = p_room_id and recipient_id = b.id and day = v_day
          and payload is not null
          and created_at > v_seen and created_at <= now() - interval '2 seconds'
        order by created_at
      loop
        v_last := m.created_at;
        v_outcome := vv_bot_hear(b.id, m.sender_id, m.payload);
        -- More from the same player still waiting in this batch (132)?
        v_more := exists (
          select 1 from dm_messages m2
           where m2.room_id = p_room_id and m2.recipient_id = b.id
             and m2.sender_id = m.sender_id and m2.day = v_day
             and m2.payload is not null and m2.created_at > m.created_at
             and m2.created_at <= now() - interval '2 seconds');
        if v_more and coalesce(m.payload->>'s', '') in
             ('believe', 'disbelieve', 'check', 'no_idea', 'thanks', 'bye') then
          null;   -- just a reaction, and they wrote more: answer that instead
        elsif v_replies < 11 then
          perform vv_bot_reply(b.id, m.sender_id, m.payload, v_outcome, not v_more);
          v_replies := v_replies + 1;
        elsif v_replies = 11 and coalesce(m.payload->>'s', '') <> 'bye' then
          perform vv_send_sentence(b.id, m.sender_id, 'bye', null);
          v_replies := v_replies + 1;
        end if;
      end loop;

      if v_last is not null then
        perform vv_bot_set(b.id, 'dm_seen', to_jsonb(v_last));
        perform vv_bot_set(b.id, 'replies', jsonb_build_object('day', v_day, 'n', v_replies));
      end if;

      -- Its own moment to start a conversation, rolled once per day.
      if coalesce((b.bot_memory->'init'->>'day')::int, -1) = v_day then
        v_init_at := (b.bot_memory->'init'->>'at')::timestamptz;
      else
        v_init_at := v_started + make_interval(secs => 15 + random() * 45);
        perform vv_bot_set(b.id, 'init', jsonb_build_object('day', v_day, 'at', v_init_at));
      end if;
      if now() >= v_init_at
         and not exists (select 1 from dm_messages
                         where room_id = p_room_id and sender_id = b.id and day = v_day) then
        perform vv_bot_initiate(b.id);
      end if;
    exception when others then
      raise warning 'vv_bot_outreach_step: bot % failed: %', b.id, sqlerrm;
    end;
  end loop;
end;
$$;
revoke all on function vv_bot_outreach_step(uuid) from public, anon, authenticated;

-- A bot's role select, played out over time: its tentative pick appears at
-- pick_at (camp-mates see it anonymously, exactly like a person's), and it locks
-- in at lock_at. Called by vv_tick_room every tick during role_select.
create or replace function vv_bot_role_select_step(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets s set role_choice = s.bot_memory->>'plan'
    from players p
   where p.id = s.player_id and p.room_id = p_room_id and p.is_bot
     and s.role is null and s.role_choice is null
     and s.bot_memory ? 'pick_at'
     and now() >= (s.bot_memory->>'pick_at')::timestamptz;

  update player_secrets s
     set role = s.bot_memory->>'plan', role_choice = s.bot_memory->>'plan'
    from players p
   where p.id = s.player_id and p.room_id = p_room_id and p.is_bot
     and s.role is null
     and s.bot_memory ? 'lock_at'
     and now() >= (s.bot_memory->>'lock_at')::timestamptz;
end;
$$;
revoke all on function vv_bot_role_select_step(uuid) from public, anon, authenticated;

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
      -- Humans only (migration 131): resetting the bots too left a room with
      -- no active human (e.g. the only human in hospital) stuck on the
      -- "next day" screen forever.
      update players set ready = false where room_id = p_room_id and not is_bot;
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
