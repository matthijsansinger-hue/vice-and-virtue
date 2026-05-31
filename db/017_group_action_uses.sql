-- ============================================
-- Migration 017: per-game caps on group actions
-- Each game starts with two uses of "Revealing Eye" and two uses of
-- "Free a prisoner". The columns are decremented when the action
-- actually fires (Eye won, or a prisoner was actually freed) and the
-- UI hides options that have 0 uses left.
-- ============================================

alter table rooms
  add column if not exists eye_uses_left integer not null default 2,
  add column if not exists free_uses_left integer not null default 2;
