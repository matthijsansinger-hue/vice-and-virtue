-- Migration 094: The Wandering Soul — a neutral "anomaly" role for odd counts.
--
-- On odd player counts one player becomes the Wandering Soul (camp 'neutral'),
-- so the rest split evenly Vice/Virtue. He wins by ESCAPING: in the Role-action
-- phase he guesses every active player's camp; if all are correct the game ends
-- with him as sole winner. He can buy a 100 SE ward (one cycle: blocks prison,
-- killing, hospitalisation). On the Quiz any V/V guess about him is always wrong
-- (handled automatically by vv_role_camp returning 'neutral').
--
-- Run in Supabase, then mirror into db/schema.sql.

-- 1) Camp lookup: the Wandering Soul is neutral (counted for no camp, so he
--    never blocks a Vice/Virtue win, and Quiz V/V guesses about him are wrong).
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
    when p_role = 'wandering_soul' then 'neutral'
    else null
  end;
$$;

-- 2) New per-player secret state + a public winner marker on the room.
alter table player_secrets
  add column if not exists potion_soul_protect boolean not null default false, -- Soul ward (100 SE): blocks the next imprisonment for a cycle
  add column if not exists soul_escape_guess jsonb;                            -- the Soul's pending camp guesses ({playerId: 'vice'|'virtue'})

alter table rooms
  add column if not exists winner text;  -- 'neutral' when the Wandering Soul escaped (camp wins stay null; GameOver recomputes those)

-- 3) Assignment: carve out one Wandering Soul on odd counts (both modes).
create or replace function assign_roles_and_start(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_config jsonb;
  v_total int;
  v_soul int;     -- 1 on odd counts (the Wandering Soul), else 0
  v_rest int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_ids uuid[];
  v_vice_tiers text[];
  v_virtue_tiers text[];
  v_player record;
  v_i int := 1;
  v_j int;
  c_tiers text[] := array['S','A','B','C','D'];
  v_vice_c text := (array['torment','vengeance'])[1 + floor(random() * 2)::int];
  v_virtue_c text := (array['truthfulness','sacrifice'])[1 + floor(random() * 2)::int];
begin
  select role_assign_mode, role_config into v_mode, v_config
  from rooms where id = p_room_id;

  select count(*) into v_total from players where room_id = p_room_id;
  -- Odd counts get one neutral Wandering Soul so the remainder splits evenly.
  v_soul := v_total % 2;
  v_rest := v_total - v_soul;
  v_vice := floor(v_rest / 2.0);
  v_virtue := v_rest - v_vice;

  if v_mode = 'choose' then
    -- Deal camps + tiers only; roles are picked live in role_select. The Soul
    -- (when present) is the first shuffled player: role auto-locked, no pick.
    select array_agg(id order by random()) into v_ids
    from players where room_id = p_room_id;

    select array_agg(t order by random()) into v_vice_tiers
    from (select coalesce(c_tiers[i], 'D') as t
          from generate_series(1, v_vice) i) q;
    select array_agg(t order by random()) into v_virtue_tiers
    from (select coalesce(c_tiers[i], 'D') as t
          from generate_series(1, v_virtue) i) q;

    for v_i in 1..v_total loop
      if v_soul = 1 and v_i = 1 then
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_tier,
                                    role_choice)
        values (v_ids[1], 'wandering_soul', null, null, null, 'neutral', null,
                'wandering_soul')
        on conflict (player_id) do update
          set role = 'wandering_soul', vote = null, pending_action = null,
              pending_target = null, role_choice = 'wandering_soul',
              assigned_camp = 'neutral', assigned_tier = null;
      else
        v_j := v_i - v_soul;  -- 1..v_rest
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_tier,
                                    role_choice)
        values (v_ids[v_i], null, null, null, null,
                case when v_j <= v_vice then 'vice' else 'virtue' end,
                case when v_j <= v_vice then v_vice_tiers[v_j]
                     else v_virtue_tiers[v_j - v_vice] end,
                null)
        on conflict (player_id) do update
          set role = null, vote = null, pending_action = null,
              pending_target = null, role_choice = null,
              assigned_camp = excluded.assigned_camp,
              assigned_tier = excluded.assigned_tier;
      end if;
      update players set soul_energy = 100, ready = false, has_voted = false
      where id = v_ids[v_i];
    end loop;

    update rooms set
      status = 'in_game', phase = 'role_select',
      phase_ends_at = now() + interval '30 seconds',
      role_pool = null, eye_uses_left = 1, free_uses_left = 1, winner = null
    where id = p_room_id;
    return;
  end if;

  -- 'random': secret deal. Tier slots come from the host's config when valid.
  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'vice', 'S', 'murder'),
        vv_config_slot(v_config, 'vice', 'A', 'intoxication'),
        vv_config_slot(v_config, 'vice', 'B', 'envy'),
        vv_config_slot(v_config, 'vice', 'C', v_vice_c)
      ])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'virtue', 'S', 'empathy'),
        vv_config_slot(v_config, 'virtue', 'A', 'justice'),
        vv_config_slot(v_config, 'virtue', 'B', 'certainty'),
        vv_config_slot(v_config, 'virtue', 'C', v_virtue_c)
      ])[i],
      'virtue_seeker'));
  end loop;
  -- Odd count: add the neutral Wandering Soul to the deal.
  if v_soul = 1 then
    v_roles := array_append(v_roles, 'wandering_soul');
  end if;

  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action,
                                pending_target, assigned_camp, assigned_tier,
                                role_choice)
    values (v_player.id, v_roles[v_i], null, null, null, null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null,
          assigned_camp = null, assigned_tier = null, role_choice = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  update rooms set
    status = 'in_game', phase = 'role_overview', phase_ends_at = null,
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1, winner = null
  where id = p_room_id;
end;
$$;

grant execute on function assign_roles_and_start(uuid) to anon, authenticated;

-- 4) The Wandering Soul submits his escape guess in the Role-action phase. The
--    guess is held in soul_escape_guess (NOT pending_target) so resolve_role_action
--    doesn't clear it before resolve_soul_escape reads it. Free, no SE cost.
create or replace function submit_soul_escape(p_player_id uuid, p_guess jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_phase text; v_role text;
begin
  select r.phase, s.role into v_phase, v_role
  from players p join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_role is distinct from 'wandering_soul' or v_phase is distinct from 'role_action' then
    return false;
  end if;
  update player_secrets set soul_escape_guess = p_guess where player_id = p_player_id;
  update players set acted_this_day = true where id = p_player_id;
  return true;
end;
$$;

grant execute on function submit_soul_escape(uuid, jsonb) to anon, authenticated;

-- 5) Resolve the escape — called by the host right AFTER resolve_role_action.
--    If an active Soul named every active player's camp correctly, he escapes:
--    the game ends with winner = 'neutral'. The guess is consumed each day.
create or replace function resolve_soul_escape(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_soul uuid; v_guess jsonb; v_ok boolean := true; v_active int := 0;
  r record;
begin
  select s.player_id, s.soul_escape_guess into v_soul, v_guess
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.role = 'wandering_soul'
    and s.soul_escape_guess is not null and not p.dead and not p.in_prison
  limit 1;

  -- One attempt per day: clear the guess regardless of outcome.
  update player_secrets set soul_escape_guess = null
  where player_id in (select id from players where room_id = p_room_id);

  if v_soul is null then return false; end if;

  for r in
    select p.id, vv_role_camp(s.role) as camp
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and p.id <> v_soul
      and not p.dead and not p.in_prison
  loop
    v_active := v_active + 1;
    if (v_guess ->> r.id::text) is distinct from r.camp then
      v_ok := false;
    end if;
  end loop;

  if v_ok and v_active > 0 then
    update rooms set phase = 'soul_victory_intro', winner = 'neutral',
      status = 'ended', phase_ends_at = null
    where id = p_room_id;
    return true;
  end if;
  return false;
end;
$$;

grant execute on function resolve_soul_escape(uuid) to anon, authenticated;

-- 6) The Soul's 100 SE ward — his ROLE-ACTION ability (not a market potion).
--    Reuses potion_protect for the kill/hosp block (honoured by this same
--    reflection's resolve_role_action) and sets potion_soul_protect for the
--    imprisonment block in this day's resolve_consultation.
create or replace function buy_soul_ward(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_phase text; v_role text; v_se numeric; v_armed boolean;
begin
  select r.phase, s.role, p.soul_energy, s.potion_soul_protect
    into v_phase, v_role, v_se, v_armed
  from players p join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_role is distinct from 'wandering_soul' or v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_armed then
    return jsonb_build_object('ok', false, 'error', 'already_bought');
  end if;
  if v_se < 100 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_se');
  end if;
  update player_secrets set potion_protect = true, potion_soul_protect = true
  where player_id = p_player_id;
  update players set soul_energy = soul_energy - 100 where id = p_player_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function buy_soul_ward(uuid) to anon, authenticated;

-- 7) Consultation: a warded Wandering Soul can't be jailed; the ward is spent at
--    the end of the consultation either way (one cycle).
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

  -- Love's tie-break (migration 067).
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

  update player_secrets set potion_iron_will = false
  where player_id in (select id from players where room_id = p_room_id);

  if v_imprisoned is not null then
    -- Wandering Soul ward: a warded Soul cannot be jailed this consultation.
    if exists (select 1 from player_secrets
               where player_id = v_imprisoned::uuid and potion_soul_protect) then
      v_imprisoned := null;
    else
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
  end if;

  -- The Soul's one-cycle ward is spent at the end of the consultation.
  update player_secrets set potion_soul_protect = false
  where player_id in (select id from players where room_id = p_room_id);

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
