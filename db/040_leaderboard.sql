-- 040_leaderboard.sql
-- Worldwide "most wins" leaderboard for the profile screen. Returns the top
-- players by total wins, with their public profile (username, avatar, featured
-- badges). Everything returned is already public; SECURITY DEFINER just lets it
-- aggregate game_results in one query regardless of per-row RLS.
create or replace function leaderboard_top_wins(p_limit integer default 10)
returns table (
  user_id uuid,
  username text,
  avatar_url text,
  featured_badges text[],
  wins bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select gr.user_id, p.username, p.avatar_url, p.featured_badges, count(*) as wins
  from game_results gr
  join profiles p on p.id = gr.user_id
  where gr.won
  group by gr.user_id, p.username, p.avatar_url, p.featured_badges
  order by count(*) desc, p.username asc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

grant execute on function leaderboard_top_wins(integer) to anon, authenticated;
