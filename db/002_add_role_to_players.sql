-- Migration 002: add a role column to the players table.
-- Holds the assigned role id (e.g. 'murder'), or NULL while still in the lobby.
-- Run this in the Supabase SQL Editor.

alter table players add column if not exists role text;
