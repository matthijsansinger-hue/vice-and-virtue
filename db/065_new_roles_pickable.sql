-- ============================================
-- New roles pickable in role select (migration 065).
-- ============================================
-- The 8 new roles (Wrath, Love, Gambling, Determination, Fanaticism,
-- Generosity, Pride, Diligence) become PICKABLE in the role_select phase for
-- players who have unlocked them (1000 LP / shard drop). Players who haven't
-- see them greyed with a lock. Guests can't own them, so they only get the
-- default 12. Their in-match abilities aren't built yet — the role-action
-- screen shows a "not implemented yet" panel — but camps, voting, the
-- minigame and win checks all work (camp lookups extended below).
--
-- Changes: vv_role_camp + vv_role_tier learn the 8 new roles (this also makes
-- vv_check_winner / minigame scoring / camp counts treat them correctly);
-- select_role validates by camp+tier match and OWNERSHIP (default-12 free,
-- anything else needs an account_role_unlocks row for the player's account)
-- instead of the fixed playable list. resolve_role_select stragglers still
-- default to the original 12 (random of their tier). The random-mode host
-- config (vv_config_slot) stays limited to the original 12 for now.

create or replace function vv_role_camp(p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_role in
      ('murder','intoxication','envy','torment','vengeance','vice_worshipper',
       'wrath','gambling','fanaticism','pride')
      then 'vice'
    when p_role in
      ('empathy','justice','truthfulness','certainty','sacrifice','virtue_seeker',
       'love','determination','generosity','diligence')
      then 'virtue'
    else null
  end;
$$;

create or replace function vv_role_tier(p_role text)
returns text language sql immutable as $$
  select case p_role
    when 'murder' then 'S'        when 'empathy' then 'S'
    when 'wrath' then 'S'         when 'love' then 'S'
    when 'intoxication' then 'A'  when 'justice' then 'A'
    when 'gambling' then 'A'      when 'determination' then 'A'
    when 'envy' then 'B'          when 'certainty' then 'B'
    when 'fanaticism' then 'B'    when 'generosity' then 'B'
    when 'torment' then 'C'       when 'vengeance' then 'C'
    when 'truthfulness' then 'C'  when 'sacrifice' then 'C'
    when 'pride' then 'C'         when 'diligence' then 'C'
    when 'vice_worshipper' then 'D' when 'virtue_seeker' then 'D'
    else null end;
$$;

-- Tentative pick (p_lock=false) or final lock (p_lock=true). The role must
-- match the caller's dealt camp + tier; roles beyond the default 12 also need
-- to be unlocked on the caller's account.
create or replace function select_role(p_player_id uuid, p_role text, p_lock boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_tier text; v_locked boolean;
  v_user uuid;
  c_default text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker'];
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_tier,
         (s.role is not null), p.user_id
    into v_room, v_phase, v_camp, v_tier, v_locked, v_user
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_locked then
    return false;
  end if;
  -- Must be a real role matching the dealt camp + tier (null camp/tier for an
  -- unknown id fails both comparisons).
  if vv_role_camp(p_role) is distinct from v_camp
     or vv_role_tier(p_role) is distinct from v_tier then
    return false;
  end if;
  -- Beyond the default set, the player's account must have unlocked the role.
  if not (p_role = any(c_default)) then
    if v_user is null or not exists (
      select 1 from account_role_unlocks u
      where u.user_id = v_user and u.role = p_role
    ) then
      return false;
    end if;
  end if;

  update player_secrets
  set role_choice = p_role,
      role = case when p_lock then p_role else role end
  where player_id = p_player_id;
  return true;
end;
$$;
grant execute on function select_role(uuid, text, boolean) to anon, authenticated;
