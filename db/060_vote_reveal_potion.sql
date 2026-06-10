-- ============================================
-- Vote-reveal potion (migration 060) — store batch 2c.
-- ============================================
-- The vote-reveal potion (100 SE) lets the buyer see, during the consultation
-- right after the store, who is voting to imprison THEM. Bought in day N's
-- store (arms potion_vote_reveal); read live during day N's consultation via
-- my_voters(); cleared when that consultation resolves (resolve_consultation).
--
-- Extends buy_potion (vote_reveal branch), adds my_voters(player) (gated on the
-- armed flag + consultation phase, so it can't be read during group-action,
-- where player_secrets.vote holds eye/free choices), and redefines
-- resolve_consultation to clear the flag (basing it on the live migration-056
-- version + the clear, and mirroring that into db/schema.sql).

-- ---- buy_potion: add vote_reveal -----------------------------------------
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
  v_target_dead boolean;
  v_armed boolean;
begin
  select p.room_id, r.phase, p.soul_energy, p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_phase, v_se, v_dead, v_prison, v_hospital
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
    when 'vote_reveal'   then 100
    when 'minigame_mult' then 60
    else null end;
  if v_cost is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion');
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
grant execute on function buy_potion(uuid, text, uuid) to anon, authenticated;

-- ---- my_voters: who is voting to imprison the caller ---------------------
-- Only returns data when the caller armed the vote-reveal potion AND the room
-- is in the consultation phase (during group-action, player_secrets.vote holds
-- eye/free choices, which must NOT be read as imprisonment votes). Returns the
-- voters' player ids (the client maps them to display names).
create or replace function my_voters(p_player_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_phase text;
  v_armed boolean;
  v_ids uuid[];
begin
  select p.room_id, r.phase, s.potion_vote_reveal
    into v_room_id, v_phase, v_armed
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_phase is distinct from 'consultation'
     or not coalesce(v_armed, false) then
    return '{}'::uuid[];
  end if;

  select coalesce(array_agg(vp.id order by vp.created_at), '{}')
    into v_ids
  from players vp join player_secrets vs on vs.player_id = vp.id
  where vp.room_id = v_room_id
    and vs.vote = p_player_id::text
    and not vp.dead and not vp.in_prison and not vp.in_hospital;

  return v_ids;
end;
$$;
grant execute on function my_voters(uuid) to anon, authenticated;

-- ---- resolve_consultation: clear the vote-reveal potion ------------------
-- (Migration-056 version — captures Vengeance's jailers — plus clearing the
-- vote-reveal potion, since this consultation is now over. Only runs at the
-- final resolution: a first-round tie goes through start_revote instead, so the
-- potion correctly survives into the re-vote.)
create or replace function resolve_consultation(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skip int := 0;
  v_imprisoned text;
  v_winner text;
begin
  -- The vote-reveal potion only lasts this consultation; retire it now.
  update player_secrets set potion_vote_reveal = false
  where player_id in (select id from players where room_id = p_room_id);

  select count(*) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, count(*) as c
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.in_prison and not p.dead and not p.in_hospital
      and s.vote is not null and s.vote <> 'skip'
    group by s.vote
  ),
  mx as (select coalesce(max(c), 0) as m from tally)
  select case
    when (select m from mx) > 0
     and (select m from mx) > v_skip
     and (select count(*) from tally, mx where tally.c = mx.m) = 1
    then (select target from tally, mx where tally.c = mx.m limit 1)
    else null
  end
  into v_imprisoned;

  if v_imprisoned is not null then
    update players set in_prison = true where id = v_imprisoned::uuid;
    -- If the imprisoned player is Vengeance, permanently remember her jailers.
    if exists (select 1 from player_secrets where player_id = v_imprisoned::uuid and role = 'vengeance') then
      update rooms set vengeance_imprisoners = (
        select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
        from (
          select jsonb_array_elements_text(vengeance_imprisoners) as e
            from rooms where id = p_room_id
          union
          select p.id::text
          from players p join player_secrets s on s.player_id = p.id
          where p.room_id = p_room_id
            and not p.in_prison and not p.dead and not p.in_hospital
            and s.vote = v_imprisoned
        ) u
      )
      where id = p_room_id;
    end if;
  end if;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null,
      last_imprisoned_player = v_imprisoned
    where id = p_room_id;
    return;
  end if;

  update rooms set
    phase = 'new_day',
    phase_ends_at = now() + interval '4 seconds',
    last_imprisoned_player = v_imprisoned
  where id = p_room_id;
end;
$$;
grant execute on function resolve_consultation(uuid) to anon, authenticated;
