-- Migration 007: hospital state + tracking the latest imprisoned player.
-- Run this in the Supabase SQL Editor.

-- True if the player is currently hospitalized (1-day skip state).
-- Auto-resets to false at the start of each new role-action phase.
alter table players add column if not exists in_hospital boolean not null default false;

-- Tracks who was imprisoned in the most recent consultation (or NULL if no
-- one was). Used by Vengeance to figure out whether it can act this round.
alter table rooms add column if not exists last_imprisoned_player text;
