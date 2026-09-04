-- Migration 114 — a lobby needs 5 players before it can start
--
-- Applies to every self-created lobby, public or private. Ranked is unaffected:
-- ranked_form_match seats its 2N players and opens the room straight in
-- role_select without going through assign_roles_and_start, and its smallest
-- mode (3v3) is six players anyway.
--
-- ⚠️ THIS WRITES TO THE WRAPPER ON PURPOSE — it is the one legitimate reason to.
-- The standing rule (see db/schema.sql's header, and migrations 111/112) is that
-- LOGIC changes go to <name>_impl, because writing a body to the bare name
-- destroys the host gate. A minimum-players rule is not logic, it is a gate — it
-- belongs in exactly the same place as the vv_is_host check, and putting it here
-- means the 400-line impl is not touched at all. The wrapper still delegates to
-- assign_roles_and_start_impl, so the "did a wrapper lose its gate" check at the
-- bottom of db/112_host_gate_repair.sql still passes.
--
-- Keep the 5 in sync with MIN_PLAYERS_TO_START in src/lib/game.ts.

begin;

create or replace function assign_roles_and_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  select count(*) into v_count from players where room_id = p_room_id;
  if v_count < 5 then
    raise exception 'need at least 5 players to start (% in the lobby)', v_count
      using errcode = '42501';
  end if;

  perform assign_roles_and_start_impl(p_room_id);
end; $$;
grant execute on function assign_roles_and_start(uuid) to anon, authenticated;

commit;
