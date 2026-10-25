-- Migration 131 — Bot fixes: never block "next day", Torment on anyone, inked bots
--
-- Playtest notes (Matthijs, 2026-10-26):
--   * In hospital at the end of the day, the bots never "continued" to the next
--     day. Cause: when everyone had voted, vv_tick_room reset `ready` for the
--     result screen — bots included. With no ACTIVE human left (the only human
--     was in hospital) the bots alone decide that screen, but nothing set them
--     ready again, so it never advanced. Now the reset spares bots, and the
--     electorate counts a bot as ready ALWAYS, so a bot can never hold a gate.
--   * Bots only ever Tormented humans. They now ink anyone, bot or human — and
--     a tormented bot is affected too: it can't tell who it's talking to, so it
--     judges claims by personality alone, can't credit or blame the sender when
--     a claim checks out (claims are stored without a sender), ignores
--     "I'm a Virtue/Vice" from a stranger it can't identify, and picks a random
--     conversation partner instead of an ally.
--
-- REQUIRES migrations 128 and 130 to have been applied first (it redefines
-- functions from both, and the bot chat from 129 depends on 128's helpers).
-- Run order: 128 → 130 → 131. Safe to re-run.

begin;

create or replace function vv_srv_electorate(p_room_id uuid, p_mode text)
returns table (o_total int, o_ready int, o_humans int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_tier text := p_mode;
begin
  if p_mode = 'victory' then
    if exists (select 1 from players where room_id = p_room_id
               and not dead and not in_prison and not in_hospital) then
      v_tier := 'active';
    elsif exists (select 1 from players where room_id = p_room_id and not dead) then
      v_tier := 'living';
    else
      v_tier := 'all';
    end if;
  end if;

  return query
  with pool as (
    -- A bot counts as ready ALWAYS (migration 131): bots act instantly and
    -- must never hold a screen, even after a mid-phase ready reset.
    select pl.is_bot as bot, (pl.ready or pl.is_bot) as rdy from players pl
    where pl.room_id = p_room_id
      and (v_tier = 'all'
           or (v_tier = 'living' and not pl.dead)
           or (v_tier = 'active' and not pl.dead and not pl.in_prison and not pl.in_hospital))
  ), hum as (select * from pool where not bot)
  select
    case when (select count(*) from hum) > 0
         then (select count(*) from hum) else (select count(*) from pool) end::int,
    case when (select count(*) from hum) > 0
         then (select count(*) from hum where rdy)
         else (select count(*) from pool where rdy) end::int,
    (select count(*) from hum)::int;
end;
$$;
revoke all on function vv_srv_electorate(uuid, text) from public, anon, authenticated;

create or replace function vv_tick_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
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
      -- Humans only (migration 131): resetting the bots too left a room with
      -- no active human (e.g. the only human in hospital) stuck on the
      -- "next day" screen forever.
      update players set ready = false where room_id = p_room_id and not is_bot;
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
end;
$$;
revoke all on function vv_tick_room(uuid) from public, anon, authenticated;

create or replace function vv_bot_role_action(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_role text; v_camp text; v_se numeric; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_day integer;
  v_t uuid; v_ally uuid; v_role_seen text; v_res jsonb; e jsonb; v jsonb;
  v_jailers uuid[]; v_enemies uuid[]; v_known jsonb;
  v_spend numeric;        -- what it may spend without touching its savings
  v_sure boolean;         -- target is a KNOWN enemy (not just suspected)
  v_threat boolean;
begin
  select p.room_id, s.role, vv_role_camp(s.role), p.soul_energy, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, r.day
    into v_room, v_role, v_camp, v_se, v_acted, v_dead, v_prison, v_hosp, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_room is null or v_dead then return; end if;

  -- A bomb that has sat a full day must be passed: to an enemy it has
  -- information on, else (left alone) it relocates randomly anyway.
  if exists (
       select 1 from rooms r, jsonb_array_elements(coalesce(r.bombs, '[]'::jsonb)) b
       where r.id = v_room and (b->>'holder')::uuid = p_bot
         and coalesce((b->>'since')::int, v_day) < v_day) then
    v_t := vv_bot_target(p_bot);
    if v_t is not null then perform pass_bomb_impl(p_bot, v_t); end if;
  end if;

  -- Imprisoned: only Vengeance acts — revenge on a jailer (she knows them).
  if v_prison then
    if v_role = 'vengeance' and not v_acted and v_se >= 150 then
      select coalesce(array_agg(pl.id), '{}') into v_jailers
        from rooms rm join players pl on pl.room_id = rm.id and not pl.dead
       where rm.id = v_room and rm.vengeance_imprisoners ? pl.id::text;
      foreach v_t in array v_jailers loop
        perform vv_bot_suspect(p_bot, v_t, 1);
      end loop;
      v_t := vv_bot_enemy(p_bot, v_jailers, false);
      if v_t is not null and random() < 0.8 then
        update player_secrets
           set pending_action = 'vengeance_kill',
               pending_target = jsonb_build_array(v_t::text)::text
         where player_id = p_bot;
        update players set soul_energy = soul_energy - 150, acted_this_day = true
         where id = p_bot;
      end if;
    end if;
    return;
  end if;
  if v_hosp or v_acted then return; end if;

  v_spend := v_se - vv_bot_reserve(p_bot);
  v_known := vv_bot_known(p_bot);

  if v_role = 'murder' then
    v_t := vv_bot_target(p_bot);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null and v_spend >= 150
       and random() < (case when v_sure then 0.9 else 0.5 end) then
      perform vv_bot_queue(p_bot, 150, 'kill', v_t::text);
    end if;

  elsif v_role in ('intoxication', 'vengeance') then
    v_t := vv_bot_target(p_bot);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null
       and v_spend >= (case when v_role = 'vengeance' then 150 else 100 end)
       and random() < (case when v_sure then 0.75 else 0.35 end) then
      perform vv_bot_queue(p_bot, case when v_role = 'vengeance' then 150 else 100 end,
                           'intox', v_t::text);
    end if;

  elsif v_role = 'envy' then
    -- Wearing a known enemy's face sends their votes astray.
    v_t := vv_bot_enemy(p_bot, null, true, true);
    if v_t is not null and v_spend >= 100 and random() < 0.45 then
      perform vv_bot_queue(p_bot, 100, 'envy_swap', v_t::text);
    end if;

  elsif v_role = 'torment' then
    -- Any enemy it has information on, bot or human: since migration 131 a
    -- tormented bot can't tell who it's talking to either.
    v_t := vv_bot_target(p_bot, true, false);
    v_sure := v_t is not null and v_known ? v_t::text;
    if v_t is not null and v_spend >= 100
       and random() < (case when v_sure then 0.6 else 0.3 end) then
      perform vv_bot_queue(p_bot, 100, 'torment', v_t::text);
    end if;

  elsif v_role = 'justice' then
    v_t := vv_bot_enemy(p_bot, null, true, true);      -- a KNOWN Vice only
    v_threat := vv_bot_threatened(p_bot);
    if v_t is not null and v_spend >= 200 and random() < 0.75 then
      perform vv_bot_queue(p_bot, 200, 'kill', v_t::text);
    elsif v_spend >= 100 then
      v_ally := vv_bot_ally(p_bot);
      -- Shield only when it matters: the team is in danger, or a known ally
      -- is worth guarding now and then.
      if v_threat and random() < 0.7 then
        perform vv_bot_queue(p_bot, 100, 'protect',
          (case when v_ally is not null and random() < 0.4 then v_ally else p_bot end)::text);
      elsif v_ally is not null and random() < 0.3 then
        perform vv_bot_queue(p_bot, 100, 'protect', v_ally::text);
      end if;
    end if;

  elsif v_role = 'certainty' then
    -- An information role: reading a role IS how it learns. Holds back while
    -- saving, and once it already has someone to act on.
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null and v_spend >= 125
       and random() < (case when vv_bot_target(p_bot) is null then 0.75 else 0.3 end) then
      v_role_seen := reveal_role_impl(p_bot, v_t);
      if v_role_seen is not null then
        perform vv_bot_learn(p_bot, v_t, vv_role_camp(v_role_seen));
      end if;
    end if;

  elsif v_role = 'empathy' then
    -- Who voted against me / my known allies last time is suspicious.
    if v_day >= 2 and v_spend >= 150
       and random() < (case when vv_bot_target(p_bot) is null then 0.6 else 0.25 end) then
      v_res := reveal_votes_empathy_impl(p_bot);
      for e in select * from jsonb_array_elements(coalesce(v_res, '[]'::jsonb)) loop
        if (e->>'target_id') = p_bot::text
           or (vv_bot_known(p_bot)->>(e->>'target_id')) = v_camp then
          for v in select * from jsonb_array_elements(coalesce(e->'voter_ids', '[]'::jsonb)) loop
            perform vv_bot_suspect(p_bot, (v #>> '{}')::uuid, 1);
          end loop;
        end if;
      end loop;
    end if;

  elsif v_role in ('vice_worshipper', 'virtue_seeker') then
    v_ally := vv_bot_ally(p_bot);
    v_t := vv_bot_enemy(p_bot, null, false, true);      -- guess only among KNOWN enemies
    if v_ally is not null and v_spend >= 100 and random() < 0.5 then
      perform reveal_self_impl(p_bot, v_ally);
    elsif v_t is not null and v_day >= 2 and v_spend >= 100 and random() < 0.3 then
      perform vv_bot_queue(p_bot, 100,
        case when v_role = 'vice_worshipper' then 'worshipper_guess' else 'seeker_guess' end,
        v_t::text);
    end if;

  elsif v_role = 'sacrifice' then
    -- Only worth dying for two KNOWN, active enemies.
    select coalesce(array_agg(p.id order by random()), '{}') into v_enemies
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not p.in_prison and not p.in_hospital
       and v_known ? p.id::text
       and (v_known->>p.id::text) <> v_camp;
    if coalesce(array_length(v_enemies, 1), 0) >= 2 and v_spend >= 400 and random() < 0.7 then
      perform vv_bot_queue(p_bot, 400, 'sacrifice',
        (select jsonb_agg(x::text) from unnest(v_enemies[1:2]) x)::text);
    end if;

  elsif v_role = 'generosity' then
    v_ally := vv_bot_ally(p_bot);
    v_threat := vv_bot_threatened(p_bot);
    if v_ally is not null and v_spend >= 200 and random() < 0.5 then
      perform grant_extra_life_impl(p_bot, v_ally);
    elsif v_threat and v_spend >= 200 and random() < 0.5 then
      perform grant_extra_life_impl(p_bot, p_bot);
    elsif v_ally is not null and v_spend >= 100 and random() < 0.3 then
      perform gift_soul_energy_impl(p_bot, v_ally);
    end if;
  end if;
  -- truthfulness: its ability is on the consultation result screen; bots skip it.
end;
$$;
revoke all on function vv_bot_role_action(uuid) from public, anon, authenticated;

-- Is this bot under Torment's ink today? (rooms.torment_target, cleared at the
-- next new day.) Its Outreach then hides who is talking — just as for a human.
create or replace function vv_bot_tormented(p_bot uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select r.torment_target = p_bot::text
                     from players p join rooms r on r.id = p.room_id
                    where p.id = p_bot), false);
$$;
revoke all on function vv_bot_tormented(uuid) from public, anon, authenticated;

create or replace function vv_bot_believes(p_bot uuid, p_sender uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_style text; v_camp text; v_mem jsonb; v_known jsonb; v_p numeric;
  v_trust numeric; v_sus numeric;
begin
  v_style := vv_bot_persona(p_bot)->>'style';
  -- Inked (migration 131): it can't see who this is, so only its personality
  -- decides.
  if vv_bot_tormented(p_bot) then
    return random() < case v_style when 'trusting' then 0.75
                                   when 'skeptical' then 0.2 else 0.5 end;
  end if;
  select vv_role_camp(s.role), s.bot_memory into v_camp, v_mem
    from player_secrets s where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);

  if coalesce(v_mem->'liars', '[]'::jsonb) ? p_sender::text then return random() < 0.05; end if;

  v_p := case v_style when 'trusting' then 0.75 when 'skeptical' then 0.2 else 0.5 end;
  if (v_known->>p_sender::text) = v_camp then
    v_p := case v_style when 'trusting' then 0.97 when 'skeptical' then 0.75 else 0.9 end;
  elsif v_known ? p_sender::text then
    v_p := case v_style when 'trusting' then 0.2 when 'skeptical' then 0.03 else 0.1 end;
  end if;

  v_trust := coalesce((v_mem->'trust'->>p_sender::text)::numeric, 0);
  v_sus := coalesce((v_mem->'sus'->>p_sender::text)::numeric, 0);
  v_p := least(0.98, greatest(0.02, v_p + 0.15 * v_trust - 0.15 * greatest(v_sus, 0)));
  return random() < v_p;
end;
$$;
revoke all on function vv_bot_believes(uuid, uuid) from public, anon, authenticated;

create or replace function vv_bot_hear(p_bot uuid, p_sender uuid, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_about uuid;
  v_subj uuid; v_camp text; v_truth text; v_mycamp text; v_day integer;
  v_known jsonb; v_believed boolean; v_delta numeric; v_mem jsonb;
  v_ink boolean := vv_bot_tormented(p_bot);   -- can't see who's talking (131)
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  select vv_role_camp(s.role), r.day, s.bot_memory into v_mycamp, v_day, v_mem
    from player_secrets s
    join players p on p.id = s.player_id
    join rooms r on r.id = p.room_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);

  if v_key in ('ask_suspect', 'ask_side') then return 'question'; end if;
  -- Inked: "I'm a Virtue" from someone it can't identify tells it nothing.
  if v_ink and v_key in ('self_vice', 'self_virtue') then return 'doubted'; end if;

  -- Camp claims: about someone else, or the sender about themselves.
  if v_key in ('claim_vice', 'claim_virtue') then
    v_subj := v_about;
    v_camp := case when v_key = 'claim_vice' then 'vice' else 'virtue' end;
  elsif v_key in ('self_vice', 'self_virtue') then
    v_subj := p_sender;
    v_camp := case when v_key = 'self_vice' then 'vice' else 'virtue' end;
  end if;

  if v_subj is not null then
    v_truth := case when v_subj = p_bot then v_mycamp else v_known->>v_subj::text end;
    if v_truth is not null then
      -- (Inked, it knows whether the claim is true but not whom to credit.)
      if v_truth = v_camp then
        if not v_ink then
          perform vv_bot_set(p_bot, 'trust', coalesce(v_mem->'trust', '{}'::jsonb)
            || jsonb_build_object(p_sender::text,
                 coalesce((v_mem->'trust'->>p_sender::text)::numeric, 0) + 1));
        end if;
        return 'known_true';
      end if;
      -- Caught in a lie: strongly suspect the liar.
      if not v_ink then
        perform vv_bot_suspect(p_bot, p_sender, 2);
        if not (coalesce(v_mem->'liars', '[]'::jsonb) ? p_sender::text) then
          perform vv_bot_set(p_bot, 'liars',
            coalesce(v_mem->'liars', '[]'::jsonb) || jsonb_build_array(p_sender::text));
        end if;
      end if;
      return 'known_false';
    end if;

    v_believed := vv_bot_believes(p_bot, p_sender);
    -- Remember it either way: batch 2 checks unverified claims in the Quiz /
    -- Market. Keep the last 30.
    perform vv_bot_set(p_bot, 'claims', (
      select coalesce(jsonb_agg(c), '[]'::jsonb) from (
        select c from jsonb_array_elements(
          coalesce(v_mem->'claims', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'from', case when v_ink then null else p_sender::text end,
            'about', v_subj::text, 'camp', v_camp,
            'day', v_day, 'believed', v_believed))) with ordinality t(c, n)
        order by n desc limit 30) x));
    if v_believed then
      perform vv_bot_suspect(p_bot, v_subj, case when v_camp = v_mycamp then -1 else 1 end);
      return 'believed';
    end if;
    return 'doubted';
  end if;

  -- Opinions about a third player.
  if v_key in ('suspect', 'trust', 'vote') and v_about is not null and v_about <> p_bot then
    v_believed := vv_bot_believes(p_bot, p_sender);
    if v_believed then
      v_delta := case when v_key = 'trust' then -0.5 else 0.5 end;
      -- Never start suspecting someone it KNOWS is on its side.
      if not (v_delta > 0 and (v_known->>v_about::text) = v_mycamp) then
        perform vv_bot_suspect(p_bot, v_about, v_delta);
      end if;
      return 'believed';
    end if;
    return 'doubted';
  end if;

  return 'none';
end;
$$;
revoke all on function vv_bot_hear(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function vv_bot_learn(p_bot uuid, p_target uuid, p_camp text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp text; v_mem jsonb; c jsonb;
  v_keep jsonb := '[]'::jsonb; v_trust jsonb; v_liars jsonb;
begin
  if p_bot is null or p_target is null or p_camp is null then return; end if;
  v_camp := case when p_camp in ('vice', 'virtue') then p_camp else 'neutral' end;

  update player_secrets
     set bot_memory = jsonb_set(bot_memory, '{known}',
           coalesce(bot_memory->'known', '{}'::jsonb) || jsonb_build_object(p_target::text, v_camp))
   where player_id = p_bot;

  select bot_memory into v_mem from player_secrets where player_id = p_bot;
  v_trust := coalesce(v_mem->'trust', '{}'::jsonb);
  v_liars := coalesce(v_mem->'liars', '[]'::jsonb);

  for c in select * from jsonb_array_elements(coalesce(v_mem->'claims', '[]'::jsonb)) loop
    if c->>'about' = p_target::text then
      if c->>'from' is null then
        null;   -- told while inked (131): nobody to credit or blame
      elsif c->>'camp' = v_camp then
        v_trust := v_trust || jsonb_build_object(c->>'from',
                     coalesce((v_trust->>(c->>'from'))::numeric, 0) + 1);
      else
        if not (v_liars ? (c->>'from')) then
          v_liars := v_liars || jsonb_build_array(c->>'from');
        end if;
        perform vv_bot_suspect(p_bot, (c->>'from')::uuid, 2);
      end if;
    else
      v_keep := v_keep || jsonb_build_array(c);
    end if;
  end loop;

  -- Merge onto the CURRENT memory (vv_bot_suspect just wrote 'sus').
  update player_secrets
     set bot_memory = bot_memory || jsonb_build_object('claims', v_keep, 'trust', v_trust, 'liars', v_liars)
   where player_id = p_bot;
end;
$$;
revoke all on function vv_bot_learn(uuid, uuid, text) from public, anon, authenticated;

create or replace function vv_bot_reply(p_bot uuid, p_sender uuid, p_payload jsonb, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'s';
  v_about uuid;
  v_style text; v_bluff numeric; v_mycamp text; v_known jsonb; v_room uuid;
  v_reply text; v_reply_about uuid; v_t uuid; v_honest boolean;
begin
  begin
    v_about := (p_payload->>'about')::uuid;
  exception when others then
    v_about := null;
  end;
  v_style := vv_bot_persona(p_bot)->>'style';
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  select vv_role_camp(s.role), p.room_id into v_mycamp, v_room
    from player_secrets s join players p on p.id = s.player_id
   where s.player_id = p_bot;
  v_known := vv_bot_known(p_bot);
  v_honest := random() >= v_bluff;

  if v_key = 'bye' then
    return;                                   -- the conversation is over
  elsif v_key = 'thanks' then
    v_reply := 'bye';
  elsif v_key in ('believe', 'disbelieve', 'check', 'no_idea') then
    v_reply := case when random() < 0.6 then 'thanks' else 'bye' end;

  elsif v_key = 'ask_side' then
    -- To a known ally: the truth. Otherwise a Vice nearly always claims
    -- Virtue, and a Virtue tells the truth unless it's bluffing.
    if (v_known->>p_sender::text) = v_mycamp and not vv_bot_tormented(p_bot) then
      v_reply := case when v_mycamp = 'vice' then 'self_vice' else 'self_virtue' end;
    elsif v_mycamp = 'vice' then
      v_reply := case when random() < 0.9 then 'self_virtue' else 'self_vice' end;
    else
      v_reply := case when v_honest then 'self_virtue' else 'self_vice' end;
    end if;

  elsif v_key = 'ask_suspect' then
    if v_honest then
      v_t := vv_bot_target(p_bot, false);
      if v_t is not null and v_t <> p_sender then
        v_reply := 'suspect'; v_reply_about := v_t;
      else
        v_reply := 'no_idea';
      end if;
    else
      select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_t
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, p_sender);
      if v_t is not null then v_reply := 'suspect'; v_reply_about := v_t;
      else v_reply := 'no_idea'; end if;
    end if;

  elsif v_key in ('suspect', 'vote') and v_about = p_bot then
    -- Accused: defend itself (a Vice lies about its camp).
    v_reply := case when v_mycamp = 'vice' and random() < 0.9 then 'self_virtue'
                    when v_mycamp = 'vice' then 'disbelieve'
                    else 'self_virtue' end;
  elsif v_key = 'trust' and v_about = p_bot then
    v_reply := 'thanks';

  elsif p_outcome in ('known_true', 'believed') then
    v_reply := case when p_outcome = 'believed' and v_style <> 'trusting' and random() < 0.3
                    then 'check' else 'believe' end;
  elsif p_outcome in ('known_false', 'doubted') then
    if random() < v_bluff then
      v_reply := 'believe';                   -- keep its doubts to itself
    elsif p_outcome = 'known_false' then
      v_reply := 'disbelieve';
    else
      v_reply := case when v_style = 'skeptical' and random() < 0.5 then 'check'
                      when random() < 0.6 then 'disbelieve' else 'check' end;
    end if;
  else
    v_reply := 'no_idea';                     -- never leave it unanswered
  end if;

  perform vv_send_sentence(p_bot, p_sender, v_reply, v_reply_about);
end;
$$;
revoke all on function vv_bot_reply(uuid, uuid, jsonb, text) from public, anon, authenticated;

create or replace function vv_bot_initiate(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_mycamp text; v_bluff numeric; v_known jsonb; v_sus jsonb;
  v_partner uuid; v_ally boolean; v_t uuid; v_tcamp text; v_lie boolean;
  v_key text; v_about uuid; r numeric;
  v_ink boolean := vv_bot_tormented(p_bot);   -- inked: can't pick by who (131)
begin
  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_mycamp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_bluff := coalesce((vv_bot_persona(p_bot)->>'bluff')::numeric, 0.2);
  v_known := vv_bot_known(p_bot);

  select p.id into v_partner
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and not v_ink
     and ((v_known->>p.id::text) = v_mycamp
          or coalesce((v_sus->>p.id::text)::numeric, 0) < 0)
   order by random() limit 1;
  if v_partner is null then
    select p.id into v_partner
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not v_ink
       and (v_known->>p.id::text) is distinct from case when v_mycamp = 'vice' then 'virtue' else 'vice' end
     order by random() limit 1;
  end if;
  if v_partner is null then
    select p.id into v_partner
      from players p where p.room_id = v_room and p.id <> p_bot and not p.dead
     order by random() limit 1;
  end if;
  if v_partner is null then return; end if;

  v_ally := not v_ink and coalesce((v_known->>v_partner::text) = v_mycamp
            or coalesce((v_sus->>v_partner::text)::numeric, 0) < 0, false);
  v_lie := not v_ally and random() < case when v_mycamp = 'vice'
                                          then least(0.9, v_bluff + 0.35)
                                          else v_bluff end;

  v_t := vv_bot_target(p_bot, false);
  if v_t = v_partner then v_t := null; end if;
  v_tcamp := v_known->>v_t::text;

  if v_t is not null then
    if not v_lie then
      -- What it actually knows (or suspects).
      if v_tcamp in ('vice', 'virtue') then
        v_key := 'claim_' || v_tcamp; v_about := v_t;
      else
        v_key := 'suspect'; v_about := v_t;
      end if;
    elsif v_mycamp = 'vice' and v_tcamp = 'virtue' then
      v_key := 'claim_vice'; v_about := v_t;   -- frame a known Virtue
    elsif v_mycamp = 'vice' then
      v_key := 'self_virtue';
    else
      -- A Virtue's bluff: point at someone it has no case against.
      select p.id into v_about
        from players p
       where p.room_id = v_room and not p.dead and p.id not in (p_bot, v_partner, v_t)
       order by random() limit 1;
      v_key := case when v_about is not null then 'suspect' else 'ask_suspect' end;
    end if;
  else
    r := random();
    if r < 0.35 then
      v_key := 'ask_side';
    elsif r < 0.7 then
      v_key := 'ask_suspect';
    elsif v_mycamp = 'vice' and not v_ally then
      v_key := 'self_virtue';                  -- the usual Vice lie
    else
      v_key := case when v_mycamp = 'vice' then 'self_vice' else 'self_virtue' end;
    end if;
  end if;

  perform vv_send_sentence(p_bot, v_partner, v_key, v_about);
end;
$$;
revoke all on function vv_bot_initiate(uuid) from public, anon, authenticated;

commit;
