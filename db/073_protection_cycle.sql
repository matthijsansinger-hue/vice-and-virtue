-- ============================================
-- Migration 073 — protection potion lasts a full cycle
-- ============================================
-- After migration 072 the protection potion only shielded shop-phase kills (it
-- was cleared when the shop closed). It should ALSO block Murder / Intoxication
-- again. Fix: resolve_store no longer clears potion_protect — it persists to the
-- NEXT reflection, where resolve_role_action's protect block shields the buyer
-- (Murder/Intox/any role-action kill) and then consumes it. So one protection
-- purchase covers the whole cycle: the shop's kills + the next reflection.
-- Only resolve_store changes (resolve_role_action already had the protect block
-- + the clear from migration 072).
-- ============================================

create or replace function resolve_store(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protected uuid[] := '{}';
  v_dead uuid[] := '{}';       -- protect/extra-life eligible (potions + sacrifices)
  v_detonated uuid[] := '{}';  -- bomb deaths (unblockable, no extra life)
  v_hospital uuid[] := '{}';
  v_events jsonb;
  v_winner text;
  v_fanatic uuid;
  v_bombs jsonb;
  v_newbombs jsonb := '[]'::jsonb;
  r record;
  b jsonb;
begin
  -- Protection potions shield their (alive) buyer.
  select coalesce(array_agg(s.player_id), '{}') into v_protected
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.potion_protect and not p.dead;

  -- Kill potions: a live buyer kills a target unless protected or already dead.
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

  -- Sacrifices queued in the shop: the actor + a JSON array of targets, each
  -- protect-checked.
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

  -- Hospitalise potions: a live buyer hospitalises a target unless protected or
  -- already dead.
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

  -- Extra lives absorb a would-be kill first, then a would-be hospitalisation
  -- (potions/sacrifices only — detonations bypass them).
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

  -- Armed bomb detonations: kill the (still-alive) holder, unblockable.
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

  -- Clear the kill/hospitalise potions + shop sacrifices (they fired). Leave the
  -- minigame multiplier + vote-reveal potions for their own resolvers, AND leave
  -- potion_protect set: it lasts a full cycle (migration 073), so it also shields
  -- the buyer against Murder/Intoxication in the NEXT reflection, where
  -- resolve_role_action's protect block uses it and then clears it.
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
