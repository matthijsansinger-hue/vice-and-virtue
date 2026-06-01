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
  group_action_result text,                       -- outcome of the consultation-phase group vote: 'eye' | 'freed' | 'skip' | NULL; cleared each new day
  group_action_freed_id text,                     -- player id freed when group_action_result='freed'; cleared each new day
  eye_uses_left integer not null default 2,       -- remaining "Revealing Eye" uses for this game
  free_uses_left integer not null default 2,      -- remaining "Free a prisoner" uses for this game
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
  minigame_submitted_at timestamptz,              -- when they submitted this round (for tie-breaking)
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

-- Realtime: let the app subscribe to live changes
-- (so the lobby player list updates as people join, messages appear, etc.).
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table dm_messages;
alter publication supabase_realtime add table consultation_messages;
alter publication supabase_realtime add table dead_messages;
