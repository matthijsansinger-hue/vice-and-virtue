-- Migration 013: tracks the newly-promoted Murder so we can show a
-- "your role has changed" banner on their minigame screen.
-- Run this in the Supabase SQL Editor.

alter table rooms add column if not exists recent_successor_id text;
