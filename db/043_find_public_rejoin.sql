-- ============================================
-- Public lobbies (migration 043) — rejoin guard
-- ============================================
-- Fixes a duplicate-seat bug: a player who backed out of a public lobby and
-- searched again got a SECOND player row, leaving the first as an
-- uncontrollable "puppet". When the host did it, the orphaned host row left
-- the lobby permanently stuck.
--
-- The fix mirrors joinRoom's rejoin awareness: if this browser already holds
-- a seat in an open public lobby, hand that seat back instead of inserting a
-- duplicate. The third parameter carries the browser's stored player id.
--
-- The signature changes (new 3rd arg), so drop the old 2-arg version first —
-- otherwise CREATE OR REPLACE would leave two overloads side by side.

drop function if exists find_or_create_public_room(text, uuid);

create or replace function find_or_create_public_room(
  p_name text,
  p_user_id uuid,
  p_existing_player_id uuid default null
)
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
  -- Rejoin guard: if this browser is already seated in a public lobby that
  -- hasn't started, return that exact seat. Stops back-then-search from
  -- piling up orphan rows (and stops a re-searching host from orphaning the
  -- host seat and stalling the lobby).
  if p_existing_player_id is not null then
    select r.id, r.code into v_room_id, v_code
    from rooms r
    join players p on p.room_id = r.id
    where p.id = p_existing_player_id
      and r.is_public
      and r.status = 'lobby';
    if v_room_id is not null then
      return jsonb_build_object('code', v_code, 'player_id', p_existing_player_id);
    end if;
  end if;

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

grant execute on function find_or_create_public_room(text, uuid, uuid) to anon, authenticated;
