-- ============================================
-- Migration 068 — new-role abilities, batch 3: Fanaticism / bombs
-- ============================================
-- Fanaticism (Vice, B) plants up to 2 bombs (100 SE each, one reflection
-- action/day) on other players. A bomb is held secretly; from the day AFTER it
-- lands, its holder must pass it to another active player each reflection
-- (auto-random if they don't act). Fanaticism can pay 100 to see who carries
-- them, and 150 during consultation to detonate one — instantly killing its
-- current holder (no protection: a consultation-phase kill, like instant
-- Sacrifice). The detonate UI is blind (no holder name) so the 100-SE check has
-- real value and a bomb that drifted onto a teammate kills them.
--
-- New state:
--   rooms.bombs jsonb           — live bombs [{id,holder,since,pass_to}] (SECRET)
--   rooms.bombs_planted integer — lifetime plant count (cap 2)
-- ============================================

alter table rooms add column if not exists bombs jsonb not null default '[]'::jsonb;       -- SECRET: never in PUBLIC_ROOM_COLS
alter table rooms add column if not exists bombs_planted integer not null default 0;

-- ---------------------------------------------------------------------------
-- Plant a bomb on an active player (100 SE, role_action, one/day, cap 2/game).
-- ---------------------------------------------------------------------------
create or replace function plant_bomb(p_fanatic uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_day int; v_planted int;
  v_bombs jsonb; v_tgt_active boolean; v_holds boolean; v_id int;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, r.day, r.bombs_planted, r.bombs
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp,
         v_day, v_planted, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'fanaticism' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100
     or coalesce(v_planted, 0) >= 2 or p_target = p_fanatic then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;
  -- One bomb per holder: don't stack a second bomb on a current carrier.
  select exists(
    select 1 from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
    where (b->>'holder')::uuid = p_target
  ) into v_holds;
  if v_holds then return jsonb_build_object('ok', false, 'reason', 'already_holding'); end if;

  v_id := coalesce(v_planted, 0) + 1;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_fanatic;
  update rooms set bombs_planted = v_id,
    bombs = coalesce(bombs, '[]'::jsonb)
            || jsonb_build_object('id', v_id, 'holder', p_target::text,
                                  'since', v_day, 'pass_to', null)
  where id = v_room;
  return jsonb_build_object('ok', true, 'bomb_id', v_id);
end; $$;
grant execute on function plant_bomb(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- See who currently carries your bombs (100 SE, role_action, one/day).
-- ---------------------------------------------------------------------------
create or replace function bomb_carriers(p_fanatic uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_bombs jsonb; v_list jsonb;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital, r.bombs
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'fanaticism' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_fanatic;
  select coalesce(jsonb_agg(
           jsonb_build_object('id', (b->>'id')::int, 'name', pl.name)
           order by (b->>'id')::int), '[]'::jsonb)
    into v_list
  from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
  join players pl on pl.id = (b->>'holder')::uuid;
  return jsonb_build_object('ok', true, 'carriers', v_list);
end; $$;
grant execute on function bomb_carriers(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A bomb-holder chooses who to pass to this reflection (free; resolves at
-- resolve_role_action). Only valid for a bomb they must pass (held since a
-- previous day) and an active, non-self target.
-- ---------------------------------------------------------------------------
create or replace function pass_bomb(p_holder uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_day int; v_bombs jsonb; v_new jsonb := '[]'::jsonb;
  v_tgt_active boolean; b jsonb; v_found boolean := false;
begin
  select p.room_id, r.phase, r.day, r.bombs
    into v_room, v_phase, v_day, v_bombs
  from players p join rooms r on r.id = p.room_id where p.id = p_holder;
  if v_room is null or v_phase is distinct from 'role_action' or p_target = p_holder then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;
  for b in select * from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) loop
    if (b->>'holder')::uuid = p_holder
       and coalesce((b->>'since')::int, v_day) < v_day then
      v_new := v_new || (b || jsonb_build_object('pass_to', p_target::text));
      v_found := true;
    else
      v_new := v_new || b;
    end if;
  end loop;
  if not v_found then return jsonb_build_object('ok', false); end if;
  update rooms set bombs = v_new where id = v_room;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function pass_bomb(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Detonate one of your bombs by id (150 SE, consultation phase). Instantly
-- kills the current holder (no protection — consultation-phase kill). Removes
-- the bomb, privately tells Fanaticism who died, runs the win check.
-- ---------------------------------------------------------------------------
create or replace function detonate_bomb(p_fanatic uuid, p_bomb_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_dead boolean;
  v_bombs jsonb; v_holder uuid; v_holder_dead boolean;
  v_new jsonb := '[]'::jsonb; b jsonb; v_found boolean := false;
  v_winner text; v_name text;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.dead, r.bombs
    into v_room, v_phase, v_se, v_role, v_dead, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'consultation'
     or v_role is distinct from 'fanaticism' or v_dead or v_se < 150 then
    return jsonb_build_object('ok', false);
  end if;
  select (b2->>'holder')::uuid into v_holder
  from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b2
  where (b2->>'id')::int = p_bomb_id;
  if v_holder is null then return jsonb_build_object('ok', false); end if;
  select dead into v_holder_dead from players where id = v_holder;
  if coalesce(v_holder_dead, true) then return jsonb_build_object('ok', false); end if;

  for b in select * from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) loop
    if (b->>'id')::int = p_bomb_id then v_found := true;
    else v_new := v_new || b; end if;
  end loop;
  if not v_found then return jsonb_build_object('ok', false); end if;

  update players set soul_energy = soul_energy - 150 where id = p_fanatic;
  update players set dead = true where id = v_holder;
  update rooms set bombs = v_new where id = v_room;
  select name into v_name from players where id = v_holder;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, p_fanatic, 'Your bomb detonated and killed ' || coalesce(v_name, 'someone') || '.');

  v_winner := vv_check_winner(v_room);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro' else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = v_room;
  end if;
  return jsonb_build_object('ok', true, 'killed_name', v_name);
end; $$;
grant execute on function detonate_bomb(uuid, int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fanaticism's own state for the plant UI: bombs planted / remaining / active.
-- ---------------------------------------------------------------------------
create or replace function fanatic_state(p_fanatic uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_room uuid; v_role text; v_planted int; v_bombs jsonb;
begin
  select p.room_id, s.role, r.bombs_planted, r.bombs
    into v_room, v_role, v_planted, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_role is distinct from 'fanaticism' then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true,
    'planted', coalesce(v_planted, 0),
    'remaining', greatest(0, 2 - coalesce(v_planted, 0)),
    'active', jsonb_array_length(coalesce(v_bombs, '[]'::jsonb)));
end; $$;
grant execute on function fanatic_state(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fanaticism's active bombs for the detonate UI — blind: only id + whether the
-- (unknown) holder is alive (detonatable). No holder name (that costs 100).
-- ---------------------------------------------------------------------------
create or replace function my_bombs(p_fanatic uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_room uuid; v_role text; v_bombs jsonb;
begin
  select p.room_id, s.role, r.bombs into v_room, v_role, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_role is distinct from 'fanaticism' then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', (b->>'id')::int,
             'alive', exists(select 1 from players pl
                             where pl.id = (b->>'holder')::uuid and not pl.dead))
           order by (b->>'id')::int)
    from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
  ), '[]'::jsonb);
end; $$;
grant execute on function my_bombs(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_role_action — add the bomb-movement pass at the end (after deaths are
-- applied), otherwise identical to migration 066's version. Bombs held since a
-- previous day move to their chosen pass_to (if still active) or a random active
-- player; freshly-received bombs on active holders stay one full day.
-- ---------------------------------------------------------------------------
create or replace function resolve_role_action(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_imprisoned text;
  v_protected uuid[] := '{}';
  v_dead uuid[] := '{}';
  v_hospital uuid[] := '{}';
  v_imprison uuid[] := '{}';
  v_envy_a text;
  v_envy_b text;
  v_torment text;
  v_events jsonb;
  v_winner text;
  r record;
  v_newtotal int;
begin
  select last_imprisoned_player into v_last_imprisoned from rooms where id = p_room_id;

  select coalesce(array_agg(s.pending_target::uuid), '{}')
    into v_protected
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and s.pending_action = 'protect' and s.pending_target is not null;

  -- Protection potion: a live buyer shields THEMSELVES this reflection. Add
  -- their own id to the protected set (alongside Justice's protect targets).
  v_protected := v_protected || coalesce((
    select array_agg(s.player_id)
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.potion_protect and not p.dead
  ), '{}'::uuid[]);

  -- Kills + sacrifices. 'kill' targets one player; 'sacrifice' kills the actor
  -- plus a JSON array of targets (each protect-checked).
  for r in
    select p.id, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('kill','sacrifice') and s.pending_target is not null
  loop
    if r.act = 'kill' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    else
      if not (r.id = any(v_protected)) then
        v_dead := array_append(v_dead, r.id);
      end if;
      v_dead := v_dead || coalesce((
        select array_agg(e::uuid)
        from jsonb_array_elements_text(r.tgt::jsonb) e
        where not (e::uuid = any(v_protected))
      ), '{}'::uuid[]);
    end if;
  end loop;

  -- Kill potion: a live buyer kills a target unless protected or already dead.
  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s
      join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_kill_target
    where p.room_id = p_room_id and s.potion_kill_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_dead := array_append(v_dead, r.tgt);
    end if;
  end loop;

  for r in
    select p.id, p.dead as wasdead, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('envy_swap','torment') and s.pending_target is not null
  loop
    if not r.wasdead and not (r.id = any(v_dead)) then
      if r.act = 'envy_swap' then
        v_envy_a := r.id::text;
        v_envy_b := r.tgt;
      else
        v_torment := r.tgt;
      end if;
    end if;
  end loop;

  for r in
    select p.id, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('intox','vengeance_guess') and s.pending_target is not null
  loop
    if r.act = 'intox' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_hospital := array_append(v_hospital, r.tgt::uuid);
      end if;
    else
      if v_last_imprisoned is not null and exists (
        select 1 from player_secrets gs
        where gs.player_id = r.tgt::uuid and gs.vote = v_last_imprisoned
      ) then
        v_hospital := array_append(v_hospital, r.tgt::uuid);
      end if;
    end if;
  end loop;

  -- Hospitalise potion: a live buyer hospitalises a target unless protected or
  -- already dead.
  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s
      join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_hosp_target
    where p.room_id = p_room_id and s.potion_hosp_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_hospital := array_append(v_hospital, r.tgt);
    end if;
  end loop;

  -- Worshipper / Seeker counterpart guesses.
  for r in
    select s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('worshipper_guess','seeker_guess') and s.pending_target is not null
  loop
    if r.act = 'worshipper_guess' then
      if not (r.tgt::uuid = any(v_protected)) and exists (
        select 1 from player_secrets gs where gs.player_id = r.tgt::uuid and gs.role = 'virtue_seeker'
      ) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    else
      if exists (
        select 1 from player_secrets gs where gs.player_id = r.tgt::uuid and gs.role = 'vice_worshipper'
      ) then
        v_imprison := array_append(v_imprison, r.tgt::uuid);
      end if;
    end if;
  end loop;

  -- Extra lives (Determination / Generosity / Wrath, migration 066): a stored
  -- extra life absorbs a would-be kill first, then a would-be hospitalisation,
  -- spending one each. Done here — before kill-counting / achievements / the
  -- win check — so an absorbed kill counts as no kill at all.
  for r in
    select s.player_id as id
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.extra_lives > 0 and s.player_id = any(v_dead)
  loop
    v_dead := array_remove(v_dead, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;
  for r in
    select s.player_id as id
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.extra_lives > 0
      and s.player_id = any(v_hospital) and not (s.player_id = any(v_dead))
  loop
    v_hospital := array_remove(v_hospital, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;

  -- Murder succession removed: a killed Murder simply dies (no hand-off to a
  -- Vice successor). The Murder+1 endgame win check is unchanged.

  -- Murder kill counting + kill_teammate (single-target kills only).
  for r in
    select p.id, p.user_id, p.murder_kills, s.role, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action = 'kill' and s.pending_target is not null
  loop
    if r.tgt::uuid = any(v_dead) then
      if r.user_id is not null and vv_role_camp(r.role) is not null
         and vv_role_camp(r.role) = (
           select vv_role_camp(s2.role) from player_secrets s2 where s2.player_id = r.tgt::uuid
         ) then
        insert into user_achievements (user_id, key)
        values (r.user_id, 'kill_teammate') on conflict do nothing;
      end if;
      if r.role = 'murder' then
        v_newtotal := coalesce(r.murder_kills, 0) + 1;
        update players set murder_kills = v_newtotal where id = r.id;
        if r.user_id is not null then
          if v_newtotal >= 3 then
            insert into user_achievements (user_id, key)
            values (r.user_id, 'murder_3') on conflict do nothing;
          end if;
          if v_newtotal >= 5 then
            insert into user_achievements (user_id, key)
            values (r.user_id, 'murder_5') on conflict do nothing;
          end if;
        end if;
      end if;
    end if;
  end loop;

  insert into user_achievements (user_id, key)
  select p.user_id, 'murdered_hospital'
  from players p
  where p.id = any(v_dead) and p.in_hospital and p.user_id is not null
  on conflict do nothing;

  insert into user_achievements (user_id, key)
  select prot.user_id, 'justice_protect'
  from players prot join player_secrets ps on ps.player_id = prot.id
  where prot.room_id = p_room_id and ps.pending_action = 'protect'
    and ps.pending_target is not null and prot.user_id is not null
    and exists (
      select 1 from player_secrets k join players kp on kp.id = k.player_id
      where kp.room_id = p_room_id and (
        (k.pending_action = 'kill' and k.pending_target = ps.pending_target)
        or (k.pending_action = 'sacrifice' and k.player_id::text = ps.pending_target)
      )
    )
  on conflict do nothing;

  if v_envy_a is not null and v_envy_b is not null and v_envy_b::uuid = any(v_dead) then
    insert into user_achievements (user_id, key)
    select user_id, 'envy_escape' from players
    where id = v_envy_a::uuid and user_id is not null
    on conflict do nothing;
  end if;

  update players set dead = true where id = any(v_dead);
  update players set in_hospital = true
    where id = any(v_hospital) and not (id = any(v_dead));
  update players set in_prison = true
    where id = any(v_imprison) and not (id = any(v_dead));
  -- Clear role actions AND the combat potions (they fired this reflection).
  -- The minigame x2 + vote-reveal potions are consumed elsewhere — leave them.
  update player_secrets set pending_action = null, pending_target = null,
    potion_kill_target = null, potion_hosp_target = null, potion_protect = false
    where player_id in (select id from players where room_id = p_room_id);

  -- Fanaticism bombs (migration 068): every bomb whose holder has carried it
  -- since a PREVIOUS day must move now. It goes to the holder's chosen pass_to
  -- if that target is still active, else to a random active player. A bomb the
  -- holder received this same day (since = today), or one still on an active
  -- holder who only just got it, stays put for its first full day. A bomb whose
  -- holder is no longer active always relocates.
  declare
    v_day int;
    v_bombs jsonb;
    v_newbombs jsonb := '[]'::jsonb;
    b jsonb;
    v_holder uuid;
    v_since int;
    v_passto uuid;
    v_next uuid;
    v_holder_active boolean;
  begin
    select day, bombs into v_day, v_bombs from rooms where id = p_room_id;
    if v_bombs is not null and jsonb_array_length(v_bombs) > 0 then
      for b in select * from jsonb_array_elements(v_bombs) loop
        v_holder := (b->>'holder')::uuid;
        v_since := coalesce((b->>'since')::int, v_day);
        v_passto := nullif(b->>'pass_to', '')::uuid;
        select (not dead and not in_prison and not in_hospital)
          into v_holder_active from players where id = v_holder;
        if coalesce(v_holder_active, false) and v_since >= v_day then
          -- Freshly held by an active player: stays, clear any stale pass_to.
          v_newbombs := v_newbombs
            || jsonb_build_object('id', b->'id', 'holder', v_holder::text,
                                  'since', v_since, 'pass_to', null);
        else
          v_next := null;
          if v_passto is not null then
            select id into v_next from players
            where id = v_passto and room_id = p_room_id
              and not dead and not in_prison and not in_hospital;
          end if;
          if v_next is null then
            select id into v_next from players
            where room_id = p_room_id and not dead and not in_prison and not in_hospital
              and id <> v_holder
            order by random() limit 1;
          end if;
          if v_next is null then v_next := v_holder; end if;  -- nobody to pass to
          v_newbombs := v_newbombs
            || jsonb_build_object('id', b->'id', 'holder', v_next::text,
                                  'since', v_day, 'pass_to', null);
        end if;
      end loop;
      update rooms set bombs = v_newbombs where id = p_room_id;
    end if;
  end;

  v_events := coalesce(
    (select jsonb_agg(jsonb_build_object('type','killed','target_id', q.d))
       from (select distinct u as d from unnest(v_dead) u) q),
    '[]'::jsonb);
  v_events := v_events || coalesce(
    (select jsonb_agg(jsonb_build_object('type','hospitalized','target_id', q.h))
       from (select distinct u as h from unnest(v_hospital) u) q
       where not (q.h = any(v_dead))),
    '[]'::jsonb);

  update rooms
    set envy_swap_a = v_envy_a, envy_swap_b = v_envy_b, torment_target = v_torment
  where id = p_room_id;

  v_winner := vv_check_winner(p_room_id);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro'
                   else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null, last_events = v_events
    where id = p_room_id;
    return;
  end if;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'event_summary', phase_ends_at = null, last_events = v_events
  where id = p_room_id;
end;
$$;

grant execute on function resolve_role_action(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_my_secrets — surface a bomb the caller must pass this reflection (only
-- the holder learns it; bombs are otherwise secret). Adds bomb_must_pass /
-- bomb_pass_to; otherwise identical to migration 066's version.
-- ---------------------------------------------------------------------------
create or replace function get_my_secrets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_room_id uuid;
  v_dying boolean := false;
  v_succ boolean := false;
  v_torment boolean := false;
  v_bomb_pass boolean := false;
  v_bomb_passto text := null;
begin
  select room_id into v_room_id from players where id = p_player_id;
  if v_room_id is not null then
    select
      coalesce(pending_murder_death = p_player_id::text, false),
      coalesce(recent_successor_id = p_player_id::text, false),
      coalesce(torment_target = p_player_id::text, false)
    into v_dying, v_succ, v_torment
    from rooms where id = v_room_id;

    -- Fanaticism bomb I'm holding that I must pass this reflection (received on
    -- an earlier day). Only the holder learns this — bombs are otherwise secret.
    select true, b->>'pass_to'
      into v_bomb_pass, v_bomb_passto
    from rooms r, jsonb_array_elements(r.bombs) b
    where r.id = v_room_id and (b->>'holder')::uuid = p_player_id
      and coalesce((b->>'since')::int, r.day) < r.day
    limit 1;
    v_bomb_pass := coalesce(v_bomb_pass, false);
  end if;

  select jsonb_build_object(
    'role', ps.role, 'vote', ps.vote,
    'pending_action', ps.pending_action, 'pending_target', ps.pending_target,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'extra_lives', coalesce(ps.extra_lives, 0),
    'bomb_must_pass', v_bomb_pass,
    'bomb_pass_to', v_bomb_passto)
  into v
  from player_secrets ps where ps.player_id = p_player_id;

  return coalesce(v, jsonb_build_object(
    'role', null, 'vote', null, 'pending_action', null, 'pending_target', null,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment,
    'extra_lives', 0,
    'bomb_must_pass', v_bomb_pass,
    'bomb_pass_to', v_bomb_passto));
end;
$$;

grant execute on function get_my_secrets(uuid) to anon, authenticated;
