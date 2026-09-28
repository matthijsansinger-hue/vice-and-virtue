-- Migration 120 — Phase guards on the host's resolvers (playtest-freeze follow-up)
--
-- Background: the 2026-09-26 20-player playtest froze because the host's browser
-- advanced each phase exactly once, with no retry. The client fix
-- (src/lib/hostAdvance.ts) now RE-FIRES a phase advance when the room is still
-- stuck. That makes it essential that running a resolver twice is harmless — and
-- today it isn't:
--
--   * resolve_role_action / resolve_store / resolve_consultation never check the
--     room's current phase. A second call (a retry, or the host's TopBar Skip
--     racing the auto-advance timer) re-resolves: it rewrites the phase back and
--     overwrites last_events, so the death recap can be wiped or a later phase
--     yanked backwards.
--   * apply_minigame_awards is ADDITIVE, so a second call pays everyone's Soul
--     Energy twice. (The playtest's RPM7R room had its awards land while the
--     rest of the transition died — exactly the case a retry then repeats.)
--
-- Fix, all server-side so it holds no matter what the client does:
--   1. Each resolver wrapper locks the room row (FOR UPDATE) and returns without
--      doing anything unless the room is still in the phase that resolver ends.
--      The lock serialises two simultaneous calls: the second waits for the first
--      to commit, then sees the NEW phase and becomes a no-op.
--   2. apply_minigame_awards pays at most once per room per day
--      (rooms.minigame_awarded_day), and only during the minigame phase.
--
-- Only the thin 097 wrappers are redefined (same signatures, same host gate) —
-- the long *_impl bodies are untouched. Safe to re-run.

begin;

-- 1) Once-per-day marker for the minigame Soul Energy awards.
alter table rooms add column if not exists minigame_awarded_day integer;

-- 2) Phase-guarded resolver wrappers.
create or replace function resolve_role_action(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  select phase into v_phase from rooms where id = p_room_id for update;
  if v_phase is distinct from 'role_action' then return; end if; -- already resolved
  perform resolve_role_action_impl(p_room_id);
end; $$;
grant execute on function resolve_role_action(uuid) to anon, authenticated;

create or replace function resolve_store(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  select phase into v_phase from rooms where id = p_room_id for update;
  if v_phase is distinct from 'store' then return; end if; -- already resolved
  perform resolve_store_impl(p_room_id);
end; $$;
grant execute on function resolve_store(uuid) to anon, authenticated;

create or replace function resolve_consultation(p_room_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_phase text;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  select phase into v_phase from rooms where id = p_room_id for update;
  if v_phase is distinct from 'consultation' then return; end if; -- already resolved
  perform resolve_consultation_impl(p_room_id);
end; $$;
grant execute on function resolve_consultation(uuid) to anon, authenticated;

-- 3) Minigame awards: at most once per room per day, only during the minigame.
--    Body is migration 102's, plus the lock + the two guards + the marker.
create or replace function apply_minigame_awards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb; v_player uuid; v_award numeric;
  v_phase text; v_day integer; v_awarded integer;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then return; end if;

  select phase, day, minigame_awarded_day
    into v_phase, v_day, v_awarded
    from rooms where id = p_room_id for update;
  if v_phase is distinct from 'minigame' then return; end if;
  if v_awarded is not distinct from v_day then return; end if; -- already paid today

  for v_elem in select * from jsonb_array_elements(p_awards) loop
    v_player := (v_elem->>'player')::uuid;
    v_award  := (v_elem->>'award')::numeric;
    if v_player is null or v_award is null then continue; end if;
    if v_award < 0 or v_award > 200 then
      raise exception 'award out of range' using errcode = '22023';
    end if;
    update players set soul_energy = soul_energy + v_award
    where id = v_player and room_id = p_room_id;
  end loop;

  update rooms set minigame_awarded_day = v_day where id = p_room_id;
end;
$$;
grant execute on function apply_minigame_awards(uuid, jsonb) to anon, authenticated;

commit;
