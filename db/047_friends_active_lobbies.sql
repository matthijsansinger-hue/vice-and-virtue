-- ============================================
-- Friends' active lobbies (migration 047)
-- ============================================
-- Powers the "Friends' games" surface on the start screen: open lobbies
-- hosted by one of the logged-in user's accepted friends, that they can
-- join. Includes PRIVATE lobbies (friends are invited regardless of the
-- public/private flag) and excludes lobbies the user is already in.
-- SECURITY DEFINER so it can read friendships + players + rooms + profiles;
-- keyed on auth.uid(), so a user only ever sees their own friends' games.

create or replace function friends_active_lobbies()
returns table (
  room_id uuid,
  code text,
  host_user_id uuid,
  host_username text,
  player_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with my_friends as (
    select case
             when f.requester_id = auth.uid() then f.addressee_id
             else f.requester_id
           end as friend_id
    from friendships f
    where f.status = 'accepted'
      and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
  )
  select
    r.id,
    r.code,
    p.user_id,
    pr.username,
    (select count(*) from players p2 where p2.room_id = r.id),
    r.created_at
  from rooms r
  join players p on p.room_id = r.id and p.is_host
  join my_friends mf on mf.friend_id = p.user_id
  join profiles pr on pr.id = p.user_id
  where r.status = 'lobby'
    and not exists (
      select 1 from players me
      where me.room_id = r.id and me.user_id = auth.uid()
    )
  order by r.created_at desc;
$$;

grant execute on function friends_active_lobbies() to authenticated;
