-- Migration 111 — Outreach partner lock, Communication potion, Mano→LP
--
-- 1) OUTREACH IS NOW ONE PARTNER PER CYCLE. You may send to exactly one player
--    per day (unlimited messages to them); everyone can still RECEIVE from
--    anyone. The partner is not a stored choice — it's derived from the first
--    dm you sent today, so it locks on first send and resets with the day for
--    free (no column, no reset step, nothing to get out of sync).
--
-- 2) COMMUNICATION POTION (100 SE) — the escape hatch from that lock. Armed in
--    the Market, it lets the buyer message ANY player during the next outreach
--    and makes them immune to the report auto-mute. Like the other potions it
--    is armed in day N's shop and spends itself on day N+1's outreach; it is
--    cleared when the NEXT shop opens, so it covers exactly one outreach.
--
-- 3) MANO → LP conversion, which the Shop has been stubbing out since the
--    economy landed. Rates live server-side (the client's copy in
--    monetization.ts is display only).

begin;

-- 1) The armed flag for the Communication potion.
alter table player_secrets add column if not exists potion_comms boolean not null default false;

-- ⚠️ TARGETS buy_potion_impl, NOT buy_potion. Migration 098 renamed the body to _impl
-- and put a thin vv_is_me gate in front under the original name; writing to
-- buy_potion here would REPLACE that gate with this body. (This migration originally
-- did exactly that — see db/112_host_gate_repair.sql.) The wrapper holds the
-- grant, so this side needs none.
create or replace function buy_potion_impl(
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
  v_day int;
  v_se numeric;
  v_dead boolean; v_prison boolean; v_hospital boolean;
  v_cost numeric;
  v_target_role text;
  v_target_dead boolean;
  v_armed boolean;
begin
  select p.room_id, r.phase, r.day, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_phase, v_day, v_se, v_dead, v_prison, v_hospital
  from players p join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_phase is distinct from 'store' then
    return jsonb_build_object('ok', false, 'error', 'not_store');
  end if;
  if v_dead or v_prison or v_hospital then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;

  v_cost := case p_potion
    when 'kill'          then 300
    when 'hospitalise'   then 200
    when 'protect'       then 200
    when 'camp_reveal'   then 200
    when 'eye'           then 150
    when 'vote_reveal'   then 100
    when 'minigame_mult' then 60
    when 'iron_will'     then 200
    when 'comms'         then 100
    else null end;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion');
  end if;
  -- Iron Will is only sold from round 2 onwards (migration 075).
  if p_potion = 'iron_will' and coalesce(v_day, 1) < 2 then
    return jsonb_build_object('ok', false, 'error', 'not_round_2');
  end if;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;

  -- Minigame x2 (arm once).
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

  -- Vote reveal (arm once): see who votes to imprison you this consultation.
  if p_potion = 'vote_reveal' then
    select potion_vote_reveal into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_vote_reveal = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Iron Will (arm once): your imprisonment vote counts double this consultation.
  if p_potion = 'iron_will' then
    select potion_iron_will into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_iron_will = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Communication (arm once): next outreach you may message ANY player
  -- instead of your single locked partner, and reports can't mute you.
  if p_potion = 'comms' then
    select potion_comms into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_comms = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Protection (self, arm once).
  if p_potion = 'protect' then
    select potion_protect into v_armed
    from player_secrets where player_id = p_player_id;
    if v_armed then
      return jsonb_build_object('ok', false, 'error', 'already_bought');
    end if;
    update player_secrets set potion_protect = true
    where player_id = p_player_id;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  -- Revealing Eye (instant info, repeatable): how many Vices/Virtues are still
  -- active. Returned to the BUYER only — no flag stored.
  if p_potion = 'eye' then
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object(
      'ok', true,
      'vices', (
        select count(*) from players p join player_secrets s on s.player_id = p.id
        where p.room_id = v_room_id and not p.dead and not p.in_prison and not p.in_hospital
          and vv_role_camp(s.role) = 'vice'
      ),
      'virtues', (
        select count(*) from players p join player_secrets s on s.player_id = p.id
        where p.room_id = v_room_id and not p.dead and not p.in_prison and not p.in_hospital
          and vv_role_camp(s.role) = 'virtue'
      )
    );
  end if;

  -- Camp reveal (instant info, repeatable).
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

  -- Kill / Hospitalise (arm a target for the next reflection; one of each).
  if p_potion in ('kill', 'hospitalise') then
    if p_target is null or p_target = p_player_id then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    select p.dead into v_target_dead
    from players p where p.id = p_target and p.room_id = v_room_id;
    if v_target_dead is null or v_target_dead then
      return jsonb_build_object('ok', false, 'error', 'bad_target');
    end if;
    if p_potion = 'kill' then
      select potion_kill_target is not null into v_armed
      from player_secrets where player_id = p_player_id;
      if v_armed then
        return jsonb_build_object('ok', false, 'error', 'already_bought');
      end if;
      update player_secrets set potion_kill_target = p_target
      where player_id = p_player_id;
    else
      select potion_hosp_target is not null into v_armed
      from player_secrets where player_id = p_player_id;
      if v_armed then
        return jsonb_build_object('ok', false, 'error', 'already_bought');
      end if;
      update player_secrets set potion_hosp_target = p_target
      where player_id = p_player_id;
    end if;
    update players set soul_energy = soul_energy - v_cost
    where id = p_player_id;
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_potion');
end;
$$;

-- Surface the new flag to the store UI's "bought" state.
-- ⚠️ TARGETS my_potions_impl, NOT my_potions. Migration 098 renamed the body to _impl
-- and put a thin vv_is_me gate in front under the original name; writing to
-- my_potions here would REPLACE that gate with this body. (This migration originally
-- did exactly that — see db/112_host_gate_repair.sql.) The wrapper holds the
-- grant, so this side needs none.
create or replace function my_potions_impl(p_player_id uuid)
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
    'vote_reveal',   coalesce(potion_vote_reveal, false),
    'iron_will',     coalesce(potion_iron_will, false),
    'comms',         coalesce(potion_comms, false)
  )
  from player_secrets where player_id = p_player_id;
$$;

-- Opening the shop clears last cycle's Communication potion: one bought in
-- day N's shop covers day N+1's outreach and expires as day N+1's shop opens.
-- (Guarded by the same idempotency check as the +50 SE, so a re-entry is a
-- no-op rather than a second clear.)
--
-- ⚠️ TARGETS enter_store_impl, NOT enter_store. Migration 097 renamed the body
-- to _impl and put a thin host gate in front under the original name; writing
-- to enter_store here would REPLACE that gate with this body and let any client
-- force the store phase. (This migration originally did exactly that — see
-- db/112_host_gate_repair.sql, which restored the gate.) The wrapper already
-- holds the grant to anon, so this side needs none.
create or replace function enter_store_impl(p_room_id uuid, p_ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select phase from rooms where id = p_room_id) = 'store' then
    return;
  end if;
  update players set soul_energy = soul_energy + 50
  where room_id = p_room_id and not in_prison and not dead;
  update player_secrets s set potion_comms = false
  from players p where p.id = s.player_id and p.room_id = p_room_id
    and s.potion_comms;
  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'store', phase_ends_at = p_ends_at where id = p_room_id;
end;
$$;

-- Outreach partner lock. Everything above the last two checks is unchanged
-- from migration 101; the new part is the one-partner-per-day rule.
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
begin
  if not vv_is_me(p_sender_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_text is null or length(btrim(p_text)) = 0 then return; end if;
  select room_id, dead into v_room, v_dead from players where id = p_sender_id;
  if v_room is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_room is distinct from p_room_id then raise exception 'wrong room' using errcode = '42501'; end if;
  if v_dead then raise exception 'cannot chat' using errcode = '42501'; end if;
  select room_id into v_rec_room from players where id = p_recipient_id;
  if v_rec_room is distinct from v_room then raise exception 'recipient not in room' using errcode = '42501'; end if;

  -- One partner per cycle, unless the Communication potion is armed. The
  -- partner is whoever you first messaged today, so it locks itself on the
  -- first send and resets with the day.
  select coalesce(potion_comms, false) into v_comms
  from player_secrets where player_id = p_sender_id;

  if not coalesce(v_comms, false) then
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

-- Mano → Life Proficiency. Rates are fixed server-side so a client can't
-- invent a tier; account_economy has no client write policy, so this RPC is
-- the only way the balances move.
create or replace function convert_mano_to_lp(p_mano int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lp  int;
  v_bal int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_lp := case p_mano
    when 100  then 300
    when 500  then 1650
    when 1000 then 3600
    else null end;
  if v_lp is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_tier');
  end if;

  select mano into v_bal from account_economy where user_id = v_uid;
  if v_bal is null or v_bal < p_mano then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_mano');
  end if;

  update account_economy
     set mano = mano - p_mano,
         life_experience = life_experience + v_lp
   where user_id = v_uid;

  return jsonb_build_object('ok', true, 'mano', p_mano, 'lp', v_lp);
end;
$$;
grant execute on function convert_mano_to_lp(int) to authenticated;

commit;
