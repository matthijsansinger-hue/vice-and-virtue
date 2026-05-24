-- Migration 010: Envy identity swap + Torment ink-spots.
-- Run this in the Supabase SQL Editor.

-- Envy's identity swap. While both are set, every UI that shows a player
-- swaps the names of envy_swap_a and envy_swap_b, and votes for either
-- route to the other. Reset to NULL at the start of each new day.
alter table rooms add column if not exists envy_swap_a text;
alter table rooms add column if not exists envy_swap_b text;

-- Torment's target. When set, that player sees half of the other player
-- icons obscured during the minigame. Reset at the start of each new day.
alter table rooms add column if not exists torment_target text;
