-- Migration 128 — Bots weigh their role against the Market
--
-- Playtest note (Matthijs, 2026-10-26): bots burned their Soul Energy on role
-- abilities every night — often at random targets — so they never had any left
-- for potions, and there was no real decision between "use my role" and "save
-- for the Market".
--
-- New rules:
--   * NO INFORMATION, NO ATTACK. Hostile abilities (kill, hospitalise, swap,
--     torment, guesses) need a target the bot has real information on: a KNOWN
--     enemy (its own peeks / reveals / hint inference) or a SUSPECTED one
--     (suspicion >= 1: voted against it or its allies, jailed it). With
--     nothing to go on, the bot saves its Soul Energy. Information roles
--     (Certainty, Empathy) still act while blind — that is how they GET
--     information — but hold back when the bot is saving.
--   * A SAVINGS GOAL (bot_memory.goal). A bot that knows an enemy its role
--     can't deal with (or can't afford to) saves for a kill (300) or
--     hospitalise (200) potion. Role spending never dips into that reserve.
--   * TEAM STRENGTH (bot_memory.eye, from the Revealing Eye potion): a bot that
--     is outnumbered, or down to its last two, buys protection; Justice only
--     protects when its team is in danger.
--   * MARKET PRIORITIES: (1) kill / hospitalise a known enemy the role can't
--     handle, or start saving; (2) protection when threatened, or an Eye to
--     check; (3) a camp reveal when blind; (4) Iron Will against a known
--     enemy (day 2+); (5) the Quiz x2 with cheap spare SE; (6) chip in to free
--     a jailed known ally.
--   * QUIZ: saving or already holding targets → bank points; blind → read a
--     soul more often.
--
-- Redefines vv_bot_role_action, vv_bot_store and vv_bot_quiz from migration
-- 125 (bomb passing and imprisoned-Vengeance revenge are unchanged) and adds
-- a few helpers. Everything stays revoked from clients. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Memory helpers: set / clear one top-level key of a bot's memory.
create or replace function vv_bot_set(p_bot uuid, p_key text, p_value jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update player_secrets
     set bot_memory = case when p_value is null then bot_memory - p_key
                           else jsonb_set(bot_memory, array[p_key], p_value) end
   where player_id = p_bot;
$$;
revoke all on function vv_bot_set(uuid, text, jsonb) from public, anon, authenticated;

-- A target the bot has REAL information on: a known enemy, else the most
-- suspicious non-ally with suspicion >= p_min_sus. Null when it knows nothing.
create or replace function vv_bot_target(
  p_bot uuid,
  p_active_only boolean default true,
  p_prefer_humans boolean default false,
  p_min_sus numeric default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t uuid; v_room uuid; v_camp text; v_sus jsonb; v_known jsonb;
  v_pool uuid[]; v_humans uuid[]; v_max numeric;
begin
  v_t := vv_bot_enemy(p_bot, null, p_active_only, true, p_prefer_humans);
  if v_t is not null then return v_t; end if;

  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_camp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_known := vv_bot_known(p_bot);

  select coalesce(array_agg(p.id), '{}') into v_pool
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and (not p_active_only or (not p.in_prison and not p.in_hospital))
     and (v_known->>p.id::text) is distinct from v_camp
     and coalesce((v_sus->>p.id::text)::numeric, 0) >= p_min_sus;

  if p_prefer_humans then
    select coalesce(array_agg(id), '{}') into v_humans
      from players where id = any(v_pool) and not is_bot;
    if coalesce(array_length(v_humans, 1), 0) > 0 then v_pool := v_humans; end if;
  end if;

  select max(coalesce((v_sus->>x::text)::numeric, 0)) into v_max from unnest(v_pool) x;
  select vv_random_pick(coalesce(array_agg(x), '{}')) into v_t
    from unnest(v_pool) x
   where coalesce((v_sus->>x::text)::numeric, 0) = v_max;
  return v_t;
end;
$$;
revoke all on function vv_bot_target(uuid, boolean, boolean, numeric) from public, anon, authenticated;

-- Is this bot's camp in danger? From its last Revealing Eye (this day or the
-- one before): outnumbered, or down to its last two. False when it has no
-- recent count (it doesn't know).
create or replace function vv_bot_threatened(p_bot uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_camp text; v_eye jsonb; v_day integer; v_mine int; v_theirs int;
begin
  select vv_role_camp(s.role), s.bot_memory->'eye', r.day
    into v_camp, v_eye, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_eye is null or v_camp not in ('vice', 'virtue')
     or coalesce((v_eye->>'day')::int, 0) < v_day - 1 then
    return false;
  end if;
  v_mine   := case when v_camp = 'vice' then (v_eye->>'vices')::int else (v_eye->>'virtues')::int end;
  v_theirs := case when v_camp = 'vice' then (v_eye->>'virtues')::int else (v_eye->>'vices')::int end;
  return v_mine < v_theirs or v_mine <= 2;
end;
$$;
revoke all on function vv_bot_threatened(uuid) from public, anon, authenticated;

-- Soul Energy the bot is holding back for its savings goal (0 if none). A goal
-- whose target is dead or jailed, or that is 3+ days old, is dropped.
create or replace function vv_bot_reserve(p_bot uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_goal jsonb; v_day integer; v_alive boolean;
begin
  select s.bot_memory->'goal', r.day into v_goal, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_goal is null then return 0; end if;

  select not dead and not in_prison into v_alive
    from players where id = (v_goal->>'target')::uuid;
  if not coalesce(v_alive, false) or coalesce((v_goal->>'day')::int, 0) < v_day - 2 then
    perform vv_bot_set(p_bot, 'goal', null);
    return 0;
  end if;
  return case v_goal->>'kind' when 'kill' then 300 when 'hosp' then 200 else 0 end;
end;
$$;
revoke all on function vv_bot_reserve(uuid) from public, anon, authenticated;

-- ===========================================================================
-- Role-action phase
-- ===========================================================================
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
    -- Ink only matters to someone who reads Outreach: an enemy human.
    v_t := vv_bot_target(p_bot, true, true);
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

-- ===========================================================================
-- Quiz
-- ===========================================================================
create or replace function vv_bot_quiz(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_se numeric; v_camp text; v_unknown uuid; v_choice text := 'points';
  v_res jsonb; v_quiz jsonb; r numeric; v_saving boolean; v_has_target boolean;
begin
  select p.soul_energy, vv_role_camp(s.role) into v_se, v_camp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_unknown := vv_bot_unknown(p_bot);
  v_saving := vv_bot_reserve(p_bot) > 0;
  v_has_target := vv_bot_target(p_bot) is not null;

  -- Saving up, already holding a target, short on Soul Energy, or nothing left
  -- to learn → bank the 100.
  if not v_saving and v_unknown is not null and v_se >= 100 then
    r := random();
    if v_has_target then
      v_choice := case when r < 0.2 then 'hint' else 'points' end;
    elsif v_camp = 'virtue' then
      v_choice := case when r < 0.55 then 'peek' when r < 0.8 then 'hint' else 'points' end;
    else
      v_choice := case when r < 0.4 then 'peek' when r < 0.65 then 'hint' else 'points' end;
    end if;
  end if;

  v_res := submit_quiz_choice_impl(p_bot, v_choice,
             case when v_choice = 'peek' then v_unknown end);
  if coalesce((v_res->>'ok')::boolean, false) then
    v_quiz := v_res->'quiz';
    if v_quiz->>'choice' = 'peek' and jsonb_typeof(v_quiz->'peek') = 'object' then
      perform vv_bot_learn(p_bot, (v_quiz->'peek'->>'target')::uuid, v_quiz->'peek'->>'camp');
    elsif v_quiz->>'choice' = 'hint' and jsonb_typeof(v_quiz->'hint') = 'object' then
      perform vv_bot_hint(p_bot, v_quiz->'hint');
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_quiz(uuid) from public, anon, authenticated;

-- ===========================================================================
-- Market
-- ===========================================================================
create or replace function vv_bot_store(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_se numeric; v_camp text; v_role text; v_day integer;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_kill_armed boolean; v_hosp_armed boolean; v_protected boolean; v_iron boolean; v_mult boolean;
  v_t uuid; v_res jsonb; v_known jsonb; v_buys int := 0;
  v_role_kills boolean; v_threat boolean; v_eye_fresh boolean;
begin
  select p.room_id, p.soul_energy, vv_role_camp(s.role), s.role, r.day,
         p.dead, p.in_prison, p.in_hospital,
         s.potion_kill_target is not null, s.potion_hosp_target is not null,
         coalesce(s.potion_protect, false), coalesce(s.potion_iron_will, false),
         coalesce(s.potion_minigame_mult, false),
         coalesce((s.bot_memory->'eye'->>'day')::int, 0) >= r.day
    into v_room, v_se, v_camp, v_role, v_day, v_dead, v_prison, v_hosp,
         v_kill_armed, v_hosp_armed, v_protected, v_iron, v_mult, v_eye_fresh
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_room is null or v_dead or v_prison or v_hosp then return; end if;

  -- Its own role can already kill (and the next role phase will fund it).
  v_role_kills := v_role in ('murder', 'justice');

  -- (1) A KNOWN enemy: deal with it here unless the role will. Can't afford it
  --     yet → set a savings goal (the role phase and the Quiz respect it).
  v_t := vv_bot_enemy(p_bot, null, true, true);
  if v_t is not null and not v_role_kills and not v_kill_armed then
    if v_se >= 300 and random() < 0.75 then
      v_res := buy_potion_impl(p_bot, 'kill', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 300;
        perform vv_bot_set(p_bot, 'goal', null);
      end if;
    elsif not v_hosp_armed and v_se >= 200 and random() < 0.4 then
      v_res := buy_potion_impl(p_bot, 'hospitalise', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 200;
      end if;
    else
      perform vv_bot_set(p_bot, 'goal', jsonb_build_object(
        'kind', 'kill', 'target', v_t::text, 'day', v_day));
    end if;
  elsif v_t is null and not v_kill_armed then
    -- A strongly suspected enemy and plenty to spend: take the shot.
    v_t := vv_bot_target(p_bot, true, false, 2);
    if v_t is not null and not v_role_kills
       and v_se >= 450 and random() < 0.35 then
      v_res := buy_potion_impl(p_bot, 'kill', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 300;
      end if;
    end if;
  end if;

  -- (2) Team in danger → protection. No recent count → maybe check with the Eye.
  v_threat := vv_bot_threatened(p_bot);
  if not v_eye_fresh and v_day >= 2 and v_se >= 300 and random() < 0.3 then
    v_res := buy_potion_impl(p_bot, 'eye', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      perform vv_bot_set(p_bot, 'eye', jsonb_build_object(
        'vices', (v_res->>'vices')::int, 'virtues', (v_res->>'virtues')::int, 'day', v_day));
      v_buys := v_buys + 1; v_se := v_se - 150;
      v_threat := vv_bot_threatened(p_bot);
    end if;
  end if;
  if v_buys < 3 and v_threat and not v_protected and v_se >= 200 and random() < 0.8 then
    v_res := buy_potion_impl(p_bot, 'protect', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (3) Blind → buy information: a camp reveal on someone unknown.
  if v_buys < 3 and vv_bot_target(p_bot) is null and v_se >= 250
     and random() < (case when v_camp = 'virtue' then 0.5 else 0.35 end) then
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null then
      v_res := buy_potion_impl(p_bot, 'camp_reveal', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        perform vv_bot_learn(p_bot, v_t, v_res->>'camp');
        v_buys := v_buys + 1; v_se := v_se - 200;
      end if;
    end if;
  end if;

  -- (4) A known enemy still free to vote out → double this vote (day 2+).
  if v_buys < 3 and v_day >= 2 and not v_iron
     and vv_bot_reserve(p_bot) = 0 and v_se >= 250 and random() < 0.4
     and vv_bot_enemy(p_bot, null, false, true) is not null then
    v_res := buy_potion_impl(p_bot, 'iron_will', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- (5) Cheap spare Soul Energy, nothing to save for → double the next Quiz.
  if v_buys < 3 and not v_mult and vv_bot_reserve(p_bot) = 0
     and v_se between 60 and 260 and random() < 0.25 then
    v_res := buy_potion_impl(p_bot, 'minigame_mult', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 60;
    end if;
  end if;

  -- (6) Chip in to free a jailed KNOWN ally.
  if vv_bot_reserve(p_bot) = 0 and v_se >= 250 and random() < 0.5 then
    v_known := vv_bot_known(p_bot);
    select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_t
      from players p
     where p.room_id = v_room and p.in_prison and not p.dead and p.id <> p_bot
       and (v_known->>p.id::text) = v_camp;
    if v_t is not null then
      perform contribute_release_impl(p_bot, v_t);
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_store(uuid) from public, anon, authenticated;

commit;
