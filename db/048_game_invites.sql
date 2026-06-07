-- ============================================
-- Targeted game invites (migration 048)
-- ============================================
-- "Invite a friend to this game": a player picks a friend and sends them a
-- direct invite to the current lobby. The invitee sees it on the start
-- screen ("<friend> invited you") and can join. Invites are per
-- room+recipient (re-inviting just refreshes), cascade-deleted with the
-- room, and only surface while the room is still a lobby.

create table if not exists game_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, to_user_id)
);

create index if not exists game_invites_to_idx on game_invites (to_user_id);

alter table game_invites enable row level security;

-- You can read invites you sent or received. Writes go through
-- send_game_invite() (SECURITY DEFINER) only.
create policy "see own game invites" on game_invites
  for select using (to_user_id = auth.uid() or from_user_id = auth.uid());

-- Send an invite to a friend for a lobby you're in. No-ops unless you're
-- friends, you're in the room, the room is still a lobby, and they aren't
-- already in it.
create or replace function send_game_invite(p_room_id uuid, p_to_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_to_user_id is null or p_to_user_id = v_me then
    return;
  end if;
  if not exists (
    select 1 from friendships
    where status = 'accepted'
      and ((requester_id = v_me and addressee_id = p_to_user_id)
        or (requester_id = p_to_user_id and addressee_id = v_me))
  ) then
    return;
  end if;
  if not exists (
    select 1 from players where room_id = p_room_id and user_id = v_me
  ) then
    return;
  end if;
  if not exists (
    select 1 from rooms where id = p_room_id and status = 'lobby'
  ) then
    return;
  end if;
  if exists (
    select 1 from players where room_id = p_room_id and user_id = p_to_user_id
  ) then
    return;
  end if;

  insert into game_invites (room_id, from_user_id, to_user_id)
  values (p_room_id, v_me, p_to_user_id)
  on conflict (room_id, to_user_id)
    do update set from_user_id = excluded.from_user_id, created_at = now();
end;
$$;

grant execute on function send_game_invite(uuid, uuid) to authenticated;

-- Open lobbies you've been invited to (still joinable, you're not in them).
create or replace function my_game_invites()
returns table (
  room_id uuid,
  code text,
  from_user_id uuid,
  from_username text,
  player_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.code,
    gi.from_user_id,
    pr.username,
    (select count(*) from players p2 where p2.room_id = r.id),
    gi.created_at
  from game_invites gi
  join rooms r on r.id = gi.room_id
  join profiles pr on pr.id = gi.from_user_id
  where gi.to_user_id = auth.uid()
    and r.status = 'lobby'
    and not exists (
      select 1 from players me
      where me.room_id = r.id and me.user_id = auth.uid()
    )
  order by gi.created_at desc;
$$;

grant execute on function my_game_invites() to authenticated;
