-- ============================================
-- Migration 026: in-game achievement events
-- Adds a per-game Murder kill counter and a SECURITY DEFINER function so
-- the host can grant achievement keys to ANY player when resolving game
-- events (normal RLS only lets a user write their own achievements).
--
-- NOTE (MVP trust model): grant_achievements bypasses RLS and is callable
-- by anyone, so a malicious client could grant badges. Acceptable for now
-- alongside the other open game-table policies; tighten before launch.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

-- Per-game count of kills a player has landed while holding Murder.
-- players rows are per-room, so this is naturally per-game.
alter table players
  add column if not exists murder_kills integer not null default 0;

-- Grant a batch of achievement keys. p_awards is a JSON array of
-- { "u": <user_id>, "k": <key> } objects.
create or replace function grant_achievements(p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
begin
  for rec in select * from jsonb_array_elements(p_awards)
  loop
    insert into user_achievements (user_id, key)
    values ((rec->>'u')::uuid, rec->>'k')
    on conflict (user_id, key) do nothing;
  end loop;
end;
$$;

grant execute on function grant_achievements(jsonb) to anon, authenticated;
