-- ============================================
-- Migration 067 — new-role abilities, batch 2: Wrath / Love
-- ============================================
-- Wrath (Vice, A) and Love (Virtue, A) both CONVERT a target: Wrath corrupts a
-- Virtue into a Vice Worshipper (bound to Wrath as a follower), Love turns a
-- Vice into a Virtue Seeker. Conversion replaces the target's role (lose old
-- ability, switch camp), cancels their queued action, and privately tells them.
-- Wrath can additionally relinquish a follower for a lasting extra life. Love
-- can arm a one-day consultation tie-break that resolves a tie into her pick.
--
-- New state:
--   player_secrets.follower_of uuid  — the Wrath this player is bound to
--   rooms.love_tiebreak text         — the Love who armed this day's tie-break
-- ============================================

alter table player_secrets add column if not exists follower_of uuid;  -- the Wrath this player was corrupted by + bound to; cleared on conversion away
alter table rooms add column if not exists love_tiebreak text;          -- SECRET: Love who armed the imprisonment tie-break this day; cleared each new day

-- ---------------------------------------------------------------------------
-- convert_player — Wrath/Love conversion (150 SE, one ability/day, instant).
-- Charged even on a whiff (you gamble on the target's camp). REPLACES the
-- target's role with vice_worshipper (Wrath) / virtue_seeker (Love), cancels
-- their queued action, marks them acted, and privately notices them. Binds a
-- Wrath's victim via follower_of. No resolve_role_action change.
-- ---------------------------------------------------------------------------
create or replace function convert_player(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_tgt_camp text; v_new_role text; v_want_camp text; v_tgt_active boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role not in ('wrath','love') or v_acted
     or v_dead or v_prison or v_hosp or v_se < 150 or p_target_id = p_player_id then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target_id and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;

  select vv_role_camp(s.role) into v_tgt_camp
  from player_secrets s where s.player_id = p_target_id;

  if v_role = 'wrath' then
    v_want_camp := 'virtue'; v_new_role := 'vice_worshipper';
  else
    v_want_camp := 'vice'; v_new_role := 'virtue_seeker';
  end if;

  -- Charge regardless (the camp is a gamble).
  update players set soul_energy = soul_energy - 150, acted_this_day = true
  where id = p_player_id;

  if v_tgt_camp is distinct from v_want_camp then
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

-- ---------------------------------------------------------------------------
-- relinquish_follower — Wrath gives up one living follower for a lasting extra
-- life (100 SE, one ability/day). The follower dies (a consume; extra lives
-- don't save them). Runs the win check (a death occurred).
-- ---------------------------------------------------------------------------
create or replace function relinquish_follower(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_follower uuid; v_winner text;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'wrath' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  select s.player_id into v_follower
  from player_secrets s join players p on p.id = s.player_id
  where s.follower_of = p_player_id and not p.dead
  order by p.created_at limit 1;
  if v_follower is null then return jsonb_build_object('ok', false); end if;

  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  update players set dead = true where id = v_follower;
  update player_secrets set extra_lives = extra_lives + 1 where player_id = p_player_id;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, v_follower, 'Wrath has consumed your life for their own.');

  v_winner := vv_check_winner(v_room);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro' else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = v_room;
  end if;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function relinquish_follower(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- arm_tiebreak — Love arms the deciding vote (100 SE, one ability/day). In THIS
-- day's consultation, a tie that Love voted into breaks to Love's pick (see
-- consultation_tally / resolve_consultation). Cleared each new day.
-- ---------------------------------------------------------------------------
create or replace function arm_tiebreak(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'love' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  update rooms set love_tiebreak = p_player_id::text where id = v_room;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function arm_tiebreak(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- my_follower_count — Wrath's count of living followers (for the relinquish UI).
-- ---------------------------------------------------------------------------
create or replace function my_follower_count(p_player_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from player_secrets s join players p on p.id = s.player_id
  where s.follower_of = p_player_id and not p.dead;
$$;
grant execute on function my_follower_count(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_consultation — add Love's tie-break (migration 067). A tie (max beats
-- skip, multiple tied candidates) that Love armed AND voted into resolves to
-- Love's pick instead of going to a re-vote. Otherwise unchanged from 060.
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

  -- Love's tie-break (migration 067): no unique winner because of a TIE (max
  -- beats skip, multiple candidates) + Love armed the deciding vote + Love
  -- voted for one of the tied candidates → that candidate is imprisoned.
  if v_imprisoned is null then
    declare
      v_love text; v_love_vote text; v_max int := 0; v_tiecnt int := 0;
    begin
      select love_tiebreak into v_love from rooms where id = p_room_id;
      if v_love is not null then
        with tally as (
          select s.vote as target, count(*) as c
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
               and s.vote = v_love_vote group by s.vote having count(*) = v_max
           ) then
          v_imprisoned := v_love_vote;
        end if;
      end if;
    end;
  end if;

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

-- ---------------------------------------------------------------------------
-- consultation_tally — mirror Love's tie-break so the result screen + re-vote
-- gate agree with resolve_consultation: a real tie Love voted into reports as
-- an imprisonment (not a tie), so the host doesn't trigger a needless re-vote.
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
  select
    (select m from mx),
    (select count(*) from tally, mx where tally.c = mx.m and mx.m > 0),
    (select target from tally, mx where tally.c = mx.m and mx.m > 0 limit 1),
    coalesce((select jsonb_agg(target) from tally, mx where tally.c = mx.m and mx.m > 0), '[]'::jsonb)
  into v_max, v_topn, v_imprisoned, v_tied;

  -- Love's tie-break (migration 067): a real tie Love voted into resolves to
  -- Love's pick instead of going to a re-vote (must match resolve_consultation).
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
