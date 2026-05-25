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
  phase text not null default 'lobby',            -- lobby | role_reveal | role_action | minigame | result | consultation | game_over
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
  created_at timestamptz not null default now()
);

-- Players: one row per person who joined a room
create table players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  is_host boolean not null default false,
  connected boolean not null default true,
  role text,                                      -- assigned role id, NULL in the lobby
  ready boolean not null default false,           -- ready to leave the current phase
  minigame_score numeric not null default 0,      -- raw score from the last minigame
  soul_energy numeric not null default 0,         -- accumulated points
  vote text,                                      -- current consultation vote: player id, 'skip', or NULL
  in_prison boolean not null default false,       -- voted to prison
  dead boolean not null default false,            -- killed (by Murder, Justice-kill, etc.)
  in_hospital boolean not null default false,     -- 1-day skip state (Intoxication, Vengeance)
  acted_this_day boolean not null default false,  -- used role ability this day
  pending_action text,                            -- queued action ('kill' | 'protect' | ...)
  pending_target text,                            -- target player's id for the queued action
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
create table dm_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid not null references players(id) on delete cascade,
  recipient_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- Row Level Security is required by Supabase.
-- For the MVP we allow open access so the app just works.
-- TODO before launch: replace these with proper, restrictive policies.
alter table rooms enable row level security;
alter table players enable row level security;
alter table messages enable row level security;
alter table dm_messages enable row level security;

create policy "open access to rooms" on rooms
  for all using (true) with check (true);

create policy "open access to players" on players
  for all using (true) with check (true);

create policy "open access to messages" on messages
  for all using (true) with check (true);

create policy "open access to dm_messages" on dm_messages
  for all using (true) with check (true);

-- Realtime: let the app subscribe to live changes
-- (so the lobby player list updates as people join, messages appear, etc.).
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table dm_messages;
