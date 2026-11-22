-- 151_record_results_on_victory.sql — 2026-11-22, Matthijs: "when the game
-- has ended you don't need to wait for everyone to press continue, but you can
-- just click continue yourself to see the match results".
--
-- The client now shows a player's results the moment they press Continue on
-- the victory screen. In server rooms (public / ranked) the results, match
-- rewards and ranked points were only recorded when the screen ENDED (a
-- majority of Continues → vv_srv_finish). Now:
--   * vv_srv_record_results(room, winner) = vv_srv_finish's recording part
--     (status 'ended', record_game_results, grant_match_rewards,
--     apply_ranked_results — each idempotent per room / per user+room);
--   * vv_tick_room calls it on ENTERING a victory screen (its entry block);
--   * vv_srv_finish = record (again, harmless) + phase → game_over, as before.
-- Private lobbies do the same from the host's client (VictoryScreen /
-- SoulVictoryIntro). Safe to run more than once.

begin;

create or replace function vv_srv_record_results(p_room_id uuid, p_winner text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ranked boolean; v_vices int; v_virtues int; v_results jsonb;
begin
  update rooms set status = 'ended' where id = p_room_id and status <> 'ended';

  begin
    perform record_game_results(p_room_id, p_winner);
  exception when others then
    raise warning 'vv_srv_finish: record_game_results failed for %: %', p_room_id, sqlerrm;
  end;

  begin
    perform grant_match_rewards(p_room_id, '[]'::jsonb);
  exception when others then
    raise warning 'vv_srv_finish: grant_match_rewards failed for %: %', p_room_id, sqlerrm;
  end;

  select is_ranked into v_ranked from rooms where id = p_room_id;
  if coalesce(v_ranked, false) then
    begin
      -- diff = |Vices − Virtues still standing| (the win margin), as the client did.
      select count(*) filter (where vv_role_camp(s.role) = 'vice'),
             count(*) filter (where vv_role_camp(s.role) = 'virtue')
        into v_vices, v_virtues
        from players p join player_secrets s on s.player_id = p.id
       where p.room_id = p_room_id and not p.dead and not p.in_prison;
      select coalesce(jsonb_agg(jsonb_build_object(
               'u', g.user_id, 'won', g.won, 'diff', abs(v_vices - v_virtues))), '[]'::jsonb)
        into v_results
        from (select user_id, bool_or(won) as won from game_results
              where room_id = p_room_id group by user_id) g;
      perform apply_ranked_results(p_room_id, v_results);
    exception when others then
      raise warning 'vv_srv_finish: apply_ranked_results failed for %: %', p_room_id, sqlerrm;
    end;
  end if;

end;
$$;
revoke all on function vv_srv_record_results(uuid, text) from public, anon, authenticated;

create or replace function vv_srv_finish(p_room_id uuid, p_winner text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- (151) Usually already done when the victory screen opened; every step in
  -- it is idempotent per room, so doing it again here is harmless.
  perform vv_srv_record_results(p_room_id, p_winner);
  update rooms set phase = 'game_over', phase_ends_at = null where id = p_room_id;
end;
$$;
revoke all on function vv_srv_finish(uuid, text) from public, anon, authenticated;

create or replace function vv_tick_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
  n rooms%rowtype;
  v_key text;
  v_voters int; v_voted int;
  v_tally jsonb;
begin
  -- The server is acting (see header): host-gated resolvers accept this
  -- transaction for the rest of its life.
  perform set_config('vv.server_tick', 'on', true);

  select * into r from rooms where id = p_room_id for update;
  if not found or not r.server_hosted or r.phase = 'game_over' then return; end if;

  -- First tick in a new phase / day / re-vote: entry work.
  v_key := r.phase || ':' || r.day || ':' || coalesce(md5(r.revote_candidates::text), '-');
  if r.server_phase_key is distinct from v_key then
    if r.phase in ('vice_victory_intro', 'virtue_victory_intro', 'soul_victory_intro') then
      -- Reached from a resolver, which doesn't reset ready: start the
      -- Continue majority clean (bots stay ready).
      update players set ready = false where room_id = p_room_id and not is_bot;
      -- (151) Record results, rewards and ranked points now, not when the
      -- screen ends: each player's Continue shows their results straight away.
      perform vv_srv_record_results(p_room_id,
        case r.phase when 'vice_victory_intro' then 'vice'
                     when 'virtue_victory_intro' then 'virtue'
                     else 'neutral' end);
    end if;
    update rooms set server_phase_key = v_key, server_substate = null where id = p_room_id;
    r.server_phase_key := v_key;
    r.server_substate := null;
  end if;

  -- Bots move once per phase / day / re-vote (idempotent inside).
  perform run_bots(p_room_id);
  select * into r from rooms where id = p_room_id;

  if r.phase = 'role_select' then
    -- Bots pick, then lock, each on its own random schedule (migration 127).
    perform vv_bot_role_select_step(p_room_id);
    -- Ends once every HUMAN has locked (nobody waits on a bot: one still
    -- deciding is handed its planned role), or at the deadline.
    if not exists (select 1 from players p join player_secrets s on s.player_id = p.id
                   where p.room_id = p_room_id and s.role is null and not p.is_bot)
       or (r.phase_ends_at is not null and now() >= r.phase_ends_at + interval '1.5 seconds') then
      update player_secrets s set role_choice = s.bot_memory->>'plan'
        from players p
       where p.id = s.player_id and p.room_id = p_room_id and p.is_bot
         and s.role is null and s.bot_memory ? 'plan';
      perform resolve_role_select(p_room_id);
    end if;

  elsif r.phase = 'role_overview' then
    if vv_srv_continue(p_room_id) then
      update players set ready = false where room_id = p_room_id;
      update rooms set phase = 'lore_intro', phase_ends_at = null where id = p_room_id;
    end if;

  elsif r.phase = 'lore_intro' then
    -- Reading the card: majority ready, or 15s. Then the 3.5s flight
    -- (clients play it when phase_ends_at appears), then on.
    if r.phase_ends_at is null then
      if (select t.o_total > 0 and t.o_ready * 2 > t.o_total
            from vv_srv_electorate(p_room_id, 'active') t)
         or now() >= coalesce(r.phase_started_at, now()) + interval '15 seconds' then
        update rooms set phase_ends_at = now() + interval '3.5 seconds' where id = p_room_id;
      end if;
    elsif now() >= r.phase_ends_at + interval '0.5 seconds' then
      if r.role_assign_mode = 'choose' then
        perform vv_srv_start_role_action(p_room_id);
      else
        update players set ready = false where room_id = p_room_id;
        update rooms set phase = 'role_reveal', phase_ends_at = null where id = p_room_id;
      end if;
    end if;

  elsif r.phase = 'role_reveal' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_role_action(p_room_id); end if;

  elsif r.phase = 'role_action' then
    if vv_srv_timed(p_room_id) then perform vv_srv_resolve_role_action(p_room_id); end if;

  elsif r.phase = 'event_summary' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_minigame(p_room_id); end if;

  elsif r.phase = 'minigame' then
    if vv_srv_timed(p_room_id) then
      perform apply_quiz_awards(p_room_id);
      update players set ready = false where room_id = p_room_id;
      update rooms set phase = 'result', phase_ends_at = null where id = p_room_id;
    end if;

  elsif r.phase = 'result' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_outreach(p_room_id); end if;

  elsif r.phase = 'outreach' then
    -- Bots read their messages and answer their partner (migration 129).
    perform vv_bot_outreach_step(p_room_id);
    if vv_srv_timed(p_room_id, 'living') then
      perform enter_store(p_room_id, now() + interval '60 seconds');
    end if;

  elsif r.phase = 'store' then
    if vv_srv_timed(p_room_id) then
      perform resolve_store(p_room_id);
      perform resolve_soul_last_standing(p_room_id);
    end if;

  elsif r.phase = 'store_summary' then
    if vv_srv_continue(p_room_id) then perform vv_srv_start_consultation(p_room_id); end if;

  elsif r.phase = 'consultation' and r.court_step is not null then
    -- The court (migration 141): docket → trial → verdict → settlement.
    perform vv_court_step(p_room_id, false);

  elsif r.phase = 'consultation' then
    if r.server_substate is distinct from 'voted' then
      select count(*), count(*) filter (where has_voted) into v_voters, v_voted
        from players
       where room_id = p_room_id and not dead and not in_prison and not in_hospital;
      if v_voted < v_voters then
        -- Time's up: whoever hasn't voted skips (incl. anyone disconnected).
        if r.phase_ends_at is not null
           and now() >= r.phase_ends_at + interval '1.5 seconds' then
          perform submit_vote_impl(p.id, 'skip')
             from players p
            where p.room_id = p_room_id and not p.dead and not p.in_prison
              and not p.in_hospital and not p.has_voted;
        end if;
        return;
      end if;
      -- Everyone has voted. A first-round tie goes straight to the re-vote
      -- (the host's old decision); anything else opens the result screen.
      v_tally := consultation_tally(p_room_id);
      if v_tally->>'kind' = 'tie' and r.revote_candidates is null then
        perform start_revote(p_room_id, coalesce(v_tally->'tied_ids', '[]'::jsonb));
        return;
      end if;
      -- No ready reset here (migration 135). Clients see "everyone voted"
      -- and offer Continue BEFORE this tick notices, so resetting wiped the
      -- presses made in between and the room sat on the result screen with
      -- nobody ready. Nothing sets ready during the vote (consultation
      -- starts with it cleared), so there's nothing stale to clear.
      update rooms set server_substate = 'voted', phase_ends_at = null where id = p_room_id;
      return;
    end if;
    if vv_srv_continue(p_room_id) then
      perform resolve_consultation(p_room_id);
      perform resolve_soul_last_standing(p_room_id);
    end if;

  elsif r.phase = 'new_day' then
    if r.phase_ends_at is null or now() >= r.phase_ends_at then
      perform vv_srv_start_next_day(p_room_id);
    end if;

  elsif r.phase = 'vice_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'vice'); end if;

  elsif r.phase = 'virtue_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'virtue'); end if;

  elsif r.phase = 'soul_victory_intro' then
    if vv_srv_continue(p_room_id, 'victory') then perform vv_srv_finish(p_room_id, 'neutral'); end if;
  end if;

  -- A resolver above just ended the game (migration 135)? Do the victory
  -- screen's entry work now, in the same transaction: clients show its
  -- Continue the moment the phase changes, and a reset on the NEXT tick
  -- wiped presses made in between.
  select * into n from rooms where id = p_room_id;
  if n.phase in ('vice_victory_intro', 'virtue_victory_intro', 'soul_victory_intro')
     and n.phase is distinct from r.phase then
    update players set ready = false where room_id = p_room_id and not is_bot;
    update rooms
       set server_phase_key = n.phase || ':' || n.day || ':'
                              || coalesce(md5(n.revote_candidates::text), '-'),
           server_substate = null
     where id = p_room_id;
  end if;
end;
$$;

commit;
