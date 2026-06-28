-- Migration 102 — Guard the crown-jewel player columns (Steam hardening, phase 3c)
--
-- Audit finding (CRITICAL): `players` has an open `for all using(true)` policy, so
-- a client could `update players set soul_energy = 999999` (buy unlimited
-- kills/potions), `dead = false` (resurrect), `in_prison = false` (self-release),
-- `is_host = true` (seize the room), `muted = false` (un-mute), or `murder_kills`
-- (fake badge progress) — directly, with no RPC.
--
-- Why a column guard (not a full table lock): the host's browser still drives the
-- phase machine and writes the PACING columns directly (ready / acted_this_day /
-- minigame_score / minigame_submitted_at / in_hospital reset). Moving the whole
-- loop server-side is the deferred server-authority phase. But the dangerous
-- *state* (deaths, jailing, SE from abilities) is ALREADY server-side in the
-- resolve_* / buy_* / reveal_* SECURITY DEFINER RPCs — the ONLY live client write
-- to a sensitive column was endMinigame's Soul Energy award. So we:
--   1. relocate that award into a host-gated RPC (apply_minigame_awards), and
--   2. add a BEFORE UPDATE trigger that rejects any *client* change to the six
--      protected columns, while leaving the pacing columns writable.
-- SECURITY DEFINER RPCs run as the table owner (not anon/authenticated), so every
-- legitimate server-side write to these columns still passes.
--
-- ⚠️ APPLY AFTER 096 (needs vv_is_host) + anonymous auth live. Ship together with
--    the endMinigame client change (it now calls apply_minigame_awards instead of
--    writing soul_energy directly — a direct write would now be rejected).
--
-- NOT covered here (lower severity, entangled with the client phase machine —
-- closed by the server-authority phase): in_hospital / acted_this_day (host resets
-- them each day), the rooms phase columns, and crafting a malicious row via INSERT
-- (createRoom/joinRoom still insert players directly; that moves to an RPC later).

begin;

-- Host-gated Soul Energy award for the minigame. The host still computes the
-- per-player award client-side (rankPlayers + the x2 potion), but submits it here
-- so the write runs server-side and is bounded. Max legitimate single-round award
-- is 100 (rank 1) doubled by the multiplier potion = 200.
create or replace function apply_minigame_awards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_elem jsonb; v_player uuid; v_award numeric;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then return; end if;
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
end;
$$;
grant execute on function apply_minigame_awards(uuid, jsonb) to anon, authenticated;

-- The guard. Runs SECURITY INVOKER (default) so current_user reflects the real
-- caller: 'anon'/'authenticated' for a direct client write, the function owner
-- (postgres) for a SECURITY DEFINER RPC. Only client writes are checked.
create or replace function vv_guard_player_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.soul_energy  is distinct from old.soul_energy
    or new.dead         is distinct from old.dead
    or new.in_prison    is distinct from old.in_prison
    or new.murder_kills is distinct from old.murder_kills
    or new.is_host      is distinct from old.is_host
    or new.muted        is distinct from old.muted then
      raise exception 'cannot modify protected player columns'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists vv_guard_player_columns_trg on players;
create trigger vv_guard_player_columns_trg
  before update on players
  for each row execute function vv_guard_player_columns();

commit;
