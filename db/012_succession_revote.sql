-- Migration 012: Murder succession + consultation tie-breaker re-vote.
-- Run this in the Supabase SQL Editor.

-- While set, Murder's death is deferred and they pick a successor.
-- Cleared once the succession resolves.
alter table rooms add column if not exists pending_murder_death text;

-- While set, consultation is in a re-vote between these tied candidates.
-- Cleared at the end of consultation (advance to next day).
alter table rooms add column if not exists revote_candidates jsonb;
