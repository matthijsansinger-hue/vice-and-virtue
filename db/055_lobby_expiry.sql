-- ============================================
-- Migration 055: auto-expire un-started lobbies
-- ============================================
-- A lobby that never starts is dead weight: matchmaking keeps dropping
-- new players into AFK-host lobbies that will never begin. This gives every
-- lobby a 10-minute lifetime. If a room is still in the 'lobby' status 10
-- minutes after it was created, it's deleted (cascade removes its players +
-- the four chat tables). Started games (status 'in_game' / 'ended') and all
-- account history are never touched.
--
-- Three parts:
--   1. expire_stale_lobbies() — the janitor; deletes stale lobbies.
--   2. A pg_cron job runs it every minute (server-authoritative backstop,
--      catches lobbies whose last client has closed the tab).
--   3. find_or_create_public_room — matchmaking now ignores lobbies past the
--      10-minute mark, so nobody is dropped into one even in the gap before
--      the janitor removes it.
-- Clients also call expire_stale_lobbies() the instant their lobby countdown
-- hits zero (grant below), so an AFK lobby closes immediately instead of
-- waiting up to a minute for cron; the room page then bounces everyone in it
-- back to the start screen when the room disappears.
--
-- Keep the '10 minutes' interval here in sync with LOBBY_EXPIRY_MINUTES in
-- src/lib/room.ts (the client countdown). Run this whole file once in the
-- Supabase SQL Editor.
-- ============================================

-- pg_cron is already enabled by migration 027; this is a no-op if so. If it
-- errors, enable "pg_cron" in Database -> Extensions, then re-run.
create extension if not exists pg_cron;

-- The janitor. SECURITY DEFINER so it bypasses the open RLS and can be called
-- by any client as a self-heal. It only ever deletes rooms STILL in the lobby
-- status past the cutoff — never a live or finished game — and re-checks the
-- cutoff against server time, so a client with a fast/slow clock can't delete
-- a lobby early. Returns how many rooms it removed.
create or replace function public.expire_stale_lobbies()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.rooms
  where status = 'lobby'
    and created_at < now() - interval '10 minutes';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.expire_stale_lobbies() to anon, authenticated;

-- Run every minute. Unschedule any prior copy first so re-running this file
-- doesn't create duplicate jobs.
do $$
begin
  perform cron.unschedule('expire-stale-lobbies');
exception
  when others then null;  -- no existing job to remove; ignore
end;
$$;

select cron.schedule(
  'expire-stale-lobbies',
  '* * * * *',                       -- every minute
  $$ select public.expire_stale_lobbies(); $$
);

-- ---- Matchmaking: never match into a lobby past its 10-minute lifetime.
-- Same as migration 043 plus an `and r.created_at > now() - interval
-- '10 minutes'` guard on both the rejoin lookup and the fullest-lobby pick,
-- so "Find Public Session" skips stale lobbies entirely (they're about to be
-- deleted anyway). Signature is unchanged, so CREATE OR REPLACE is enough.
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
  -- Rejoin guard: already seated in a FRESH open public lobby? Return that
  -- seat. Stale lobbies are excluded — they're about to be expired, so the
  -- player is routed into a fresh one instead of handed back a dying seat.
  if p_existing_player_id is not null then
    select r.id, r.code into v_room_id, v_code
    from rooms r
    join players p on p.room_id = r.id
    where p.id = p_existing_player_id
      and r.is_public
      and r.status = 'lobby'
      and r.created_at > now() - interval '10 minutes';
    if v_room_id is not null then
      return jsonb_build_object('code', v_code, 'player_id', p_existing_player_id);
    end if;
  end if;

  -- Fullest still-fillable FRESH public lobby (< 12 players, under 10 min old).
  -- FOR UPDATE SKIP LOCKED keeps simultaneous matchmakers from overshooting 12.
  select r.id, r.code into v_room_id, v_code
  from rooms r
  where r.is_public
    and r.status = 'lobby'
    and r.created_at > now() - interval '10 minutes'
    and (select count(*) from players p where p.room_id = r.id) < 12
  order by (select count(*) from players p where p.room_id = r.id) desc,
           r.created_at asc
  limit 1
  for update skip locked;

  if v_room_id is null then
    -- No fresh open public lobby — create one; this player hosts it. Retry on
    -- the (rare) random-code collision.
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
