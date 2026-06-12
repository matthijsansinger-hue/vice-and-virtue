-- ============================================
-- Migration 071 — Wrath/Love conversion is deferred to the end of role-action
-- ============================================
-- convert_player no longer applies instantly; it QUEUES the conversion
-- (pending_action='convert') and charges 200 SE. The flip happens in
-- resolve_role_action, AFTER the turn's actions resolved — so the target's own
-- ability this turn still fires — and before pending actions are cleared + the
-- win check (a conversion flips a camp, which can decide the game). The landing
-- check (non-S role of the wanted camp, still alive) runs there against a
-- snapshot of camps/tiers taken before any conversion lands, so two converts on
-- the same target don't chain. The caster gets a notice with the outcome; the
-- converted player learns it via the client role-change popup.
-- ============================================

create or replace function convert_player(p_player_id uuid, p_target_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room uuid; v_phase text; v_se numeric; v_role text; v_acted boolean;
  v_dead boolean; v_prison boolean; v_hosp boolean; v_tgt_active boolean;
begin
  select p.room_id, r.phase, p.soul_energy, s.role, p.acted_this_day,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_phase, v_se, v_role, v_acted, v_dead, v_prison, v_hosp
  from players p join rooms r on r.id = p.room_id join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;
  if v_room is null or v_phase is distinct from 'role_action'
     or v_role not in ('wrath','love') or v_acted
     or v_dead or v_prison or v_hosp or v_se < 200 or p_target_id = p_player_id then
    return jsonb_build_object('ok', false);
  end if;
  select (not dead and not in_prison and not in_hospital) into v_tgt_active
  from players where id = p_target_id and room_id = v_room;
  if v_tgt_active is null or not v_tgt_active then
    return jsonb_build_object('ok', false);
  end if;

  -- Queue the conversion; it lands in resolve_role_action AFTER the target's own
  -- action this turn has fired, checked there against a camp/tier snapshot (only
  -- a non-S role of the wanted camp flips; S-tier roles — incl. Wrath/Love — are
  -- immune). Charged now (a gamble); the result comes back to you as a notice.
  update players set soul_energy = soul_energy - 200, acted_this_day = true
  where id = p_player_id;
  update player_secrets set pending_action = 'convert', pending_target = p_target_id::text
  where player_id = p_player_id;
  return jsonb_build_object('ok', true, 'queued', true);
end; $$;
grant execute on function convert_player(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_role_action — adds the deferred Wrath/Love conversion pass (after
-- deaths are applied, before pending actions are cleared + the win check).
-- Otherwise identical to migration 068's version (bomb movement included).
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

  -- Wrath/Love conversions (migration 071): applied HERE — after the turn's
  -- actions resolved (so the target's own ability this turn still fired) and
  -- before pending actions are cleared + the win check (a conversion flips a
  -- camp, which can decide the game). Evaluated against a snapshot of camps/
  -- tiers taken before any conversion lands, so two converts on one target
  -- don't chain. Lands only on a still-alive, non-S role of the wanted camp;
  -- the caster is told the outcome (the convert sees it via the role-change
  -- popup). Charged at cast time, so a whiff is just a wasted offering.
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
