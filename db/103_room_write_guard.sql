-- Migration 103 — Only the host may write rooms (Steam hardening, phase 3d)
--
-- Audit finding: `rooms` has an open `for all using(true)` policy, so ANY player
-- (not just the host) can `update rooms set phase=…/status='ended'/day=…`, etc. —
-- i.e. any one player can force-skip phases, force a win, or otherwise grief the
-- whole table's shared state for everyone in the match.
--
-- The room is host-driven by design: every legitimate client write to `rooms`
-- comes from the host (phase transitions in game.ts, the majority-continue
-- countdown, the lobby config toggles). The ONE exception is the end-screen
-- re-queue, where any participant may claim `next_room_code` — that moves to a
-- SECURITY DEFINER RPC here so it can stay open to non-hosts while the table is
-- locked.
--
-- Mechanism mirrors the player guard (102): a BEFORE UPDATE trigger rejects a
-- client UPDATE unless the caller is the room's host. SECURITY DEFINER RPCs run
-- as the table owner (not anon/authenticated), so the resolvers / matchmaking /
-- cleanup / claim_requeue all still write rooms.
--
-- ⚠️ APPLY AFTER 096 (needs vv_is_host) + anonymous auth live. Same prerequisite
--    as 097: the host's player row must carry user_id, or vv_is_host() matches no
--    one and the host can't drive the game. Ship with the GameOver client change
--    (re-queue now calls claim_requeue instead of writing next_room_code directly).
--
-- NOT covered (deferred to the server-authority phase): the host's own client
-- still writes the phase machine directly, so a cheating HOST can still distort
-- their own match. Closing that means moving the loop server-side. This migration
-- closes the much larger NON-host griefing surface.

begin;

-- Any participant of a finished room may claim its re-queue slot (atomic if still
-- empty). Returns the winning code (the claimer's, or whoever won a simultaneous
-- tap). Runs as owner, so it passes the room write guard below.
create or replace function claim_requeue(p_room_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  if not exists (
    select 1 from players
    where room_id = p_room_id and user_id is not null and user_id = auth.uid()
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update rooms set next_room_code = p_code
  where id = p_room_id and next_room_code is null;
  select next_room_code into v_code from rooms where id = p_room_id;
  return v_code;
end;
$$;
grant execute on function claim_requeue(uuid, text) to anon, authenticated;

-- The guard. SECURITY INVOKER (default) so current_user reflects the real caller.
create or replace function vv_guard_room_writes()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') and not vv_is_host(new.id) then
    raise exception 'only the host can modify the room' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists vv_guard_room_writes_trg on rooms;
create trigger vv_guard_room_writes_trg
  before update on rooms
  for each row execute function vv_guard_room_writes();

commit;
