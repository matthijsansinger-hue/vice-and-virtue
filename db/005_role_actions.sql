-- Migration 005: support for role abilities used in the role-action phase.
-- Run this in the Supabase SQL Editor.

-- Tracks whether a player has used their role ability this day.
-- Reset to false at the start of every role_action phase.
alter table players add column if not exists acted_this_day boolean not null default false;
