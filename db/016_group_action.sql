-- ============================================
-- Migration 016: group action vote during consultation phase
-- Adds two columns to rooms that capture the outcome of the
-- pre-vote group decision (Revealing Eye / Free a prisoner / Skip).
-- The result is displayed as a banner during the main consultation
-- vote that immediately follows, and cleared at the start of the
-- next day in startNextDay().
-- ============================================

alter table rooms
  add column if not exists group_action_result text,    -- 'eye' | 'freed' | 'skip' | NULL
  add column if not exists group_action_freed_id text;  -- player id, only when result='freed'
