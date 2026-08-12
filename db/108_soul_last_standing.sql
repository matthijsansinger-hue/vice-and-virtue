-- ============================================
-- Migration 108 — the Wandering Soul wins by being the last one left
-- ============================================
-- A SECOND Soul win path next to the escape guess (migration 094): when a
-- resolution leaves no active Vice and no active Virtue while the Soul is still
-- alive, the castle has emptied itself and the Soul alone wins —
-- winner = 'neutral', phase 'soul_victory_intro' -> game_over.
--
-- Why this is its own RPC instead of teaching vv_check_winner a third camp:
-- every resolver ends with
--     phase = case when v_winner = 'vice' then 'vice_victory_intro'
--                  else 'virtue_victory_intro' end
-- so a 'neutral' return would land everyone on the VIRTUE screen unless all six
-- ~400-line resolve_* functions were retyped. Instead this mirrors the existing
-- resolve_soul_escape pattern: the host calls it right after a resolution and it
-- OVERRIDES the phase when the Soul is the last one standing. vv_check_winner is
-- unchanged — with both camps at 0 it returns null ("play on"), which is exactly
-- the state this function ends.
--
-- Trigger rule: no alive-and-un-imprisoned Vice or Virtue remains AND the Soul
-- is not dead. A jailed-but-alive Soul still wins: with both camps wiped out
-- there is nobody left to keep him, and the alternative is a game that can never
-- end. Hospitalised players still count as active (same as every other win
-- check), so a hospital bed does not hand the Soul the game.
--
-- Host-gated like every other resolver (migration 097); SECURITY DEFINER, so it
-- passes the rooms write guard (migration 103).

begin;

create or replace function resolve_soul_last_standing(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_soul uuid;
  v_camps int;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  -- Never override an ending that already landed (camp win, or the escape).
  if exists (select 1 from rooms where id = p_room_id and status = 'ended') then
    return false;
  end if;

  select s.player_id into v_soul
  from player_secrets s
  join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.role = 'wandering_soul' and not p.dead
  limit 1;

  if v_soul is null then return false; end if;

  select count(*) into v_camps
  from players p
  join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.dead and not p.in_prison
    and vv_role_camp(s.role) in ('vice', 'virtue');

  if v_camps > 0 then return false; end if;

  update rooms set
    phase = 'soul_victory_intro',
    winner = 'neutral',
    status = 'ended',
    phase_ends_at = null
  where id = p_room_id;

  return true;
end;
$$;

grant execute on function resolve_soul_last_standing(uuid) to anon, authenticated;

commit;
