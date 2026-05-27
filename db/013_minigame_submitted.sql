-- Migration 013: minigame submission timestamp for tie-breaking.
-- Run this in the Supabase SQL Editor.

-- When set, this is the moment the player submitted their minigame
-- score this round. Used to break ties on raw score (earlier submitter
-- ranks higher). Reset to NULL at the start of each minigame.
alter table players add column if not exists minigame_submitted_at timestamptz;
