-- Migration 008: vote-reveal flag used by Truthfulness.
-- Run this in the Supabase SQL Editor.

-- When true, the consultation result screen shows who voted for the
-- imprisoned player (broadcast to all players). Reset to false at the
-- start of each new consultation.
alter table rooms add column if not exists vote_reveal boolean not null default false;
