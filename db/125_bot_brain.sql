-- Migration 125 — Bots, batch B: camp-aware play with memory
--
-- Batch A (124) gave bots safe moves only. This makes them play: every ability
-- of every role a bot can hold, the Quiz, the Market and the vote — steered by a
-- per-bot MEMORY of what that bot could legitimately know:
--
--   known  {player_id: camp}   certain camps: its own Quiz peeks, Certainty
--                              reveals, camp-reveal potions
--   hints  [{kind,camp,a,b}]   its own Quiz hints — combined with `known` to
--                              INFER more camps ("opposite sides" + one known
--                              camp = the other; "at least one is X" + one
--                              known non-X = the other is X)
--   sus    {player_id: score}  suspicion: players who voted against it or a
--                              known ally (Empathy's reveal), its jailers
--                              (imprisoned Vengeance)
--
-- A bot NEVER reads anything a human in its seat couldn't: the decision code
-- runs server-side (it has to — roles are secret), but it only consults the
-- bot's own memory, its own role/Soul Energy and public state.
--
-- Targeting: enemy actions (kill, hospitalise, swap, torment, guesses, votes,
-- kill potion, bomb passes) go to a known enemy, else the most suspicious
-- player, else a random unknown — and never to a known ally. Protective actions
-- go to a known ally or the bot itself. Bots only ever hold the 13 default roles
-- (dealt in form_match) or the Worshipper/Seeker a human conversion can turn
-- them into, so those are the roles covered.
--
-- Also fixes a hole found while building this: reveal_self (Vice Worshipper /
-- Virtue Seeker, migration 056) had NO caller gate and no phase check — any
-- client could call it for any player id, which spent that player's Soul
-- Energy, forced a reveal, and (from which ids returned true) exposed who the
-- Worshipper and Seeker were. It is now split into a gated wrapper + _impl.
--
-- Every helper here is revoked from clients: a bot's memory is camp
-- information, so it must never be readable through the API.
--
-- Depends on 124 (run_bots, submit_quiz_choice_impl, players.is_bot).
-- Safe to re-run.

begin;

alter table player_secrets add column if not exists bot_memory jsonb not null default '{}'::jsonb;

-- ===========================================================================
-- reveal_self: gated wrapper + impl (body from 056, plus phase/active checks)
-- ===========================================================================
create or replace function reveal_self_impl(p_player_id uuid, p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_role text;
  v_name text;
  v_role_name text;
  v_phase text;
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role, p.name, r.phase,
         p.dead, p.in_prison, p.in_hospital
    into v_room_id, v_se, v_acted, v_role, v_name, v_phase, v_dead, v_prison, v_hosp
  from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_room_id is null or v_role not in ('vice_worshipper','virtue_seeker')
     or v_acted or v_se < 100 or v_phase is distinct from 'role_action'
     or v_dead or v_prison or v_hosp or p_target_id = p_player_id then
    return false;
  end if;

  if not exists (select 1 from players where id = p_target_id and room_id = v_room_id) then
    return false;
  end if;

  v_role_name := case v_role when 'vice_worshipper' then 'Vice Worshipper'
                             else 'Virtue Seeker' end;

  update players
  set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  insert into player_notices (room_id, recipient_id, text)
  values (v_room_id, p_target_id, v_name || ' revealed themselves to you: ' || v_role_name);

  return true;
end;
$$;
revoke all on function reveal_self_impl(uuid, uuid) from public, anon, authenticated;

create or replace function reveal_self(p_player_id uuid, p_target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return reveal_self_impl(p_player_id, p_target_id);
end;
$$;
grant execute on function reveal_self(uuid, uuid) to anon, authenticated;

-- ===========================================================================
-- Memory
-- ===========================================================================

-- Record a camp the bot now knows for certain.
create or replace function vv_bot_learn(p_bot uuid, p_target uuid, p_camp text)
returns void
language sql
security definer
set search_path = public
as $$
  update player_secrets
     set bot_memory = jsonb_set(
           bot_memory, '{known}',
           coalesce(bot_memory->'known', '{}'::jsonb)
             || jsonb_build_object(p_target::text,
                  case when p_camp in ('vice','virtue') then p_camp else 'neutral' end))
   where player_id = p_bot and p_target is not null and p_camp is not null;
$$;
revoke all on function vv_bot_learn(uuid, uuid, text) from public, anon, authenticated;

-- Remember a Quiz hint ({kind, camp?, a, b}).
create or replace function vv_bot_hint(p_bot uuid, p_hint jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update player_secrets
     set bot_memory = jsonb_set(
           bot_memory, '{hints}',
           coalesce(bot_memory->'hints', '[]'::jsonb) || jsonb_build_array(p_hint))
   where player_id = p_bot and p_hint is not null and jsonb_typeof(p_hint) = 'object';
$$;
revoke all on function vv_bot_hint(uuid, jsonb) from public, anon, authenticated;

-- Raise (or lower) suspicion of a player.
create or replace function vv_bot_suspect(p_bot uuid, p_target uuid, p_delta numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update player_secrets
     set bot_memory = jsonb_set(
           bot_memory, '{sus}',
           coalesce(bot_memory->'sus', '{}'::jsonb)
             || jsonb_build_object(p_target::text,
                  coalesce((bot_memory->'sus'->>p_target::text)::numeric, 0) + p_delta))
   where player_id = p_bot and p_target is not null and p_target <> p_bot;
$$;
revoke all on function vv_bot_suspect(uuid, uuid, numeric) from public, anon, authenticated;

-- Everything the bot knows for certain, INCLUDING what its hints imply.
create or replace function vv_bot_known(p_bot uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mem jsonb;
  v_known jsonb;
  h jsonb;
  ca text; cb text;
  v_changed boolean;
  v_i int;
begin
  select bot_memory into v_mem from player_secrets where player_id = p_bot;
  v_known := coalesce(v_mem->'known', '{}'::jsonb);

  -- A few passes so one inference can unlock the next.
  for v_i in 1..3 loop
    v_changed := false;
    for h in select * from jsonb_array_elements(coalesce(v_mem->'hints', '[]'::jsonb)) loop
      ca := v_known->>(h->>'a');
      cb := v_known->>(h->>'b');
      if h->>'kind' = 'opposite' then
        if ca in ('vice','virtue') and cb is null then
          v_known := v_known || jsonb_build_object(h->>'b',
                       case when ca = 'vice' then 'virtue' else 'vice' end);
          v_changed := true;
        elsif cb in ('vice','virtue') and ca is null then
          v_known := v_known || jsonb_build_object(h->>'a',
                       case when cb = 'vice' then 'virtue' else 'vice' end);
          v_changed := true;
        end if;
      elsif h->>'kind' = 'at_least' then
        if ca is not null and ca <> (h->>'camp') and cb is null then
          v_known := v_known || jsonb_build_object(h->>'b', h->>'camp');
          v_changed := true;
        elsif cb is not null and cb <> (h->>'camp') and ca is null then
          v_known := v_known || jsonb_build_object(h->>'a', h->>'camp');
          v_changed := true;
        end if;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  return v_known;
end;
$$;
revoke all on function vv_bot_known(uuid) from public, anon, authenticated;

-- ===========================================================================
-- Targeting
-- ===========================================================================

-- An enemy-directed target. Order: a known enemy → the most suspicious unknown
-- → any unknown. Never the bot itself, never a known ally.
--   p_candidates   restrict to these ids (a re-vote's tied players); null = any
--   p_active_only  exclude jailed / hospitalised players
--   p_known_only   only a KNOWN enemy (null if there is none)
--   p_prefer_humans  pick among humans when any qualify (Torment)
create or replace function vv_bot_enemy(
  p_bot uuid,
  p_candidates uuid[] default null,
  p_active_only boolean default true,
  p_known_only boolean default false,
  p_prefer_humans boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_camp text; v_sus jsonb; v_known jsonb;
  v_pool uuid[]; v_humans uuid[]; v_pick uuid; v_max numeric;
begin
  select p.room_id, vv_role_camp(s.role), coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_room, v_camp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  if v_room is null then return null; end if;
  v_known := vv_bot_known(p_bot);

  select coalesce(array_agg(p.id), '{}') into v_pool
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and (not p_active_only or (not p.in_prison and not p.in_hospital))
     and (p_candidates is null or p.id = any(p_candidates))
     and (v_known->>p.id::text) is distinct from v_camp;          -- never an ally

  if p_prefer_humans then
    select coalesce(array_agg(id), '{}') into v_humans
      from players where id = any(v_pool) and not is_bot;
    if coalesce(array_length(v_humans, 1), 0) > 0 then v_pool := v_humans; end if;
  end if;

  -- 1) a known enemy (allies are already out of the pool)
  select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
    from unnest(v_pool) x where v_known ? x::text;
  if v_pick is not null or p_known_only then return v_pick; end if;

  -- 2) the most suspicious of the rest
  select max(coalesce((v_sus->>x::text)::numeric, 0)) into v_max from unnest(v_pool) x;
  if coalesce(v_max, 0) > 0 then
    select vv_random_pick(coalesce(array_agg(x), '{}')) into v_pick
      from unnest(v_pool) x
     where coalesce((v_sus->>x::text)::numeric, 0) = v_max;
    if v_pick is not null then return v_pick; end if;
  end if;

  -- 3) anyone left
  return vv_random_pick(v_pool);
end;
$$;
revoke all on function vv_bot_enemy(uuid, uuid[], boolean, boolean, boolean) from public, anon, authenticated;

-- A known, active ally (null if the bot knows none).
create or replace function vv_bot_ally(p_bot uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_camp text; v_known jsonb; v_pick uuid;
begin
  select p.room_id, vv_role_camp(s.role) into v_room, v_camp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_known := vv_bot_known(p_bot);
  select vv_random_pick(coalesce(array_agg(p.id), '{}')) into v_pick
    from players p
   where p.room_id = v_room and p.id <> p_bot and not p.dead
     and not p.in_prison and not p.in_hospital
     and (v_known->>p.id::text) = v_camp;
  return v_pick;
end;
$$;
revoke all on function vv_bot_ally(uuid) from public, anon, authenticated;

-- A living player whose camp the bot doesn't know yet (for info abilities).
create or replace function vv_bot_unknown(p_bot uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_known jsonb;
begin
  select room_id into v_room from players where id = p_bot;
  v_known := vv_bot_known(p_bot);
  return (
    select vv_random_pick(coalesce(array_agg(p.id), '{}'))
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not (v_known ? p.id::text)
  );
end;
$$;
revoke all on function vv_bot_unknown(uuid) from public, anon, authenticated;

-- Queue a role action for a bot — the same checks the player-facing
-- queue_action wrapper makes, so a bot can never do what a player couldn't.
create or replace function vv_bot_queue(p_bot uuid, p_cost numeric, p_action text, p_target text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_se numeric; v_dead boolean; v_prison boolean; v_hosp boolean;
        v_phase text; v_acted boolean;
begin
  select s.role, p.soul_energy, p.dead, p.in_prison, p.in_hospital, r.phase, p.acted_this_day
    into v_role, v_se, v_dead, v_prison, v_hosp, v_phase, v_acted
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_role is null or v_phase is distinct from 'role_action' or v_acted
     or v_dead or v_prison or v_hosp or v_se < p_cost or p_target is null then
    return false;
  end if;
  if not (
       (p_action = 'kill'      and v_role in ('murder', 'justice'))
    or (p_action = 'protect'   and v_role = 'justice')
    or (p_action = 'intox'     and v_role in ('intoxication', 'vengeance'))
    or (p_action = 'envy_swap' and v_role = 'envy')
    or (p_action = 'torment'   and v_role = 'torment')
    or (p_action = 'sacrifice' and v_role = 'sacrifice')
    or (p_action like '%guess' and v_role in ('vice_worshipper', 'virtue_seeker'))
  ) then
    return false;
  end if;
  perform queue_action_impl(p_bot, p_cost, p_action, p_target);
  return true;
end;
$$;
revoke all on function vv_bot_queue(uuid, numeric, text, text) from public, anon, authenticated;

-- ===========================================================================
-- Phase actors
-- ===========================================================================

-- Role-action phase: pass any bomb it must pass, then use its role's ability.
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
begin
  select p.room_id, s.role, vv_role_camp(s.role), p.soul_energy, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, r.day
    into v_room, v_role, v_camp, v_se, v_acted, v_dead, v_prison, v_hosp, v_day
    from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
   where p.id = p_bot;
  if v_room is null or v_dead then return; end if;

  -- A bomb (a human Fanaticism's) that has sat a full day must be passed on:
  -- hand it to an enemy. (Unpassed bombs relocate randomly anyway.)
  if exists (
       select 1 from rooms r, jsonb_array_elements(coalesce(r.bombs, '[]'::jsonb)) b
       where r.id = v_room and (b->>'holder')::uuid = p_bot
         and coalesce((b->>'since')::int, v_day) < v_day) then
    v_t := vv_bot_enemy(p_bot);
    if v_t is not null then perform pass_bomb_impl(p_bot, v_t); end if;
  end if;

  -- Imprisoned: only Vengeance acts — revenge on one of her jailers.
  if v_prison then
    if v_role = 'vengeance' and not v_acted and v_se >= 150 then
      select coalesce(array_agg(pl.id), '{}') into v_jailers
        from rooms rm join players pl on pl.room_id = rm.id and not pl.dead
       where rm.id = v_room and rm.vengeance_imprisoners ? pl.id::text;
      -- She knows who jailed her: that's reason enough to suspect them.
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

  if v_role = 'murder' then
    if random() < 0.85 then
      perform vv_bot_queue(p_bot, 150, 'kill', vv_bot_enemy(p_bot)::text);
    end if;

  elsif v_role = 'intoxication' then
    if random() < 0.7 then
      perform vv_bot_queue(p_bot, 100, 'intox', vv_bot_enemy(p_bot)::text);
    end if;

  elsif v_role = 'envy' then
    if random() < 0.5 then
      perform vv_bot_queue(p_bot, 100, 'envy_swap', vv_bot_enemy(p_bot)::text);
    end if;

  elsif v_role = 'torment' then
    -- Ink only matters to someone who reads Outreach: aim for a human.
    if random() < 0.6 then
      perform vv_bot_queue(p_bot, 100, 'torment',
                           vv_bot_enemy(p_bot, null, true, false, true)::text);
    end if;

  elsif v_role = 'vengeance' then
    if random() < 0.5 then
      perform vv_bot_queue(p_bot, 150, 'intox', vv_bot_enemy(p_bot)::text);
    end if;

  elsif v_role = 'justice' then
    -- Kill a KNOWN Vice when it can; otherwise shield an ally or itself.
    v_t := vv_bot_enemy(p_bot, null, true, true);
    if v_t is not null and v_se >= 200 and random() < 0.7 then
      perform vv_bot_queue(p_bot, 200, 'kill', v_t::text);
    elsif random() < 0.75 then
      v_ally := vv_bot_ally(p_bot);
      perform vv_bot_queue(p_bot, 100, 'protect',
        (case when v_ally is not null and random() < 0.4 then v_ally else p_bot end)::text);
    end if;

  elsif v_role = 'certainty' then
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null and random() < 0.8 then
      v_role_seen := reveal_role_impl(p_bot, v_t);
      if v_role_seen is not null then
        perform vv_bot_learn(p_bot, v_t, vv_role_camp(v_role_seen));
      end if;
    end if;

  elsif v_role = 'empathy' then
    -- Who voted against me / my known allies last time is suspicious.
    if v_day >= 2 and v_se >= 150 and random() < 0.6 then
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
    -- Reveal yourself to a known ally, or guess your counterpart.
    v_ally := vv_bot_ally(p_bot);
    if v_ally is not null and v_se >= 100 and random() < 0.5 then
      perform reveal_self_impl(p_bot, v_ally);
    elsif v_day >= 2 and random() < 0.35 then
      perform vv_bot_queue(p_bot, 100,
        case when v_role = 'vice_worshipper' then 'worshipper_guess' else 'seeker_guess' end,
        vv_bot_enemy(p_bot, null, false)::text);
    end if;

  elsif v_role = 'sacrifice' then
    -- Only worth dying for two KNOWN, active enemies.
    v_known := vv_bot_known(p_bot);
    select coalesce(array_agg(p.id order by random()), '{}') into v_enemies
      from players p
     where p.room_id = v_room and p.id <> p_bot and not p.dead
       and not p.in_prison and not p.in_hospital
       and v_known ? p.id::text
       and (v_known->>p.id::text) <> v_camp;
    if coalesce(array_length(v_enemies, 1), 0) >= 2 and v_se >= 400 and random() < 0.7 then
      perform vv_bot_queue(p_bot, 400, 'sacrifice',
        (select jsonb_agg(x::text) from unnest(v_enemies[1:2]) x)::text);
    end if;

  elsif v_role = 'generosity' then
    v_ally := vv_bot_ally(p_bot);
    if v_se >= 300 and random() < 0.5 then
      perform grant_extra_life_impl(p_bot, coalesce(v_ally, p_bot));
    elsif v_ally is not null and v_se >= 200 and random() < 0.5 then
      perform gift_soul_energy_impl(p_bot, v_ally);
    end if;
  end if;
  -- truthfulness: its ability is on the consultation result screen; bots skip it.
end;
$$;
revoke all on function vv_bot_role_action(uuid) from public, anon, authenticated;

-- Quiz: points vs information. Low on Soul Energy (or nothing left to learn) →
-- bank the 100. Otherwise Virtue bots lean to information, Vice bots to points
-- (the designed asymmetry: Virtues must find the Vices).
create or replace function vv_bot_quiz(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_se numeric; v_camp text; v_unknown uuid; v_choice text := 'points';
  v_res jsonb; v_quiz jsonb; r numeric;
begin
  select p.soul_energy, vv_role_camp(s.role) into v_se, v_camp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  v_unknown := vv_bot_unknown(p_bot);

  if v_se >= 150 and v_unknown is not null then
    r := random();
    if v_camp = 'virtue' then
      v_choice := case when r < 0.45 then 'peek' when r < 0.7 then 'hint' else 'points' end;
    else
      v_choice := case when r < 0.15 then 'peek' when r < 0.4 then 'hint' else 'points' end;
    end if;
  end if;

  v_res := submit_quiz_choice_impl(p_bot, v_choice,
             case when v_choice = 'peek' then v_unknown end);
  if coalesce((v_res->>'ok')::boolean, false) then
    v_quiz := v_res->'quiz';
    if v_quiz->>'choice' = 'peek' and v_quiz->'peek' is not null
       and jsonb_typeof(v_quiz->'peek') = 'object' then
      perform vv_bot_learn(p_bot, (v_quiz->'peek'->>'target')::uuid, v_quiz->'peek'->>'camp');
    elsif v_quiz->>'choice' = 'hint' and jsonb_typeof(v_quiz->'hint') = 'object' then
      perform vv_bot_hint(p_bot, v_quiz->'hint');
    end if;
  end if;
end;
$$;
revoke all on function vv_bot_quiz(uuid) from public, anon, authenticated;

-- Market: a couple of sensible buys, otherwise save.
create or replace function vv_bot_store(p_bot uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_se numeric; v_camp text; v_dead boolean; v_prison boolean; v_hosp boolean;
  v_t uuid; v_res jsonb; v_known jsonb; v_buys int := 0;
begin
  select p.room_id, p.soul_energy, vv_role_camp(s.role), p.dead, p.in_prison, p.in_hospital
    into v_room, v_se, v_camp, v_dead, v_prison, v_hosp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  if v_room is null or v_dead or v_prison or v_hosp then return; end if;

  -- Vice with a known target and money to burn: a kill potion.
  if v_camp = 'vice' and v_se >= 450 and random() < 0.4 then
    v_t := vv_bot_enemy(p_bot, null, true, true);
    if v_t is not null then
      v_res := buy_potion_impl(p_bot, 'kill', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        v_buys := v_buys + 1; v_se := v_se - 300;
      end if;
    end if;
  end if;

  -- Virtue hunting for Vices: a camp reveal on someone unknown.
  if v_buys < 2 and v_camp = 'virtue' and v_se >= 300 and random() < 0.4 then
    v_t := vv_bot_unknown(p_bot);
    if v_t is not null then
      v_res := buy_potion_impl(p_bot, 'camp_reveal', v_t);
      if coalesce((v_res->>'ok')::boolean, false) then
        perform vv_bot_learn(p_bot, v_t, v_res->>'camp');
        v_buys := v_buys + 1; v_se := v_se - 200;
      end if;
    end if;
  end if;

  -- Rich enough to feel exposed: protection.
  if v_buys < 2 and v_se >= 350 and random() < 0.3 then
    v_res := buy_potion_impl(p_bot, 'protect', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 200;
    end if;
  end if;

  -- Cheap upside on the next Quiz.
  if v_buys < 2 and v_se >= 200 and random() < 0.2 then
    v_res := buy_potion_impl(p_bot, 'minigame_mult', null);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_buys := v_buys + 1; v_se := v_se - 60;
    end if;
  end if;

  -- Chip in to free a jailed KNOWN ally.
  if v_se >= 300 and random() < 0.5 then
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

-- Consultation: vote a known or suspected enemy; with nothing to go on, vote at
-- random a little over half the time and skip otherwise. In a re-vote only the
-- tied players (p_candidates) are eligible.
create or replace function vv_bot_vote(p_bot uuid, p_candidates uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_t uuid; v_sus jsonb;
begin
  select p.dead, p.in_prison, p.in_hospital, coalesce(s.bot_memory->'sus', '{}'::jsonb)
    into v_dead, v_prison, v_hosp, v_sus
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_bot;
  if v_dead or v_prison or v_hosp then return; end if;

  -- Imprisoned / hospitalised players can still be voted on (p_active_only = false).
  v_t := vv_bot_enemy(p_bot, p_candidates, false, true);      -- a known enemy
  if v_t is null then
    v_t := vv_bot_enemy(p_bot, p_candidates, false, false);   -- suspicion, else anyone
    if v_t is not null
       and coalesce((v_sus->>v_t::text)::numeric, 0) <= 0
       and random() < 0.45 then
      v_t := null;                                             -- no real read: skip
    end if;
  end if;

  perform submit_vote_impl(p_bot, coalesce(v_t::text, 'skip'));
end;
$$;
revoke all on function vv_bot_vote(uuid, uuid[]) from public, anon, authenticated;

-- ===========================================================================
-- The runner (replaces 124's safe-moves version; same signature + gate)
-- ===========================================================================
create or replace function run_bots(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text; v_day integer; v_revote jsonb; v_done text; v_key text;
  v_cands uuid[];
  r record;
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;

  select phase, day, revote_candidates, bots_acted_key
    into v_phase, v_day, v_revote, v_done
    from rooms where id = p_room_id
    for update;
  if v_phase is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_key := v_phase || ':' || v_day || ':' || coalesce(md5(v_revote::text), '-');
  if v_done is not distinct from v_key then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if not exists (select 1 from players where room_id = p_room_id and is_bot) then
    return jsonb_build_object('ok', true, 'bots', 0);
  end if;

  if v_revote is not null and jsonb_typeof(v_revote) = 'array' then
    select coalesce(array_agg(x::uuid), '{}') into v_cands
      from jsonb_array_elements_text(v_revote) x;
  end if;

  -- Every living bot (an imprisoned Vengeance still acts). Each bot is isolated:
  -- one bot's failure is logged and skipped, never allowed to break the phase.
  for r in
    select p.id from players p
    where p.room_id = p_room_id and p.is_bot and not p.dead
    order by random()
  loop
    begin
      if v_phase = 'role_action' then
        perform vv_bot_role_action(r.id);
      elsif v_phase = 'minigame' then
        perform vv_bot_quiz(r.id);
      elsif v_phase = 'store' then
        perform vv_bot_store(r.id);
      elsif v_phase = 'consultation' then
        perform vv_bot_vote(r.id, v_cands);
      end if;
    exception when others then
      raise warning 'run_bots: bot % failed in %: %', r.id, v_phase, sqlerrm;
    end;
  end loop;

  -- Bots are always "ready" — they never hold up a gate. (The clients count
  -- humans only, so this matters just when no human is left active.)
  update players set ready = true
   where room_id = p_room_id and is_bot and not dead;

  update rooms set bots_acted_key = v_key where id = p_room_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function run_bots(uuid) to anon, authenticated;

commit;
