-- Migration 097 — Host gate (untrusted-client / Steam hardening, phase 2a)
--
-- Fixes audit finding C1: the phase-transition / game-driving RPCs were granted
-- to anon with NO host check, so ANY player in a room could snap-resolve votes
-- early, wipe votes, re-roll roles, force the store, etc. This gates each one to
-- the room's host via vv_is_host() (migration 096).
--
-- TECHNIQUE: rename the existing function to <name>_impl (UNCHANGED body — we do
-- not retype the 400-line resolvers), then create a thin same-signature wrapper
-- that checks the host and delegates. The client calls the wrapper by the same
-- name, so NO client changes are needed. Wrong-signature renames fail loudly
-- (whole migration rolls back) rather than corrupting anything.
--
-- ⚠️ PREREQUISITE — APPLY THIS ONLY AFTER 096 + anonymous auth are LIVE and you've
-- confirmed a freshly-joined player gets a non-null players.user_id. Otherwise
-- vv_is_host() matches no one and the host can't drive the game. (Games that were
-- already in progress with NULL user_id host rows will also stall — finish/restart
-- them after applying.)

begin;

-- assign_roles_and_start(uuid) -> void
alter function assign_roles_and_start(uuid) rename to assign_roles_and_start_impl;
create function assign_roles_and_start(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform assign_roles_and_start_impl(p_room_id);
end; $$;
revoke execute on function assign_roles_and_start_impl(uuid) from anon, authenticated;
grant execute on function assign_roles_and_start(uuid) to anon, authenticated;

-- resolve_role_action(uuid) -> void
alter function resolve_role_action(uuid) rename to resolve_role_action_impl;
create function resolve_role_action(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform resolve_role_action_impl(p_room_id);
end; $$;
revoke execute on function resolve_role_action_impl(uuid) from anon, authenticated;
grant execute on function resolve_role_action(uuid) to anon, authenticated;

-- resolve_store(uuid) -> void
alter function resolve_store(uuid) rename to resolve_store_impl;
create function resolve_store(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform resolve_store_impl(p_room_id);
end; $$;
revoke execute on function resolve_store_impl(uuid) from anon, authenticated;
grant execute on function resolve_store(uuid) to anon, authenticated;

-- resolve_consultation(uuid) -> void
alter function resolve_consultation(uuid) rename to resolve_consultation_impl;
create function resolve_consultation(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform resolve_consultation_impl(p_room_id);
end; $$;
revoke execute on function resolve_consultation_impl(uuid) from anon, authenticated;
grant execute on function resolve_consultation(uuid) to anon, authenticated;

-- resolve_group_action(uuid) -> void
alter function resolve_group_action(uuid) rename to resolve_group_action_impl;
create function resolve_group_action(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform resolve_group_action_impl(p_room_id);
end; $$;
revoke execute on function resolve_group_action_impl(uuid) from anon, authenticated;
grant execute on function resolve_group_action(uuid) to anon, authenticated;

-- resolve_role_select(uuid) -> void
alter function resolve_role_select(uuid) rename to resolve_role_select_impl;
create function resolve_role_select(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform resolve_role_select_impl(p_room_id);
end; $$;
revoke execute on function resolve_role_select_impl(uuid) from anon, authenticated;
grant execute on function resolve_role_select(uuid) to anon, authenticated;

-- resolve_soul_escape(uuid) -> boolean
alter function resolve_soul_escape(uuid) rename to resolve_soul_escape_impl;
create function resolve_soul_escape(p_room_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  return resolve_soul_escape_impl(p_room_id);
end; $$;
revoke execute on function resolve_soul_escape_impl(uuid) from anon, authenticated;
grant execute on function resolve_soul_escape(uuid) to anon, authenticated;

-- start_revote(uuid, jsonb) -> void
alter function start_revote(uuid, jsonb) rename to start_revote_impl;
create function start_revote(p_room_id uuid, p_candidate_ids jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform start_revote_impl(p_room_id, p_candidate_ids);
end; $$;
revoke execute on function start_revote_impl(uuid, jsonb) from anon, authenticated;
grant execute on function start_revote(uuid, jsonb) to anon, authenticated;

-- choose_murder_successor(uuid, uuid) -> void
alter function choose_murder_successor(uuid, uuid) rename to choose_murder_successor_impl;
create function choose_murder_successor(p_room_id uuid, p_successor_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform choose_murder_successor_impl(p_room_id, p_successor_id);
end; $$;
revoke execute on function choose_murder_successor_impl(uuid, uuid) from anon, authenticated;
grant execute on function choose_murder_successor(uuid, uuid) to anon, authenticated;

-- enter_store(uuid, timestamptz) -> void
alter function enter_store(uuid, timestamptz) rename to enter_store_impl;
create function enter_store(p_room_id uuid, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform enter_store_impl(p_room_id, p_ends_at);
end; $$;
revoke execute on function enter_store_impl(uuid, timestamptz) from anon, authenticated;
grant execute on function enter_store(uuid, timestamptz) to anon, authenticated;

-- clear_room_votes(uuid) -> void
alter function clear_room_votes(uuid) rename to clear_room_votes_impl;
create function clear_room_votes(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform clear_room_votes_impl(p_room_id);
end; $$;
revoke execute on function clear_room_votes_impl(uuid) from anon, authenticated;
grant execute on function clear_room_votes(uuid) to anon, authenticated;

commit;
