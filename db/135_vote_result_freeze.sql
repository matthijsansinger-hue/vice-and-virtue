-- 135: the game froze on the vote result screen
--
-- In a server-hosted room, once everyone had voted each client showed the
-- result (and the prison cutscene) with its Continue button straight away, but
-- the server only noticed on its next tick — and then reset every human's
-- ready flag, wiping the Continue presses made in between. Nobody was ready,
-- so the result screen never advanced. That reset is gone (ready is already
-- cleared when the consultation starts, and nothing sets it during the vote).
--
-- The victory screens had the same gap: their ready reset ran on the tick
-- AFTER the one that ended the game. It now runs in the same tick.
--
-- Requires 131. Safe to re-run.

begin;

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
revoke all on function vv_tick_room(uuid) from public, anon, authenticated;

commit;
