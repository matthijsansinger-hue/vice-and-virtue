-- ============================================
-- Migration 014: event summary state
-- Adds a JSONB column on rooms that endRoleAction writes a list of
-- notable events to (kills + hospitalizations). The Event Summary
-- screen reads it and shows banners between role-action and the
-- minigame.
--
-- Also documents the four new phase string values used by rooms.phase:
--   game_overview | lore_intro | event_summary | new_day
-- (phase is a free-form text column, so no constraint change is needed.)
-- ============================================

alter table rooms
  add column if not exists last_events jsonb;

-- Each entry is { type: 'killed' | 'hospitalized', target_id: <player id> }.
-- Cleared at the start of each new day.
