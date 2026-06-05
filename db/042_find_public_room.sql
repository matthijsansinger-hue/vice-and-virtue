-- ============================================
-- Public lobbies (migration 042) — Batch 2: matchmaking
-- ============================================
-- "Find Public Session" lands a player in a public lobby atomically:
--   * Join the FULLEST open public lobby that still has room to matchmake
--     into (public, in the lobby phase, fewer than 12 players).
--   * If none exists, create a new public lobby and host it.
-- Done in one SECURITY DEFINER function so two people tapping at the same
-- instant can't both create empty rooms or push a lobby past 12. The 12
-- ceiling is matchmaking-only — friends with the code can still fill a
-- public lobby up to the 20-player hard cap (enforced client-side in
-- joinRoom). Open to guests (p_user_id NULL).

create or replace function find_or_create_public_room(p_name text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_code text;
  v_player_id uuid;
  v_is_host boolean := false;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- mirrors CODE_ALPHABET in room.ts
  v_i int;
begin
  -- Fullest still-fillable public lobby (< 12 players). FOR UPDATE SKIP
  -- LOCKED means simultaneous matchmakers won't both grab the same
  -- near-full lobby: the second skips the locked row and picks/creates
  -- another, so matchmaking never overshoots 12. Counts live in subqueries
  -- because FOR UPDATE can't be combined with GROUP BY at the same level.
  select r.id, r.code into v_room_id, v_code
  from rooms r
  where r.is_public
    and r.status = 'lobby'
    and (select count(*) from players p where p.room_id = r.id) < 12
  order by (select count(*) from players p where p.room_id = r.id) desc,
           r.created_at asc
  limit 1
  for update skip locked;

  if v_room_id is null then
    -- No open public lobby — create one; this player hosts it. Retry on the
    -- (rare) random-code collision.
    loop
      v_code := '';
      for v_i in 1..5 loop
        v_code := v_code ||
          substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
      end loop;
      begin
        insert into rooms (code, is_public) values (v_code, true)
        returning id into v_room_id;
        exit;
      exception when unique_violation then
        -- code already taken, generate another
      end;
    end loop;
    v_is_host := true;
  end if;

  insert into players (room_id, user_id, name, is_host)
  values (v_room_id, p_user_id, p_name, v_is_host)
  returning id into v_player_id;

  return jsonb_build_object('code', v_code, 'player_id', v_player_id);
end;
$$;

grant execute on function find_or_create_public_room(text, uuid) to anon, authenticated;
