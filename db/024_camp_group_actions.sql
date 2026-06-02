-- ============================================
-- Migration 024: camp-restricted group actions
-- The pre-vote group action is no longer one democratic Eye/Free/Skip
-- vote. Instead, simultaneously and before the imprisonment vote:
--   - Vices decide whether to use the Revealing Eye (once per game)
--   - Virtues majority-vote whether to free a prisoner, and which one
--     (once per game)
-- Both can happen in the same round, so the Eye outcome gets its own
-- flag rather than sharing the single group_action_result enum.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

-- The Eye fired this consultation round (drives the banner). Cleared at
-- the start of each group-action phase. group_action_freed_id still
-- carries the freed prisoner, so the two outcomes are independent now.
alter table rooms
  add column if not exists eye_revealed boolean not null default false;

-- Free a prisoner is now once per game (was 2). startGame overwrites
-- this on every game start; the default is just kept in sync.
alter table rooms
  alter column free_uses_left set default 1;
