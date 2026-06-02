-- ============================================
-- Migration 025: achievements (badges)
-- Replaces "favorite role" with an earned-badge system. Most badges are
-- derived live from game_results / account data, but some are one-off
-- in-game events (e.g. "get freed from prison") or honour-system claims
-- (Discord). Those are recorded here as keys.
--
-- The favorite_role column on profiles is left in place but unused.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

create table if not exists user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,                               -- e.g. 'discord_joined', 'murder_3'
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table user_achievements enable row level security;

-- Readable by everyone so badges show on other players' profiles.
create policy "achievements readable by everyone"
  on user_achievements for select using (true);

-- A user can only record their own achievements.
create policy "users insert their own achievements"
  on user_achievements for insert with check (auth.uid() = user_id);
