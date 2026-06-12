-- ============================================
-- Migration 074 — "who killed who" overview at game over
-- ============================================
-- Accumulates a per-game kill log on rooms.kill_log: one {killer, victim, day}
-- entry per ACTUAL death, attributed at the end of each resolution by deriving a
-- single killer from the pending actions (priority order). Sources:
--   * resolve_role_action — direct kill (Murder / Justice kill / Gambling /
--     Vengeance revenge), sacrifice (self + targets), Worshipper's guess.
--   * resolve_store — kill potion, shop sacrifice, bomb detonation (Fanaticism).
--   * relinquish_follower — Wrath consumes a follower.
-- kill_log is SECRET during play (it would leak roles/abilities) and is read
-- only via get_kill_log once the game is 'ended'. GameOver renders it.
-- ============================================

alter table rooms add column if not exists kill_log jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- relinquish_follower — log the consumed follower (migration 074).
-- ---------------------------------------------------------------------------
create or replace function relinquish_follower(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_follower uuid; v_winner text;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role is distinct from 'wrath' or v_acted
     or v_dead or v_prison or v_hosp or v_se < 100 then
    return jsonb_build_object('ok', false);
  end if;
  select s.player_id into v_follower
  from player_secrets s join players p on p.id = s.player_id
  where s.follower_of = p_player_id and not p.dead
  order by p.created_at limit 1;
  if v_follower is null then return jsonb_build_object('ok', false); end if;

  update players set soul_energy = soul_energy - 100, acted_this_day = true where id = p_player_id;
  update players set dead = true where id = v_follower;
  update player_secrets set extra_lives = extra_lives + 1 where player_id = p_player_id;
  insert into player_notices (room_id, recipient_id, text)
  values (v_room, v_follower, 'Wrath has consumed your life for their own.');
  update rooms set kill_log = coalesce(kill_log, '[]'::jsonb)
    || jsonb_build_object('killer', p_player_id, 'victim', v_follower,
                          'day', (select day from rooms where id = v_room))
  where id = v_room;

  v_winner := vv_check_winner(v_room);
  if v_winner is not null then
    update rooms set
      phase = case when v_winner = 'vice' then 'vice_victory_intro' else 'virtue_victory_intro' end,
      status = 'ended', phase_ends_at = null
    where id = v_room;
  end if;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function relinquish_follower(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_role_action — adds the kill-attribution block (migration 074).
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

  -- Protection potion: a buyer's shield lasts a full cycle (migration 073).
  v_protected := v_protected || coalesce((
    select array_agg(s.player_id)
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.potion_protect and not p.dead
  ), '{}'::uuid[]);

  -- Kills + sacrifices.
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

  -- Kill potion (inert in the new flow — combat potions resolve in the shop).
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

  -- Hospitalise potion (inert in the new flow).
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

  -- Attribute kills for the game-over overview (migration 074): one killer per
  -- actually-dead victim, derived in priority order (direct kill, then a
  -- sacrifice that took them, then a Worshipper's guess). A self-sacrifice logs
  -- killer = victim.
  declare
    v_kday int; v_kvic uuid; v_kkiller uuid; v_klog jsonb := '[]'::jsonb;
  begin
    select day into v_kday from rooms where id = p_room_id;
    for v_kvic in select distinct u from unnest(v_dead) u loop
      v_kkiller := null;
      select p.id into v_kkiller
      from players p join player_secrets s on s.player_id = p.id
      where p.room_id = p_room_id and s.pending_action = 'kill'
        and s.pending_target = v_kvic::text limit 1;
      if v_kkiller is null then
        select s.player_id into v_kkiller
        from player_secrets s join players p on p.id = s.player_id
        where p.room_id = p_room_id and s.pending_action = 'sacrifice'
          and (s.player_id = v_kvic
               or (s.pending_target is not null and s.pending_target::jsonb ? v_kvic::text))
        limit 1;
      end if;
      if v_kkiller is null then
        select p.id into v_kkiller
        from players p join player_secrets s on s.player_id = p.id
        where p.room_id = p_room_id and s.pending_action = 'worshipper_guess'
          and s.pending_target = v_kvic::text limit 1;
      end if;
      v_klog := v_klog
        || jsonb_build_object('killer', v_kkiller, 'victim', v_kvic, 'day', v_kday);
    end loop;
    if jsonb_array_length(v_klog) > 0 then
      update rooms set kill_log = coalesce(kill_log, '[]'::jsonb) || v_klog
      where id = p_room_id;
    end if;
  end;

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
-- resolve_store — adds the kill-attribution block (migration 074).
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

  -- Attribute shop kills (migration 074): detonations are the Fanaticism's;
  -- otherwise the kill-potion buyer or the sacrifice actor.
  declare
    v_kday int; v_kvic uuid; v_kkiller uuid; v_klog jsonb := '[]'::jsonb;
  begin
    select day into v_kday from rooms where id = p_room_id;
    for v_kvic in select distinct u from unnest(v_detonated) u loop
      v_klog := v_klog
        || jsonb_build_object('killer', v_fanatic, 'victim', v_kvic, 'day', v_kday);
    end loop;
    for v_kvic in select distinct u from unnest(v_dead) u loop
      v_kkiller := null;
      select s.player_id into v_kkiller
      from player_secrets s join players p on p.id = s.player_id
      where p.room_id = p_room_id and s.potion_kill_target = v_kvic limit 1;
      if v_kkiller is null then
        select s.player_id into v_kkiller
        from player_secrets s join players p on p.id = s.player_id
        where p.room_id = p_room_id and s.pending_action = 'sacrifice'
          and (s.player_id = v_kvic
               or (s.pending_target is not null and s.pending_target::jsonb ? v_kvic::text))
        limit 1;
      end if;
      v_klog := v_klog
        || jsonb_build_object('killer', v_kkiller, 'victim', v_kvic, 'day', v_kday);
    end loop;
    if jsonb_array_length(v_klog) > 0 then
      update rooms set kill_log = coalesce(kill_log, '[]'::jsonb) || v_klog
      where id = p_room_id;
    end if;
  end;

  update player_secrets set
    potion_kill_target = null, potion_hosp_target = null,
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

-- ---------------------------------------------------------------------------
-- get_kill_log — gated on the game being ENDED (so it never leaks mid-game).
-- ---------------------------------------------------------------------------
create or replace function get_kill_log(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when status = 'ended' then coalesce(kill_log, '[]'::jsonb)
              else '[]'::jsonb end
  from rooms where id = p_room_id;
$$;

grant execute on function get_kill_log(uuid) to anon, authenticated;
