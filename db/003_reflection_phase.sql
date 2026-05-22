-- Migration 003: support for the reflection phase (the minigame).
-- Run this in the Supabase SQL Editor.

-- rooms: track the current game phase and the shared phase timer.
alter table rooms add column if not exists phase text not null default 'lobby';
alter table rooms add column if not exists phase_ends_at timestamptz;
alter table rooms add column if not exists day integer not null default 1;

-- players: readiness flag and minigame results.
alter table players add column if not exists ready boolean not null default false;
alter table players add column if not exists minigame_score numeric not null default 0;
alter table players add column if not exists soul_energy numeric not null default 0;
