-- 085_leaderboard_banner.sql
-- Show each player's equipped banner on the worldwide leaderboard, same as in
-- game. Adds name_color + banner_color (the cosmetic-tier ids from migration
-- 080, both already public) to leaderboard_top_wins. Changing the RETURNS TABLE
-- shape needs a drop first (can't `create or replace` a new column set).

drop function if exists leaderboard_top_wins(integer);

create or replace function leaderboard_top_wins(p_limit integer default 10)
returns table (
  user_id uuid,
  username text,
  avatar_url text,
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
  select gr.user_id, p.username, p.avatar_url, p.featured_badges,
         p.name_color, p.banner_color, count(*) as wins
  from game_results gr
  join profiles p on p.id = gr.user_id
  where gr.won
  group by gr.user_id, p.username, p.avatar_url, p.featured_badges,
           p.name_color, p.banner_color
  order by count(*) desc, p.username asc
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

grant execute on function leaderboard_top_wins(integer) to anon, authenticated;
