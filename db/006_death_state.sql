-- Migration 006: death state + queued role actions.
-- Run this in the Supabase SQL Editor.

-- True if the player has been killed (by Murder, Justice-kill, etc.).
alter table players add column if not exists dead boolean not null default false;

-- Queued role action that resolves at the end of the role-action phase.
--   pending_action: e.g. 'kill' or 'protect'
--   pending_target: the target player's id (as text)
alter table players add column if not exists pending_action text;
alter table players add column if not exists pending_target text;
