-- Migration 113 — Vengeance: kill every jailer she can afford
--
-- Once imprisoned, Vengeance sees the full list of players who voted her in and
-- may take as many of them as she can pay for — 150 Soul Energy each, chosen in
-- one go rather than one per day. Justice's protect can still spare any
-- individual target, and extra lives still absorb, exactly as before.
--
-- Also closes a gap migration 098 missed: BOTH vengeance RPCs were granted to
-- anon with NO vv_is_me check. Verified live before this migration — an
-- anonymous caller got `false` / `[]` (the body ran) rather than 'forbidden'.
-- That let anyone spend Vengeance's Soul Energy and queue kills in her name,
-- and — because the calls only succeed for the real Vengeance — let an attacker
-- identify her by calling them once per player id. Both now gate on vv_is_me.
--
-- ⚠️ resolve_role_action_impl BELOW IS WRITTEN TO THE _impl NAME ON PURPOSE.
-- Migrations 097/098 split every gated RPC into <name>_impl (the body) plus a
-- thin host/caller-gate wrapper under the bare name. Writing to
-- resolve_role_action here would REPLACE the host gate with this body. Its
-- text is the LIVE function (dumped from pg_proc, md5
-- 32371766400bcf213d3c6026f304865e) with only the three vengeance_kill edits
-- applied — the repo's copies did not match production, so nothing here was
-- reconstructed from a file.

begin;

-- The jailers she may take. Unchanged except for the caller gate: it returns
-- who voted to imprison the caller, which is secret and was readable by anyone.
create or replace function vengeance_revenge_targets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_role text;
  v_prison boolean;
  v_list jsonb;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, s.role, p.in_prison into v_room, v_role, v_prison
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'vengeance' or not v_prison then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name)), '[]'::jsonb)
    into v_list
  from rooms rm
  join players pl on pl.room_id = rm.id and not pl.dead
  where rm.id = v_room and rm.vengeance_imprisoners ? pl.id::text;

  return v_list;
end;
$$;
grant execute on function vengeance_revenge_targets(uuid) to anon, authenticated;

-- Multi-target revenge. Signature changes (uuid, uuid) -> (uuid, jsonb), so the
-- single-target version is dropped; the client passes an array of ids.
-- Charges 150 per target atomically: she either affords the whole batch or the
-- call is rejected, so a partial spend can't strand her.
drop function if exists queue_vengeance_revenge(uuid, uuid);

create or replace function queue_vengeance_revenge(p_player_id uuid, p_targets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_se numeric;
  v_role text;
  v_prison boolean;
  v_acted boolean;
  v_count int;
  v_cost numeric;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;

  select p.room_id, p.soul_energy, s.role, p.in_prison, p.acted_this_day
    into v_room, v_se, v_role, v_prison, v_acted
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_role is distinct from 'vengeance' or not v_prison then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if v_acted then
    return jsonb_build_object('ok', false, 'reason', 'already_acted');
  end if;
  if p_targets is null or jsonb_typeof(p_targets) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  select count(distinct e) into v_count from jsonb_array_elements_text(p_targets) e;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  -- Every target must be one of HER jailers and still alive. Counting the valid
  -- ones and comparing to the requested count rejects the whole batch if any
  -- single id is bogus, rather than silently charging for a target that can't die.
  if (
    select count(distinct e)
    from jsonb_array_elements_text(p_targets) e
    where exists (select 1 from rooms where id = v_room and vengeance_imprisoners ? e)
      and exists (select 1 from players where id = e::uuid and room_id = v_room and not dead)
  ) <> v_count then
    return jsonb_build_object('ok', false, 'reason', 'bad_targets');
  end if;

  v_cost := 150 * v_count;
  if v_se < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_se', 'needed', v_cost);
  end if;

  -- Resolved by resolve_role_action_impl's 'vengeance_kill' branch, so protect
  -- and extra lives apply per target exactly like any other queued kill.
  update player_secrets
     set pending_action = 'vengeance_kill',
         pending_target = (select jsonb_agg(distinct e) from jsonb_array_elements_text(p_targets) e)::text
   where player_id = p_player_id;
  update players
     set soul_energy = soul_energy - v_cost, acted_this_day = true
   where id = p_player_id;

  return jsonb_build_object('ok', true, 'targets', v_count, 'spent', v_cost);
end;
$$;
grant execute on function queue_vengeance_revenge(uuid, jsonb) to anon, authenticated;

-- The live resolver + the vengeance_kill branch. See the ⚠️ note in the header.
create or replace function resolve_role_action_impl(p_room_id uuid)
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
      and s.pending_action in ('kill','sacrifice','vengeance_kill') and s.pending_target is not null
  loop
    if r.act = 'kill' then
      if not (r.tgt::uuid = any(v_protected)) then
        v_dead := array_append(v_dead, r.tgt::uuid);
      end if;
    elsif r.act = 'vengeance_kill' then
      -- Imprisoned Vengeance takes as many of her jailers as she paid for
      -- (150 SE each, migration 113). Same protect-checked jsonb array as
      -- sacrifice, except the actor does NOT die with them.
      v_dead := v_dead || coalesce((
        select array_agg(e::uuid)
        from jsonb_array_elements_text(r.tgt::jsonb) e
        where not (e::uuid = any(v_protected))
      ), '{}'::uuid[]);
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
        where p.room_id = p_room_id and s.pending_action = 'vengeance_kill'
          and s.pending_target is not null
          and s.pending_target::jsonb ? v_kvic::text
        limit 1;
      end if;
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
-- Internal: only the gated wrapper may call this (migrations 097 + 112).
revoke all on function resolve_role_action_impl(uuid) from public, anon, authenticated;

commit;
