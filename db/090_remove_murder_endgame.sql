-- ============================================
-- Migration 090 — remove the Murder +1 instant-win endgame
-- ============================================
-- "Murder alive + exactly one other active player -> Vices win immediately" is
-- removed. With the store potions a lone Virtue still has a chance to win, so
-- the game now plays on until a whole camp is imprisoned/dead. Only the
-- vv_check_winner helper changes (it's used by every resolve_* function).

create or replace function vv_check_winner(p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vices int;
  v_virtues int;
begin
  select
    count(*) filter (where vv_role_camp(s.role) = 'vice'),
    count(*) filter (where vv_role_camp(s.role) = 'virtue')
  into v_vices, v_virtues
  from players p
  join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and not p.dead and not p.in_prison;

  if v_vices = 0 and v_virtues > 0 then return 'virtue'; end if;
  if v_virtues = 0 and v_vices > 0 then return 'vice'; end if;
  return null;
end;
$$;

grant execute on function vv_check_winner(uuid) to anon, authenticated;
