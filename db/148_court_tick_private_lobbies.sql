-- 148_court_tick_private_lobbies.sql — 2026-11-15, from Matthijs's playtest:
-- "when the timer has run out it doesn't skip to the next subphase in the
-- consultation phase".
--
-- In a PRIVATE lobby the court's steps were only ever moved on by the HOST's
-- phone (court_tick, every 2 s from the court screen). The pg_cron tick
-- (vv_tick_all_rooms) only steps server-hosted rooms. So whenever the host's
-- screen locked, they switched apps or lost signal, the clock ran out and the
-- court sat still for everyone.
--
-- Every court decision is already made by the server (vv_court_step: clock,
-- Done majority, witness window, votes), so it doesn't matter who asks:
--   (1) vv_tick_all_rooms now also steps every private lobby that is in a
--       court (same per-room advisory lock as everything else);
--   (2) court_tick_any(room, player) lets ANY seated player's phone nudge the
--       court (the client calls it once a step's clock has run out). It sets
--       the transaction-local vv.server_tick flag, like the server tick, so
--       the host-gated resolvers the court calls at its end (new day, win
--       check) accept it.
-- court_tick (host) is unchanged. Safe to run more than once.

begin;

-- (1) The cron tick also steps private lobbies' courts.
create or replace function vv_tick_all_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare rr record;
begin
  for rr in
    select id, created_at from rooms
    where server_hosted and phase <> 'game_over'
  loop
    -- Abandoned: no human has pinged for 2 minutes (a room younger than that
    -- counts its creation as the last sign of life). Deleting cascades the
    -- players, secrets, chat and presence; nothing is recorded.
    if not exists (
         select 1 from players p
         left join room_presence pr on pr.player_id = p.id
         where p.room_id = rr.id and not p.is_bot
           and coalesce(pr.last_seen_at, rr.created_at) > now() - interval '2 minutes') then
      delete from rooms where id = rr.id;
      continue;
    end if;

    if pg_try_advisory_xact_lock(hashtextextended('vv_tick:' || rr.id::text, 0)) then
      begin
        perform vv_tick_room(rr.id);
      exception when others then
        raise warning 'vv_tick_all_rooms: room % failed: %', rr.id, sqlerrm;
      end;
    end if;
  end loop;

  -- Private lobbies in a court (migration 148): the server steps the court
  -- too, so it no longer waits on the host's phone.
  perform set_config('vv.server_tick', 'on', true);
  for rr in
    select id from rooms
    where not server_hosted and phase = 'consultation' and court_step is not null
  loop
    if pg_try_advisory_xact_lock(hashtextextended('vv_tick:' || rr.id::text, 0)) then
      begin
        perform vv_court_step(rr.id, false);
      exception when others then
        raise warning 'vv_tick_all_rooms: court in room % failed: %', rr.id, sqlerrm;
      end;
    end if;
  end loop;
end;
$$;
revoke all on function vv_tick_all_rooms() from public, anon, authenticated;

-- (2) Any seated player may nudge a private lobby's court.
create or replace function court_tick_any(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from players where id = p_player_id and room_id = p_room_id)
     or not exists (select 1 from rooms where id = p_room_id and not server_hosted
                       and phase = 'consultation' and court_step is not null) then
    return;
  end if;
  -- The server decides what (if anything) is due; acting for it here.
  perform set_config('vv.server_tick', 'on', true);
  if pg_try_advisory_xact_lock(hashtextextended('vv_tick:' || p_room_id::text, 0)) then
    perform vv_court_step(p_room_id, false);
  end if;
end;
$$;
grant execute on function court_tick_any(uuid, uuid) to anon, authenticated;

commit;
