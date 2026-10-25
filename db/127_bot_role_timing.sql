-- Migration 127 — Bots decide their role like people do
--
-- Playtest note (Matthijs, 2026-10-25): bots locked their role the instant a
-- queue game formed. In role select every camp-mate sees the team panel
-- (anonymous, by class) — so the seats that locked at 0s were obviously bots,
-- and the ones still deciding were obviously people, which narrowed down who
-- holds which role.
--
-- Now each bot is dealt a PLAN instead of a locked role: a random default role
-- of its class, a time to show it as a tentative pick (2-12s in) and a time to
-- lock it (2-12s after that, so by ~24s of the 30s window). vv_tick_room plays
-- the plan out every tick (vv_bot_role_select_step). Role select still ends as
-- soon as every HUMAN has locked — a bot still "deciding" is simply handed its
-- planned role then — so no person ever waits on a bot.
--
-- Redefines form_match and vv_tick_room from migration 126 with only those
-- changes. Depends on 125 (player_secrets.bot_memory) and 126. Safe to re-run.

begin;

create or replace function form_match(p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c_seats constant int := 4;                 -- per camp; 4v4
  c_patience constant interval := interval '60 seconds';
  c_vice_classes constant text[] :=
    array['exterminator','troublemaker','obstructor','manipulator'];
  c_virtue_classes constant text[] :=
    array['protector','communicator','seeker','catalyst'];
  c_bot_roles constant text[] := array['murder','intoxication','envy','torment',
    'vengeance','vice_worshipper','empathy','justice','certainty','truthfulness',
    'sacrifice','virtue_seeker','generosity'];
  c_bot_names constant text[] := array['Aldric','Brienne','Cedric','Darra',
    'Edmund','Fiora','Godric','Hilde','Isolde','Jorah','Kestrel','Leofric',
    'Maren','Niall','Osric','Perrin','Quenna','Rowan','Seren','Tamsin',
    'Ulric','Vesna','Wystan','Yselde'];
  v_taken uuid[] := '{}';
  v_pick uuid;
  v_assign jsonb := '[]'::jsonb;   -- [{user, camp, class}]  (user null = a bot seat)
  v_camp text; v_class text; v_i int;
  v_code text; v_room_id uuid; v_player_id uuid; v_name text;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bot_mode boolean := false;
  v_is_bot boolean;
  v_role text;
  v_pick_s double precision;
  v_lock_s double precision;
  r record;
begin
  if (select count(*) from ranked_queue
      where mode = p_kind and status = 'waiting') < 2 * c_seats then
    if p_kind = 'public' and exists (
         select 1 from ranked_queue
         where mode = 'public' and status = 'waiting'
           and joined_at <= now() - c_patience) then
      v_bot_mode := true;
    else
      return null;
    end if;
  end if;

  -- Pass 1: give people the class they asked for.
  for v_i in 1..(2 * c_seats) loop
    if v_i <= c_seats then
      v_camp := 'vice';  v_class := c_vice_classes[v_i];
    else
      v_camp := 'virtue'; v_class := c_virtue_classes[v_i - c_seats];
    end if;

    select user_id into v_pick
    from ranked_queue
    where mode = p_kind and status = 'waiting'
      and not (user_id = any(v_taken))
      and (case when v_camp = 'vice' then pref_vice else pref_virtue end) = v_class
    order by joined_at
    limit 1;

    if v_pick is not null then
      v_taken := array_append(v_taken, v_pick);
      v_assign := v_assign || jsonb_build_object(
        'user', v_pick, 'camp', v_camp, 'class', v_class);
    end if;
  end loop;

  -- Pass 2: fill the remaining seats (bot mode: every waiting human, then bots).
  for v_i in 1..(2 * c_seats) loop
    if v_i <= c_seats then
      v_camp := 'vice';  v_class := c_vice_classes[v_i];
    else
      v_camp := 'virtue'; v_class := c_virtue_classes[v_i - c_seats];
    end if;
    if exists (select 1 from jsonb_array_elements(v_assign) as t(elem)
               where t.elem ->> 'camp' = v_camp
                 and t.elem ->> 'class' = v_class) then
      continue;
    end if;

    select user_id into v_pick
    from ranked_queue
    where mode = p_kind and status = 'waiting'
      and not (user_id = any(v_taken))
      and (v_bot_mode or joined_at <= now() - c_patience)
    order by joined_at
    limit 1;

    if v_pick is null then
      if v_bot_mode then
        v_assign := v_assign || jsonb_build_object(
          'user', null, 'camp', v_camp, 'class', v_class);
        continue;
      end if;
      return null;
    end if;
    v_taken := array_append(v_taken, v_pick);
    v_assign := v_assign || jsonb_build_object(
      'user', v_pick, 'camp', v_camp, 'class', v_class);
  end loop;

  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, phase_ends_at,
                         role_assign_mode, eye_uses_left, free_uses_left, server_hosted)
      values (v_code, false, p_kind = 'ranked', 'in_game', 'role_select',
              now() + interval '30 seconds', 'choose', 1, 1, true)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  for r in
    select elem from jsonb_array_elements(v_assign) as t(elem)
    order by (t.elem ->> 'user') is null
  loop
    v_is_bot := (r.elem ->> 'user') is null;

    if v_is_bot then
      select n into v_name from unnest(c_bot_names) n
      where n || ' (bot)' not in (select name from players where room_id = v_room_id)
      order by random() limit 1;
      v_name := coalesce(v_name, 'Shade') || ' (bot)';

      insert into players (room_id, user_id, auth_uid, name, is_host, is_bot)
      values (v_room_id, null, null, v_name, false, true)
      returning id into v_player_id;

      select x into v_role from unnest(c_bot_roles) x
      where vv_role_camp(x) = r.elem ->> 'camp'
        and vv_role_class(x) = r.elem ->> 'class'
      order by random() limit 1;
      v_role := coalesce(v_role, case when r.elem ->> 'camp' = 'virtue'
                                      then 'virtue_seeker' else 'vice_worshipper' end);

      -- NOT locked yet (migration 127): seats that locked the instant the game
      -- formed gave the bots away in the anonymous team panel. Each bot shows a
      -- tentative pick after 2-12s and locks 2-12s after that, like a person
      -- deciding; vv_tick_room plays the plan out (vv_bot_role_select_step).
      v_pick_s := 2 + random() * 10;
      v_lock_s := v_pick_s + 2 + random() * 10;
      insert into player_secrets (player_id, role, role_choice, assigned_camp,
                                  assigned_class, bot_memory)
      values (v_player_id, null, null, r.elem ->> 'camp', r.elem ->> 'class',
              jsonb_build_object(
                'plan', v_role,
                'pick_at', now() + make_interval(secs => v_pick_s),
                'lock_at', now() + make_interval(secs => v_lock_s)));
    else
      select name into v_name from ranked_queue
      where user_id = (r.elem ->> 'user')::uuid;

      -- user_id = ACCOUNT identity (only with a profile); auth_uid = SESSION
      -- identity (what vv_is_me matches) — see migration 106. No host: the
      -- server runs this room.
      insert into players (room_id, user_id, auth_uid, name, is_host)
      values (v_room_id,
              case when exists (select 1 from profiles pr
                                where pr.id = (r.elem ->> 'user')::uuid)
                   then (r.elem ->> 'user')::uuid end,
              (r.elem ->> 'user')::uuid,
              coalesce(v_name, 'Player'), false)
      returning id into v_player_id;

      insert into player_secrets (player_id, role, assigned_camp, assigned_class)
      values (v_player_id, null, r.elem ->> 'camp', r.elem ->> 'class');
    end if;

    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_taken);

  return v_code;
end;
$$;
grant execute on function form_match(text) to authenticated;

-- A bot's role select, played out over time: its tentative pick appears at
-- pick_at (camp-mates see it anonymously, exactly like a person's), and it locks
-- in at lock_at. Called by vv_tick_room every tick during role_select.
create or replace function vv_bot_role_select_step(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update player_secrets s set role_choice = s.bot_memory->>'plan'
    from players p
   where p.id = s.player_id and p.room_id = p_room_id and p.is_bot
     and s.role is null and s.role_choice is null
     and s.bot_memory ? 'pick_at'
     and now() >= (s.bot_memory->>'pick_at')::timestamptz;

  update player_secrets s
     set role = s.bot_memory->>'plan', role_choice = s.bot_memory->>'plan'
    from players p
   where p.id = s.player_id and p.room_id = p_room_id and p.is_bot
     and s.role is null
     and s.bot_memory ? 'lock_at'
     and now() >= (s.bot_memory->>'lock_at')::timestamptz;
end;
$$;
revoke all on function vv_bot_role_select_step(uuid) from public, anon, authenticated;

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
      update players set ready = false where room_id = p_room_id;
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

commit;
