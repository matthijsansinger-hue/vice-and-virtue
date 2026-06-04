-- ============================================
-- Migration 031: server-side consultation resolution (Batch 3b-i)
-- ============================================
-- Ports endConsultation + startRevote + instantSacrifice from game.ts.
-- These read every active voter's vote to tally / imprison, so they move
-- server-side. The consultation result SCREEN (display tally, Truthfulness
-- reveal) still reads votes client-side for now — that's removed in the
-- next sub-batch (those reads are display-only and still work until the
-- lockdown). Reads come from player_secrets; outcomes are public.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- End the consultation: tally active voters, imprison the unique majority
-- (must beat the skip count), record who was imprisoned, win-check, then
-- advance to the new-day splash or the victory intro.
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

-- Tie-breaker re-vote: clear votes, store the tied candidates, reset the
-- 95s timer (ports startRevote).
create or replace function start_revote(p_room_id uuid, p_candidate_ids jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update players set vote = null where room_id = p_room_id;
  update rooms set
    revote_candidates = p_candidate_ids,
    phase_ends_at = now() + interval '95 seconds'
  where id = p_room_id;
end;
$$;

grant execute on function start_revote(uuid, jsonb) to anon, authenticated;

-- Instant Sacrifice in consultation: both die immediately, no protect,
-- then win-check (ports instantSacrifice).
create or replace function instant_sacrifice(
  p_room_id uuid, p_player_id uuid, p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner text;
begin
  update players set dead = true, acted_this_day = true where id = p_player_id;
  update players set dead = true where id = p_target_id;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = p_room_id;
  end if;
end;
$$;

grant execute on function instant_sacrifice(uuid, uuid, uuid) to anon, authenticated;
