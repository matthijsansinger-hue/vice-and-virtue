-- ============================================
-- Shared post-minigame clue (migration 045)
-- ============================================
-- After the minigame, show everyone ONE common clue: the player the most
-- others read correctly, and how many got them right. Gives the group a
-- shared talking point for the imprisonment vote.
--
-- Correctness needs the true roles (locked in player_secrets), so the
-- aggregation runs in a SECURITY DEFINER function. Each player's guesses are
-- stored in player_secrets (never sent to the browser); only the aggregate
-- clue (a player id + counts, NOT their camp) is published on rooms.

-- Per-player guesses this round: { "<player_id>": "vice"|"virtue"|"unknown" }.
alter table player_secrets add column if not exists minigame_guesses jsonb;

-- Public aggregate shown on the result screen:
--   { target_id, correct, total }  or  { target_id: null } when no clear read.
alter table rooms add column if not exists minigame_clue jsonb;

-- submit_minigame_guesses: unchanged scoring, but now also PERSISTS the
-- guesses (in the locked table) so compute_minigame_clue can aggregate them.
create or replace function submit_minigame_guesses(
  p_player_id uuid,
  p_guesses jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_score numeric := 0;
  v_target record;
  v_guess text;
  v_truth text;
begin
  select room_id into v_room_id
  from players
  where id = p_player_id and not dead and not in_prison and not in_hospital;
  if v_room_id is null then
    return 0;
  end if;

  for v_target in
    select p.id, s.role
    from players p
    left join player_secrets s on s.player_id = p.id
    where p.room_id = v_room_id
      and p.id <> p_player_id
      and not p.dead
      and not p.in_prison
  loop
    v_guess := p_guesses ->> v_target.id::text;
    v_truth := vv_role_camp(v_target.role);
    if v_guess is null or v_guess = 'unknown' or v_truth is null then
      v_score := v_score + 0.4;
    elsif v_guess = v_truth then
      v_score := v_score + 1;
    else
      v_score := 0;
      exit;
    end if;
  end loop;

  update players
  set minigame_score = v_score,
      minigame_submitted_at = now(),
      ready = true
  where id = p_player_id;

  update player_secrets set minigame_guesses = p_guesses
  where player_id = p_player_id;

  return v_score;
end;
$$;

grant execute on function submit_minigame_guesses(uuid, jsonb) to anon, authenticated;

-- Find the most-correctly-read active player and publish the clue. Counts a
-- guess "correct" when a guesser's stored tag for the target equals the
-- target's true camp ("unknown"/untagged never counts). Then clears this
-- round's guesses so the next round starts clean.
create or replace function compute_minigame_clue(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
  v_correct int;
  v_total int;
begin
  with targets as (
    select p.id as target_id, vv_role_camp(s.role) as camp
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and not p.dead and not p.in_prison
  ),
  guessers as (
    select s.player_id as guesser_id, s.minigame_guesses as g
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and not p.dead and not p.in_prison and not p.in_hospital
      and s.minigame_guesses is not null
  ),
  tally as (
    select t.target_id,
      count(*) filter (where (gr.g ->> t.target_id::text) = t.camp) as correct,
      count(*) as total
    from targets t
    join guessers gr on gr.guesser_id <> t.target_id
    group by t.target_id
  )
  select target_id, correct, total
    into v_target_id, v_correct, v_total
  from tally
  order by correct desc, target_id asc
  limit 1;

  if v_target_id is null or coalesce(v_correct, 0) = 0 then
    update rooms set minigame_clue = jsonb_build_object('target_id', null)
    where id = p_room_id;
  else
    update rooms set minigame_clue = jsonb_build_object(
      'target_id', v_target_id::text,
      'correct', v_correct,
      'total', v_total
    ) where id = p_room_id;
  end if;

  update player_secrets set minigame_guesses = null
  where player_id in (select id from players where room_id = p_room_id);
end;
$$;

grant execute on function compute_minigame_clue(uuid) to anon, authenticated;
