-- Migration 121 — One "room changed" nudge per write, instead of per-row realtime
--
-- Background (2026-09-26 20-player playtest freeze): the room page listened to
-- Postgres Changes on `players` + `rooms`. Postgres Changes emits one message per
-- CHANGED ROW to EVERY subscriber, and checks RLS for every (row x subscriber)
-- pair on the database. So one host write like "reset ready for the room" in a
-- 20-player game = 20 rows x 20 phones = 400 realtime messages + 400 RLS checks,
-- on every phase change and every bulk update.
--
-- New approach — Broadcast from Database:
--   * A STATEMENT-level trigger on `players` sends ONE tiny message per affected
--     room per SQL statement (20 rows updated in one statement -> 1 message).
--     A row-level trigger on `rooms` (always one row) does the same.
--   * The message is a bare nudge {room_id} on the public topic 'room:<id>'. It
--     carries no game data; the client re-pulls public columns on receipt
--     (coalesced, see app/room/[code]/page.tsx).
--   * `rooms` and `players` leave the supabase_realtime publication. That stops
--     the per-row fan-out + RLS checks entirely, AND closes the known leak where
--     a raw realtime subscription received full `rooms` rows including the
--     SECRET columns (bombs, envy_swap_*, torment_target, kill_log, …).
--
-- Failure-safe by design: the nudge sender swallows every error, so if
-- realtime.send is unavailable a write is never blocked — clients just fall back
-- to their 3s safety-net poll (the game still works, only less snappy).
-- Deploy order doesn't matter for the same reason. Safe to re-run.
--
-- Verify after applying (should return without error):
--   select realtime.send('{}'::jsonb, 'changed', 'room:test', false);

begin;

-- 1) The nudge sender. Never raises.
create or replace function vv_broadcast_room_changed(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object('room_id', p_room_id),
    'changed',
    'room:' || p_room_id::text,
    false  -- public topic: the payload is just the room id, nothing secret
  );
exception when others then
  null; -- a failed nudge must never break a game write; clients poll anyway
end;
$$;
revoke all on function vv_broadcast_room_changed(uuid) from public, anon, authenticated;

-- 2) players: one nudge per affected room per statement.
--    (Transition tables need one trigger per event; all three name it
--    changed_rows so they share this function.)
create or replace function vv_players_changed_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid;
begin
  for v_room in
    select distinct room_id from changed_rows where room_id is not null
  loop
    perform vv_broadcast_room_changed(v_room);
  end loop;
  return null;
end;
$$;
revoke all on function vv_players_changed_stmt() from public, anon, authenticated;

drop trigger if exists vv_players_nudge_ins on players;
create trigger vv_players_nudge_ins
  after insert on players
  referencing new table as changed_rows
  for each statement execute function vv_players_changed_stmt();

drop trigger if exists vv_players_nudge_upd on players;
create trigger vv_players_nudge_upd
  after update on players
  referencing new table as changed_rows
  for each statement execute function vv_players_changed_stmt();

drop trigger if exists vv_players_nudge_del on players;
create trigger vv_players_nudge_del
  after delete on players
  referencing old table as changed_rows
  for each statement execute function vv_players_changed_stmt();

-- 3) rooms: one row per write, so a row-level trigger is already one nudge.
--    DELETE is included so an expired lobby bounces everyone promptly.
create or replace function vv_rooms_changed_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform vv_broadcast_room_changed(old.id);
  else
    perform vv_broadcast_room_changed(new.id);
  end if;
  return null;
end;
$$;
revoke all on function vv_rooms_changed_row() from public, anon, authenticated;

drop trigger if exists vv_rooms_nudge on rooms;
create trigger vv_rooms_nudge
  after update or delete on rooms
  for each row execute function vv_rooms_changed_row();

-- 4) Stop the per-row Postgres Changes stream for these two tables.
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'rooms') then
    alter publication supabase_realtime drop table rooms;
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'players') then
    alter publication supabase_realtime drop table players;
  end if;
end $$;

commit;
