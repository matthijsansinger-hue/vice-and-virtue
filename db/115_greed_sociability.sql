-- Migration 115 — Greed + Sociability, and a flat role price
--
-- Two new roles for the class restructure, filling the thin classes:
--   Greed        (vice,   Obstructor)
--   Sociability  (virtue, Communicator)
--
-- GREED — 100 SE, queued in Role action, resolves AFTER the reflection settles,
-- so it takes what the target has LEFT once everyone has paid for their turn.
-- That timing is the whole point of the role, so rather than editing the
-- ~400-line resolve_role_action_impl, resolve_greed runs straight after it —
-- the same "resolver + override" pattern resolve_soul_escape and
-- resolve_soul_last_standing already use. The target is held in its own column
-- because resolve_role_action clears pending_action/pending_target before we'd
-- get to read them.
--
-- SOCIABILITY — passively exempt from the one-partner-per-cycle outreach lock
-- (migration 111), i.e. she may message everyone, every night. Actively, 75 SE
-- per player to mute them for the rest of the day; she can mute several at once.
--
-- ⚠️ The ability mute is a SEPARATE column from players.muted. players.muted is
-- the moderation auto-mute from repeated reports and must stay sticky for the
-- whole game — if an ability wrote to it, clearing the ability at end of day
-- would quietly un-mute someone the reporting system had silenced.
--
-- Prices are now flat: every unlockable role costs 1500 LP, so unlock_role stops
-- keying on tier (which is being removed with the class restructure).

begin;

-- Muted by an ability for this day. Public (the muted player must see it), and
-- deliberately not a boolean: storing the DAY means it expires on its own when
-- the day advances, with nothing to reset.
alter table players add column if not exists ability_muted_day int;

-- Greed's queued victim. Survives resolve_role_action's pending_* wipe.
alter table player_secrets add column if not exists greed_target uuid;

-- ---------------------------------------------------------------------------
-- The new roles must have a CAMP before anything else works: vv_role_camp
-- drives the win check, the Quiz's Vice/Virtue scoring and Wrath/Love's
-- conversion landing. A role missing here counts for neither side.
create or replace function vv_role_camp(p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_role in
      ('murder','intoxication','envy','torment','vengeance','vice_worshipper',
       'wrath','gambling','fanaticism','pride','greed')
      then 'vice'
    when p_role in
      ('empathy','justice','truthfulness','certainty','sacrifice','virtue_seeker',
       'love','determination','generosity','diligence','sociability')
      then 'virtue'
    when p_role = 'wandering_soul' then 'neutral'  -- anomaly role (migration 094)
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Flat role price (was per-tier, migration 079).
create or replace function unlock_role(p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cost int := 1500;   -- every role, every class (mirror ROLE_UNLOCK_COST in economy.ts)
  v_row account_economy;
  c_all_roles text[] := array[
    'murder','intoxication','envy','torment','vengeance','vice_worshipper',
    'empathy','justice','certainty','truthfulness','sacrifice','virtue_seeker',
    'wrath','love','gambling','determination','fanaticism','generosity','pride',
    'diligence','greed','sociability'];
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_role is null or not (p_role = any(c_all_roles)) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_role');
  end if;
  if exists (select 1 from account_role_unlocks where user_id = v_user and role = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;
  if v_row.life_experience < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'cost', v_cost);
  end if;

  update account_economy set life_experience = life_experience - v_cost
  where user_id = v_user;
  insert into account_role_unlocks (user_id, role) values (v_user, p_role)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'role', p_role, 'cost', v_cost);
end;
$$;
grant execute on function unlock_role(text) to authenticated;

-- ---------------------------------------------------------------------------
-- SOCIABILITY: mute one or more players for the rest of today, 75 SE each.
create or replace function sociability_mute(p_player_id uuid, p_targets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_se numeric; v_day int;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_phase text;
  v_count int; v_cost numeric;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.soul_energy, r.day, p.dead, p.in_prison, p.in_hospital, r.phase
    into v_room, v_role, v_se, v_day, v_dead, v_prison, v_hosp, v_phase
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'sociability' then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if p_targets is null or jsonb_typeof(p_targets) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  select count(distinct e) into v_count from jsonb_array_elements_text(p_targets) e;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  -- Every target must be a living player in this room, and not herself.
  if (
    select count(distinct e) from jsonb_array_elements_text(p_targets) e
    where e <> p_player_id::text
      and exists (select 1 from players where id = e::uuid and room_id = v_room and not dead)
  ) <> v_count then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  v_cost := 75 * v_count;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', v_cost);
  end if;

  -- The Communication potion grants mute immunity (migration 111), so a buyer
  -- silently shrugs it off — she still pays, and is not told which target held.
  update players p set ability_muted_day = v_day
  where p.room_id = v_room
    and p.id::text in (select e from jsonb_array_elements_text(p_targets) e)
    and not coalesce(
      (select s.potion_comms from player_secrets s where s.player_id = p.id), false);

  update players set soul_energy = soul_energy - v_cost where id = p_player_id;

  return jsonb_build_object('ok', true, 'muted', v_count, 'spent', v_cost);
end;
$$;
grant execute on function sociability_mute(uuid, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- GREED: queue the steal (100 SE, charged now — the haul lands at resolution).
create or replace function queue_greed(p_player_id uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_se numeric; v_phase text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_acted boolean;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.soul_energy, r.phase, p.dead, p.in_prison, p.in_hospital, p.acted_this_day
    into v_room, v_role, v_se, v_phase, v_dead, v_prison, v_hosp, v_acted
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'greed' then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;
  if v_acted then
    return jsonb_build_object('ok', false, 'reason', 'already_acted');
  end if;
  if p_target is null or p_target = p_player_id
     or not exists (select 1 from players where id = p_target and room_id = v_room and not dead) then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', 100);
  end if;

  update player_secrets set greed_target = p_target where player_id = p_player_id;
  update players set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function queue_greed(uuid, uuid) to anon, authenticated;

-- Called by the host straight after resolve_role_action, so it sees the Soul
-- Energy everyone has LEFT after paying for this reflection's abilities.
create or replace function resolve_greed(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_amt numeric;
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;

  for r in
    select s.player_id as thief, s.greed_target as victim
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.greed_target is not null
  loop
    -- A Greed who died or was jailed during resolution collects nothing.
    if exists (select 1 from players
               where id = r.thief and not dead and not in_prison and not in_hospital) then
      select soul_energy into v_amt from players
      where id = r.victim and room_id = p_room_id and not dead for update;

      if coalesce(v_amt, 0) > 0 then
        update players set soul_energy = 0 where id = r.victim;
        update players set soul_energy = soul_energy + v_amt where id = r.thief;
        -- Both sides learn what moved; neither learns who the other is, so the
        -- victim can't identify Greed from the notice.
        insert into player_notices (room_id, recipient_id, text) values
          (p_room_id, r.thief,
           format('Your hand closed on %s Soul Energy.', round(v_amt))),
          (p_room_id, r.victim,
           format('Something emptied your purse — %s Soul Energy is gone.', round(v_amt)));
      end if;
    end if;
  end loop;

  update player_secrets s set greed_target = null
  from players p where p.id = s.player_id and p.room_id = p_room_id
    and s.greed_target is not null;
end;
$$;
grant execute on function resolve_greed(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- send_dm: Sociability's passive, plus server-side mute enforcement.
-- Base is migration 111's version; the new parts are marked.
create or replace function send_dm(
  p_room_id uuid, p_sender_id uuid, p_recipient_id uuid, p_day int, p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_dead boolean; v_rec_room uuid;
  v_comms boolean; v_existing uuid;
  v_role text; v_muted boolean; v_muted_day int; v_day int;
begin
  if not vv_is_me(p_sender_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_text is null or length(btrim(p_text)) = 0 then return; end if;
  select room_id, dead into v_room, v_dead from players where id = p_sender_id;
  if v_room is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_room is distinct from p_room_id then raise exception 'wrong room' using errcode = '42501'; end if;
  if v_dead then raise exception 'cannot chat' using errcode = '42501'; end if;
  select room_id into v_rec_room from players where id = p_recipient_id;
  if v_rec_room is distinct from v_room then raise exception 'recipient not in room' using errcode = '42501'; end if;

  select coalesce(s.potion_comms, false), s.role, p.muted, p.ability_muted_day, r.day
    into v_comms, v_role, v_muted, v_muted_day, v_day
  from players p join player_secrets s on s.player_id = p.id join rooms r on r.id = p.room_id
  where p.id = p_sender_id;

  -- NEW: mutes enforced server-side. Covers the report auto-mute (previously
  -- client-only) as well as Sociability's.
  --
  -- Deliberately NOT exempted by the Communication potion: letting a purchase
  -- lift a moderation mute would sell a way out of being reported. The potion's
  -- immunity is applied at mute TIME instead — sociability_mute simply doesn't
  -- silence a buyer — so it counters the ability without touching moderation.
  if coalesce(v_muted, false) or v_muted_day is not distinct from v_day then
    raise exception 'muted' using errcode = '42501';
  end if;

  -- One partner per cycle. Sociability is passively exempt (she may write to
  -- everyone, every night), as is a Communication-potion buyer.
  if not coalesce(v_comms, false) and v_role is distinct from 'sociability' then
    select recipient_id into v_existing
    from dm_messages
    where room_id = v_room and sender_id = p_sender_id and day = p_day
    order by created_at
    limit 1;

    if v_existing is not null and v_existing is distinct from p_recipient_id then
      raise exception 'partner locked' using errcode = '42501';
    end if;
  end if;

  insert into dm_messages (room_id, sender_id, recipient_id, day, text)
  values (v_room, p_sender_id, p_recipient_id, p_day, p_text);
end;
$$;
grant execute on function send_dm(uuid, uuid, uuid, int, text) to anon, authenticated;

commit;
