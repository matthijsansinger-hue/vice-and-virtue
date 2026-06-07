-- ============================================
-- Leave room + host hand-off (migration 049)
-- ============================================
-- A player leaves the lobby. If they're the host, the next-oldest remaining
-- player (the "second to join") is promoted to host first, then the leaver
-- is removed — done in one function so there's never a host-less lobby.

create or replace function leave_room(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_is_host boolean;
  v_next uuid;
begin
  select room_id, is_host into v_room, v_is_host
  from players where id = p_player_id;
  if v_room is null then
    return;
  end if;

  if v_is_host then
    -- Promote the oldest remaining player (the second person to join).
    select id into v_next
    from players
    where room_id = v_room and id <> p_player_id
    order by created_at asc
    limit 1;
    if v_next is not null then
      update players set is_host = true where id = v_next;
    end if;
  end if;

  delete from players where id = p_player_id;
end;
$$;

grant execute on function leave_room(uuid) to anon, authenticated;
