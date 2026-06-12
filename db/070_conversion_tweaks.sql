-- ============================================
-- Migration 070 — Wrath/Love conversion: S-tier immunity + 200 SE
-- ============================================
-- Two tweaks to convert_player (migration 067):
--   * Cost raised 150 -> 200 SE (charged on a whiff, as before — it's a gamble).
--   * All S-tier roles (Murder, Wrath, Empathy, Love) are now IMMUNE to
--     conversion. Since Wrath and Love are themselves S-tier, this also makes
--     them immune to each other.
-- The target's tier is checked alongside its camp; a wrong camp OR an S-tier
-- target is a whiff (converted=false), still charged.
-- ============================================

create or replace function convert_player(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_tgt_camp text; v_tgt_tier text; v_new_role text; v_want_camp text; v_tgt_active boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role not in ('wrath','love') or v_acted
     or v_dead or v_prison or v_hosp or v_se < 200 or p_target_id = p_player_id then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target_id and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;

  select vv_role_camp(s.role), vv_role_tier(s.role) into v_tgt_camp, v_tgt_tier
  from player_secrets s where s.player_id = p_target_id;

  if v_role = 'wrath' then
    v_want_camp := 'virtue'; v_new_role := 'vice_worshipper';
  else
    v_want_camp := 'vice'; v_new_role := 'virtue_seeker';
  end if;

  -- Charge regardless (the camp + tier is a gamble).
  update players set soul_energy = soul_energy - 200, acted_this_day = true
  where id = p_player_id;

  -- Lands only on a non-S role of the wanted camp. S-tier roles (Murder, Wrath,
  -- Empathy, Love) are immune to conversion — which also makes Wrath and Love
  -- immune to each other.
  if v_tgt_camp is distinct from v_want_camp or v_tgt_tier = 'S' then
    return jsonb_build_object('ok', true, 'converted', false);
  end if;

  update player_secrets set role = v_new_role,
    pending_action = null, pending_target = null,
    follower_of = case when v_role = 'wrath' then p_player_id else null end
  where player_id = p_target_id;
  update players set acted_this_day = true where id = p_target_id;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, p_target_id,
    case when v_role = 'wrath'
      then 'You have been corrupted by Wrath — you are now a Vice Worshipper, serving the Vices.'
      else 'You have been turned by Love — you are now a Virtue Seeker, serving the Virtues.' end);
  return jsonb_build_object('ok', true, 'converted', true);
end; $$;
grant execute on function convert_player(uuid, uuid) to anon, authenticated;
