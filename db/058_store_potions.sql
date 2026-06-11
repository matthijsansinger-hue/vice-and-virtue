-- ============================================
-- Outreach store + day-long potions (migration 058) — store batch 2a.
-- ============================================
-- A new `store` phase sits between Outreach and the consultation group action
-- (outreach -> store -> group_action -> consultation). Players individually
-- spend their in-match Soul Energy (players.soul_energy) on single-use potions
-- that last one day cycle. Purchases are SECRET (kept in player_secrets) and
-- mutated only by SECURITY DEFINER RPCs, exactly like role actions.
--
-- This batch wires the two potions whose effects DON'T touch the role-action
-- engine: Camp reveal (instant) and the Minigame x2 multiplier (next minigame).
-- The combat potions (kill/hospitalise/protection -> next reflection) and the
-- vote-reveal potion land in later migrations; their columns are added here so
-- player_secrets isn't altered repeatedly.

alter table player_secrets
  add column if not exists potion_kill_target   uuid,
  add column if not exists potion_hosp_target   uuid,
  add column if not exists potion_protect       boolean not null default false,
  add column if not exists potion_minigame_mult boolean not null default false,
  add column if not exists potion_vote_reveal   boolean not null default false;

-- Buy a potion in the store. Returns jsonb {ok, camp?, error?}.
--   camp_reveal   (200 SE): reveals a target's camp now (repeatable, SE-limited).
--   minigame_mult ( 60 SE): doubles your NEXT minigame's Soul Energy (arm once).
-- (kill / hospitalise / protection / vote_reveal are wired in later migrations.)
create or replace function buy_potion(
  p_player_id uuid,
  p_potion text,
  p_target uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_phase text;
  v_se numeric;
  v_dead boolean; v_prison boolean; v_hospital boolean;
  v_cost numeric;
  v_target_role text;
  v_armed boolean;
begin
  select p.room_id, r.phase, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_phase, v_se, v_dead, v_prison, v_hospital
  from players p join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  -- You can only buy while the store is open.
  if v_phase is distinct from 'store' then
    return jsonb_build_object('ok', false, 'error', 'not_store');
  end if;
  -- Dead / imprisoned / hospitalised players don't shop.
  if v_dead or v_prison or v_hospital then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;

  -- Cost table (authoritative, server-side).
  v_cost := case p_potion
    when 'camp_reveal'   then 200
    when 'minigame_mult' then 60
    else null end;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion');
  end if;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;

  -- Minigame x2: arm a one-shot flag (no double-buy).
  if p_potion = 'minigame_mult' then
    select potion_minigame_mult into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_minigame_mult = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Camp reveal: instant info, repeatable (each pays again for a new target).
  if p_potion = 'camp_reveal' then
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    select s.role into v_target_role
    from players p join player_secrets s on s.player_id = p.id
    where p.id = p_target and p.room_id = v_room_id;
    if v_target_role is null then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true, 'camp', vv_role_camp(v_target_role));
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_potion');
end;
$$;
grant execute on function buy_potion(uuid, text, uuid) to anon, authenticated;

-- The caller's own armed potions, so the store UI can show "bought" state
-- (e.g. after a refresh mid-store). Only ever returns YOUR own row.
create or replace function my_potions(p_player_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'minigame_mult', coalesce(potion_minigame_mult, false),
    'protect',       coalesce(potion_protect, false),
    'kill',          potion_kill_target is not null,
    'hospitalise',   potion_hosp_target is not null,
    'vote_reveal',   coalesce(potion_vote_reveal, false)
  )
  from player_secrets where player_id = p_player_id;
$$;
grant execute on function my_potions(uuid) to anon, authenticated;

-- Consume (return + clear) the set of players in a room who armed the Minigame
-- x2 potion. Called by the host's endMinigame to double their Soul Energy award.
create or replace function consume_minigame_mult(p_room_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(s.player_id), '{}')
    into v_ids
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.potion_minigame_mult = true;

  update player_secrets set potion_minigame_mult = false
  where player_id = any(v_ids);

  return v_ids;
end;
$$;
grant execute on function consume_minigame_mult(uuid) to anon, authenticated;
