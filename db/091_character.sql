-- ============================================
-- Migration 091: customizable character avatars
-- Replaces uploaded profile photos with a layered "character" (gender base,
-- skin tone, hairstyle, hair color, eye color, outfit). The config is stored as
-- a single jsonb blob on profiles; the app composites the PNG layers (and tints
-- hair/eyes) client-side — see src/lib/character.ts + src/components/CharacterAvatar.tsx.
--
-- The old `avatar_url` column is LEFT IN PLACE (dormant, nullable) so nothing
-- breaks and the change is rollback-safe; the app just stops reading/writing it.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

-- The character config, e.g.
--   {"gender":"male","skin":"tan","hair":"short","hairColor":"brown","eyeColor":"blue","outfit":"tunic"}
-- null = the player hasn't made one yet (falls back to their initials).
-- NB: the column is `appearance`, NOT `character` — `character` is a reserved
-- SQL keyword (the CHAR type) and can't be used as an unquoted identifier.
alter table profiles add column if not exists appearance jsonb;

-- Surface the character on the worldwide leaderboard so each row renders the
-- player's avatar, same as in the lobby. Changing the RETURNS TABLE shape needs
-- a drop first (can't `create or replace` a new column set). Swaps avatar_url
-- (migration 085) for appearance.
drop function if exists leaderboard_top_wins(integer);

create or replace function leaderboard_top_wins(p_limit integer default 10)
returns table (
  user_id uuid,
  username text,
  appearance jsonb,
  featured_badges text[],
  name_color text,
  banner_color text,
  wins bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select gr.user_id, p.username, p.appearance, p.featured_badges,
         p.name_color, p.banner_color, count(*) as wins
  from game_results gr
  join profiles p on p.id = gr.user_id
  where gr.won
  group by gr.user_id, p.username, p.appearance, p.featured_badges,
           p.name_color, p.banner_color
  order by count(*) desc, p.username asc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

grant execute on function leaderboard_top_wins(integer) to anon, authenticated;
