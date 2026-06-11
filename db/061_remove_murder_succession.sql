-- ============================================
-- Remove Murder succession (migration 061).
-- ============================================
-- A killed Murder no longer hands the role to a Vice successor — she simply
-- dies like any other role. The `murder_succession` phase + choose_murder_
-- successor / eligible_successors RPCs are now unreachable (left in place as
-- harmless dead code). The Murder+1 endgame win check (vv_check_winner) is
-- UNCHANGED — only the death hand-off is removed.
--
-- Redefines resolve_role_action without the succession detection + the
-- `murder_succession` phase transition (drops the v_dying_murder / v_succession
-- / v_candidates locals). Mirrors the live migration-056 + 059 (combat potions)
-- version. Also mirrored into db/schema.sql.

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

  -- Murder succession removed (migration 061): a killed Murder simply dies (no
  -- hand-off to a Vice successor). The Murder+1 endgame win check is unchanged.

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
