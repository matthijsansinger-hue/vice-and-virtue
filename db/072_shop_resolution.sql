-- ============================================
-- Migration 072 — Fanaticism reshuffle + shop-phase resolution
-- ============================================
-- Fanaticism:
--   * plant_bomb / bomb_carriers cost 50 SE (were 100).
--   * the receiver of a bomb (plant, and each pass) now gets a notice.
--   * bomb_carriers + detonate_bomb move from role-action / consultation to the
--     STORE (potion-buy) phase. Detonation is DEFERRED: it arms the bomb, and
--     resolve_store kills the holder when the shop closes.
-- Shop resolution: combat potions (kill/hospitalise/protection), bomb
-- detonations, and sacrifices now ALL resolve when the STORE phase closes, into
-- a new `store_summary` recap shown before the camp abilities. (Combat potions
-- used to resolve in the next reflection.) Sacrifice now acts in role-action +
-- the shop (no longer in consultation; that UI is removed client-side).
--
-- NOTE: resolve_role_action's combat-potion blocks are left in place but are
-- now INERT — combat potions are armed in the shop (after role-action) and
-- cleared by resolve_store the same day, so they're always null by the next
-- role-action. Only the bomb-move "received a bomb" notice is new here.
-- ============================================

-- ---------------------------------------------------------------------------
-- Fanaticism bomb RPCs
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
     or v_dead or v_prison or v_hosp or v_se < 50
     or coalesce(v_planted, 0) >= 2 or p_target = p_fanatic then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;
  select exists(
    select 1 from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
    where (b->>'holder')::uuid = p_target
  ) into v_holds;
  if v_holds then return jsonb_build_object('ok', false, 'reason', 'already_holding'); end if;

  v_id := coalesce(v_planted, 0) + 1;
  update players set soul_energy = soul_energy - 50, acted_this_day = true where id = p_fanatic;
  update rooms set bombs_planted = v_id,
    bombs = coalesce(bombs, '[]'::jsonb)
            || jsonb_build_object('id', v_id, 'holder', p_target::text,
                                  'since', v_day, 'pass_to', null)
  where id = v_room;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, p_target,
    'A bomb has been slipped into your hands. From tomorrow you must pass it on each reflection — and if it goes off while you hold it, you die.');
  return jsonb_build_object('ok', true, 'bomb_id', v_id);
end; $$;
grant execute on function plant_bomb(uuid, uuid) to anon, authenticated;

create or replace function bomb_carriers(p_fanatic uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_bombs jsonb; v_list jsonb;
begin
  select p.room_id, r.phase, p.soul_energy, s.role,
         p.dead, p.in_prison, p.in_hospital, r.bombs
    into v_room, v_phase, v_se, v_role, v_dead, v_prison, v_hosp, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'store'
     or v_role is distinct from 'fanaticism'
     or v_dead or v_prison or v_hosp or v_se < 50 then
    return jsonb_build_object('ok', false);
  end if;
  update players set soul_energy = soul_energy - 50 where id = p_fanatic;
  select coalesce(jsonb_agg(
           jsonb_build_object('id', (b->>'id')::int, 'name', pl.name)
           order by (b->>'id')::int), '[]'::jsonb)
    into v_list
  from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
  join players pl on pl.id = (b->>'holder')::uuid;
  return jsonb_build_object('ok', true, 'carriers', v_list);
end; $$;
grant execute on function bomb_carriers(uuid) to anon, authenticated;

create or replace function detonate_bomb(p_fanatic uuid, p_bomb_id int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_dead boolean;
  v_bombs jsonb; v_holder uuid; v_holder_dead boolean; v_armed boolean;
  v_new jsonb := '[]'::jsonb; b jsonb; v_found boolean := false;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.dead, r.bombs
    into v_room, v_phase, v_se, v_role, v_dead, v_bombs
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_fanatic;
  if v_room is null or v_phase is distinct from 'store'
     or v_role is distinct from 'fanaticism' or v_dead or v_se < 150 then
    return jsonb_build_object('ok', false);
  end if;
  select (b2->>'holder')::uuid, coalesce((b2->>'armed')::boolean, false)
    into v_holder, v_armed
  from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b2
  where (b2->>'id')::int = p_bomb_id;
  if v_holder is null or v_armed then return jsonb_build_object('ok', false); end if;
  select dead into v_holder_dead from players where id = v_holder;
  if coalesce(v_holder_dead, true) then return jsonb_build_object('ok', false); end if;

  for b in select * from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) loop
    if (b->>'id')::int = p_bomb_id then
      v_new := v_new || (b || '{"armed": true}'::jsonb); v_found := true;
    else v_new := v_new || b; end if;
  end loop;
  if not v_found then return jsonb_build_object('ok', false); end if;

  update players set soul_energy = soul_energy - 150 where id = p_fanatic;
  update rooms set bombs = v_new where id = v_room;
  return jsonb_build_object('ok', true, 'armed', true);
end; $$;
grant execute on function detonate_bomb(uuid, int) to anon, authenticated;

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
                             where pl.id = (b->>'holder')::uuid and not pl.dead),
             'armed', coalesce((b->>'armed')::boolean, false))
           order by (b->>'id')::int)
    from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) b
  ), '[]'::jsonb);
end; $$;
grant execute on function my_bombs(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_role_action — unchanged except the bomb-move "received a bomb" notice.
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

  -- Protection potion (inert in the new flow — combat potions resolve in the
  -- shop now; left here harmlessly since the field is null at role-action).
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

  -- Kill potion (inert in the new flow — see note above).
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

  -- Hospitalise potion (inert in the new flow — see note above).
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

  -- Extra lives (migration 066): absorb a would-be kill then hospitalisation.
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

  -- Wrath/Love conversions (migration 071): snapshot-evaluated, applied here.
  declare
    v_converts jsonb;
    cc jsonb;
    v_caster uuid; v_crole text; v_ctgt uuid;
    v_tcamp text; v_ttier text; v_want text; v_newrole text; v_tname text;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
             'caster', cp.player_id, 'crole', cp.role, 'tgt', cp.pending_target,
             'tcamp', vv_role_camp(ts.role), 'ttier', vv_role_tier(ts.role))), '[]'::jsonb)
      into v_converts
    from player_secrets cp
      join players p on p.id = cp.player_id
      join player_secrets ts on ts.player_id = cp.pending_target::uuid
    where p.room_id = p_room_id and cp.pending_action = 'convert'
      and cp.pending_target is not null;

    for cc in select * from jsonb_array_elements(v_converts) loop
      v_caster := (cc->>'caster')::uuid;
      v_crole  := cc->>'crole';
      v_ctgt   := (cc->>'tgt')::uuid;
      v_tcamp  := cc->>'tcamp';
      v_ttier  := cc->>'ttier';
      if v_crole = 'wrath' then v_want := 'virtue'; v_newrole := 'vice_worshipper';
      else v_want := 'vice'; v_newrole := 'virtue_seeker'; end if;
      select name into v_tname from players where id = v_ctgt;
      if not (v_ctgt = any(v_dead)) and v_tcamp = v_want and v_ttier is distinct from 'S' then
        update player_secrets set role = v_newrole,
          follower_of = case when v_crole = 'wrath' then v_caster else null end
        where player_id = v_ctgt;
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, v_caster,
          'Your influence took hold — ' || coalesce(v_tname, 'your target')
          || ' now serves your camp.');
      else
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, v_caster,
          coalesce(v_tname, 'Your target') || ' resisted your influence.');
      end if;
    end loop;
  end;

  -- Clear role actions + the (inert) combat potion fields.
  update player_secrets set pending_action = null, pending_target = null,
    potion_kill_target = null, potion_hosp_target = null, potion_protect = false
    where player_id in (select id from players where room_id = p_room_id);

  -- Fanaticism bombs (migration 068): move every bomb held since a previous day;
  -- the new holder is told they've received it (migration 072).
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
          if v_next is null then v_next := v_holder; end if;
          v_newbombs := v_newbombs
            || jsonb_build_object('id', b->'id', 'holder', v_next::text,
                                  'since', v_day, 'pass_to', null);
          if v_next is distinct from v_holder then
            insert into player_notices (room_id, recipient_id, text)
            values (p_room_id, v_next,
              'A bomb has been passed into your hands. Pass it on next reflection — if it goes off while you hold it, you die.');
          end if;
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
-- resolve_store — runs when the STORE phase closes (migration 072). Resolves
-- combat potions + bomb detonations + sacrifices, then opens store_summary.
-- ---------------------------------------------------------------------------
create or replace function resolve_store(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protected uuid[] := '{}';
  v_dead uuid[] := '{}';
  v_detonated uuid[] := '{}';
  v_hospital uuid[] := '{}';
  v_events jsonb;
  v_winner text;
  v_fanatic uuid;
  v_bombs jsonb;
  v_newbombs jsonb := '[]'::jsonb;
  r record;
  b jsonb;
begin
  select coalesce(array_agg(s.player_id), '{}') into v_protected
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.potion_protect and not p.dead;

  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_kill_target
    where p.room_id = p_room_id and s.potion_kill_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_dead := array_append(v_dead, r.tgt);
    end if;
  end loop;

  for r in
    select p.id, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.pending_action = 'sacrifice'
      and s.pending_target is not null
  loop
    if not (r.id = any(v_protected)) then
      v_dead := array_append(v_dead, r.id);
    end if;
    v_dead := v_dead || coalesce((
      select array_agg(e::uuid)
      from jsonb_array_elements_text(r.tgt::jsonb) e
      where not (e::uuid = any(v_protected))
    ), '{}'::uuid[]);
  end loop;

  for r in
    select tp.id as tgt, tp.dead as tgt_dead
    from player_secrets s join players p on p.id = s.player_id
      join players tp on tp.id = s.potion_hosp_target
    where p.room_id = p_room_id and s.potion_hosp_target is not null
      and not p.dead and tp.room_id = p_room_id
  loop
    if not r.tgt_dead and not (r.tgt = any(v_protected)) then
      v_hospital := array_append(v_hospital, r.tgt);
    end if;
  end loop;

  for r in
    select s.player_id as id from player_secrets s
    where s.player_id = any(v_dead) and s.extra_lives > 0
  loop
    v_dead := array_remove(v_dead, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;
  for r in
    select s.player_id as id from player_secrets s
    where s.player_id = any(v_hospital) and not (s.player_id = any(v_dead))
      and s.extra_lives > 0
  loop
    v_hospital := array_remove(v_hospital, r.id);
    update player_secrets set extra_lives = extra_lives - 1 where player_id = r.id;
  end loop;

  select player_id into v_fanatic
  from player_secrets
  where role = 'fanaticism'
    and player_id in (select id from players where room_id = p_room_id)
  limit 1;
  select bombs into v_bombs from rooms where id = p_room_id;
  for b in select * from jsonb_array_elements(coalesce(v_bombs, '[]'::jsonb)) loop
    if coalesce((b->>'armed')::boolean, false)
       and exists (select 1 from players where id = (b->>'holder')::uuid and not dead) then
      v_detonated := array_append(v_detonated, (b->>'holder')::uuid);
      if v_fanatic is not null then
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, v_fanatic, 'Your bomb detonated and killed '
          || coalesce((select name from players where id = (b->>'holder')::uuid), 'someone') || '.');
      end if;
    elsif not coalesce((b->>'armed')::boolean, false) then
      v_newbombs := v_newbombs || b;
    end if;
  end loop;
  update rooms set bombs = v_newbombs where id = p_room_id;

  update players set dead = true where id = any(v_dead) or id = any(v_detonated);
  update players set in_hospital = true
    where id = any(v_hospital)
      and not (id = any(v_dead)) and not (id = any(v_detonated));

  v_events := coalesce(
    (select jsonb_agg(jsonb_build_object('type','killed','target_id', q.d))
       from (select distinct u as d from unnest(v_dead || v_detonated) u) q),
    '[]'::jsonb);
  v_events := v_events || coalesce(
    (select jsonb_agg(jsonb_build_object('type','hospitalized','target_id', q.h))
       from (select distinct u as h from unnest(v_hospital) u) q
       where not (q.h = any(v_dead)) and not (q.h = any(v_detonated))),
    '[]'::jsonb);

  update player_secrets set
    potion_kill_target = null, potion_hosp_target = null, potion_protect = false,
    pending_action = null, pending_target = null
  where player_id in (select id from players where room_id = p_room_id);

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
  update rooms set phase = 'store_summary', phase_ends_at = null, last_events = v_events
  where id = p_room_id;
end;
$$;

grant execute on function resolve_store(uuid) to anon, authenticated;
