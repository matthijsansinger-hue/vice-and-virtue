-- ============================================
-- Migration 075 — Determination 125 SE + the Iron Will potion
-- ============================================
-- 1. Determination's extra life costs 125 SE (was 100).
-- 2. New "Iron Will" store potion (150 SE): the buyer's imprisonment vote counts
--    DOUBLE in the upcoming consultation. Buyable only from round 2 onwards. The
--    consultation tallies (resolve_consultation + consultation_tally) sum votes
--    by weight (2 for an iron-will buyer, else 1); the flag is cleared after the
--    vote, so it only ever affects one consultation.
-- ============================================

alter table player_secrets add column if not exists potion_iron_will boolean not null default false;

-- ---------------------------------------------------------------------------
-- Determination: extra life now costs 125 SE.
-- ---------------------------------------------------------------------------
create or replace function buy_extra_life(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_lives int;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'determination'
     or v_dead or v_prison or v_hosp or v_se < 125 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 125, acted_this_day = true
  where id = p_player_id;
  update player_secrets set extra_lives = extra_lives + 1
  where player_id = p_player_id returning extra_lives into v_lives;
  return jsonb_build_object('ok', true, 'extra_lives', v_lives);
end; $$;
grant execute on function buy_extra_life(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- buy_potion — add the Iron Will potion (150 SE, round 2+, arm once).
-- ---------------------------------------------------------------------------
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
    when 'vote_reveal'   then 100
    when 'minigame_mult' then 60
    when 'iron_will'     then 150
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

  -- Kill / Hospitalise (arm a target; one of each).
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

-- ---------------------------------------------------------------------------
-- my_potions — surface the iron-will armed state for the store UI.
-- ---------------------------------------------------------------------------
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
    'vote_reveal',   coalesce(potion_vote_reveal, false),
    'iron_will',     coalesce(potion_iron_will, false)
  )
  from player_secrets where player_id = p_player_id;
$$;
grant execute on function my_potions(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_consultation — weight votes by Iron Will (2 / 1), clear it after.
-- ---------------------------------------------------------------------------
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
  -- The vote-reveal potion only lasts this consultation; retire it now. (The
  -- iron-will potion is cleared AFTER the weighted tallies below — migration
  -- 075 — since they need to read it to double the buyer's vote.)
  update player_secrets set potion_vote_reveal = false
  where player_id in (select id from players where room_id = p_room_id);

  select coalesce(sum(case when s.potion_iron_will then 2 else 1 end), 0) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, sum(case when s.potion_iron_will then 2 else 1 end) as c
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

  -- Love's tie-break (migration 067): a TIE (max beats skip, multiple
  -- candidates) that Love armed + voted into resolves to Love's pick.
  if v_imprisoned is null then
    declare
      v_love text; v_love_vote text; v_max int := 0; v_tiecnt int := 0;
    begin
      select love_tiebreak into v_love from rooms where id = p_room_id;
      if v_love is not null then
        with tally as (
          select s.vote as target, sum(case when s.potion_iron_will then 2 else 1 end) as c
          from players p join player_secrets s on s.player_id = p.id
          where p.room_id = p_room_id
            and not p.in_prison and not p.dead and not p.in_hospital
            and s.vote is not null and s.vote <> 'skip'
          group by s.vote
        ), mx as (select coalesce(max(c), 0) as m from tally)
        select (select m from mx),
               (select count(*) from tally, mx where tally.c = mx.m and mx.m > 0)
        into v_max, v_tiecnt;
        select s.vote into v_love_vote from player_secrets s where s.player_id = v_love::uuid;
        if v_max > v_skip and v_tiecnt > 1 and v_love_vote is not null
           and exists (
             select 1 from players p join player_secrets s on s.player_id = p.id
             where p.room_id = p_room_id and not p.in_prison and not p.dead and not p.in_hospital
               and s.vote = v_love_vote
             group by s.vote having sum(case when s.potion_iron_will then 2 else 1 end) = v_max
           ) then
          v_imprisoned := v_love_vote;
        end if;
      end if;
    end;
  end if;

  -- Iron-will potion fired this consultation; retire it now (migration 075).
  update player_secrets set potion_iron_will = false
  where player_id in (select id from players where room_id = p_room_id);

  if v_imprisoned is not null then
    update players set in_prison = true where id = v_imprisoned::uuid;
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

-- ---------------------------------------------------------------------------
-- consultation_tally — mirror the weighted vote counting (result + re-vote gate).
-- ---------------------------------------------------------------------------
create or replace function consultation_tally(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_skip int := 0;
  v_max int := 0;
  v_topn int := 0;
  v_imprisoned text;
  v_tied jsonb;
begin
  -- Iron Will (migration 075): votes are summed by weight (2 / 1), not counted —
  -- must match resolve_consultation.
  select coalesce(sum(case when s.potion_iron_will then 2 else 1 end), 0) into v_skip
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and not p.in_prison and not p.dead and not p.in_hospital
    and s.vote = 'skip';

  with tally as (
    select s.vote as target, sum(case when s.potion_iron_will then 2 else 1 end) as c
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.in_prison and not p.dead and not p.in_hospital
      and s.vote is not null and s.vote <> 'skip'
    group by s.vote
  ),
  mx as (select coalesce(max(c), 0) as m from tally)
  select
    (select m from mx),
    (select count(*) from tally, mx where tally.c = mx.m and mx.m > 0),
    (select target from tally, mx where tally.c = mx.m and mx.m > 0 limit 1),
    coalesce((select jsonb_agg(target) from tally, mx where tally.c = mx.m and mx.m > 0), '[]'::jsonb)
  into v_max, v_topn, v_imprisoned, v_tied;

  -- Love's tie-break: a real tie Love voted into resolves to Love's pick.
  if v_topn > 1 and v_max > v_skip then
    declare
      v_love text; v_love_vote text;
    begin
      select love_tiebreak into v_love from rooms where id = p_room_id;
      if v_love is not null then
        select s.vote into v_love_vote from player_secrets s where s.player_id = v_love::uuid;
        if v_love_vote is not null and v_tied ? v_love_vote then
          return jsonb_build_object('kind','imprisoned','imprisoned_id',v_love_vote,'tied_ids','[]'::jsonb);
        end if;
      end if;
    end;
  end if;

  if v_max = 0 then
    return jsonb_build_object('kind','no_votes','imprisoned_id',null,'tied_ids','[]'::jsonb);
  elsif v_skip >= v_max then
    return jsonb_build_object('kind','skip_majority','imprisoned_id',null,'tied_ids','[]'::jsonb);
  elsif v_topn > 1 then
    return jsonb_build_object('kind','tie','imprisoned_id',null,'tied_ids',v_tied);
  else
    return jsonb_build_object('kind','imprisoned','imprisoned_id',v_imprisoned,'tied_ids','[]'::jsonb);
  end if;
end;
$$;

grant execute on function consultation_tally(uuid) to anon, authenticated;
