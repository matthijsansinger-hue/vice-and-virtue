-- ============================================
-- Migration 022: game results + linking players to accounts
-- Adds players.user_id (which account a player row belongs to, NULL for
-- guests) and a game_results table — one row per account per finished
-- game, used for lifetime stats and (later) "games played together".
--
-- Run this in the Supabase SQL Editor.
-- ============================================

-- Link a player row to a registered account (NULL for guests).
alter table players
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- One row per account per finished game. room_id groups the co-players
-- of a game (used later for "games played together") and is kept as a
-- plain uuid (no FK) so results survive room cleanup.
create table if not exists game_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  role text,                       -- role id held at game end
  camp text,                       -- 'vice' | 'virtue'
  won boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists game_results_user_idx on game_results (user_id);
create index if not exists game_results_room_idx on game_results (room_id);

alter table game_results enable row level security;

-- Open access for MVP, consistent with the other game tables. Tighten
-- before launch alongside the rest of the RLS work.
create policy "open access to game_results" on game_results
  for all using (true) with check (true);
