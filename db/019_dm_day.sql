-- ============================================
-- Migration 019: per-day outreach DMs
-- Adds a `day` column to dm_messages so each new day's outreach
-- phase shows a fresh chat history. Old messages remain in the
-- table (for analytics / debugging) but are filtered out by the
-- client.
-- ============================================

alter table dm_messages
  add column if not exists day integer;
