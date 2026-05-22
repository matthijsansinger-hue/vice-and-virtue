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
  phase text not null default 'lobby',            -- lobby | role_reveal | minigame | result
  phase_ends_at timestamptz,                      -- deadline for the current timed phase
  day integer not null default 1,
  outreach_enabled boolean not null default true,
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
  created_at timestamptz not null default now()
);

-- Row Level Security is required by Supabase.
-- For the MVP we allow open access so the app just works.
-- TODO before launch: replace these with proper, restrictive policies.
alter table rooms enable row level security;
alter table players enable row level security;

create policy "open access to rooms" on rooms
  for all using (true) with check (true);

create policy "open access to players" on players
  for all using (true) with check (true);

-- Realtime: let the app subscribe to live changes
-- (so the lobby player list updates as people join).
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
