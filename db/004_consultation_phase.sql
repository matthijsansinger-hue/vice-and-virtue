-- Migration 004: support for the consultation phase (voting + prison).
-- Run this in the Supabase SQL Editor.

-- Each player's current vote: a target player's id, the string 'skip', or NULL.
alter table players add column if not exists vote text;

-- True if the player has been voted to prison.
alter table players add column if not exists in_prison boolean not null default false;
