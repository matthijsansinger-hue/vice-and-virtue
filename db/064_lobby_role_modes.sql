-- ============================================
-- Lobby role-assignment modes (migration 064) — ranked flow rework, batch 2.
-- ============================================
-- Quick play + private lobbies get the same live role selection as ranked.
-- The host picks between two modes in the lobby (rooms.role_assign_mode):
--   * 'choose' (DEFAULT for new lobbies): on Start, players are dealt a camp +
--     tier and the room opens in role_select (30s live pick), then
--     role_overview -> lore_intro -> straight into role_action.
--   * 'random' (the old flow): roles are dealt secretly — but the per-tier
--     roles now come from the host's configuration (rooms.role_config,
--     validated per slot; unset/invalid slots fall back to the defaults, C tier
--     random of its two). Flow: role_overview -> lore_intro -> role_reveal ->
--     role_action. The old game_overview phase is no longer used.
--
-- role_config shape: {"vice": {"S": "murder", ..., "C": "torment"},
--                     "virtue": {...}} — only tiers with >1 playable role offer
-- a real choice today (C); the structure is future-proof for new roles.

alter table rooms alter column role_assign_mode set default 'choose';

-- A configured slot role, validated: must be playable and match the slot's
-- camp + tier; anything else falls back to the default.
create or replace function vv_config_slot(
  p_config jsonb, p_camp text, p_tier text, p_default text
)
returns text
language sql
stable
as $$
  select case
    when (p_config #>> array[p_camp, p_tier]) is not null
     and (p_config #>> array[p_camp, p_tier]) = any(array[
       'murder','intoxication','envy','torment','vengeance','vice_worshipper',
       'empathy','justice','certainty','truthfulness','sacrifice','virtue_seeker'])
     and vv_role_camp(p_config #>> array[p_camp, p_tier]) = p_camp
     and vv_role_tier(p_config #>> array[p_camp, p_tier]) = p_tier
    then p_config #>> array[p_camp, p_tier]
    else p_default
  end;
$$;

-- Start the game from the lobby, branching on the room's assignment mode.
create or replace function assign_roles_and_start(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_config jsonb;
  v_total int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_ids uuid[];
  v_vice_tiers text[];
  v_virtue_tiers text[];
  v_player record;
  v_i int := 1;
  c_tiers text[] := array['S','A','B','C','D'];
  -- Random-mode C-tier defaults (one of the two, per camp, per game).
  v_vice_c text := (array['torment','vengeance'])[1 + floor(random() * 2)::int];
  v_virtue_c text := (array['truthfulness','sacrifice'])[1 + floor(random() * 2)::int];
begin
  select role_assign_mode, role_config into v_mode, v_config
  from rooms where id = p_room_id;

  select count(*) into v_total from players where room_id = p_room_id;
  v_vice := floor(v_total / 2.0);
  v_virtue := v_total - v_vice;

  if v_mode = 'choose' then
    -- Deal camps + tiers only; roles are picked live in role_select.
    select array_agg(id order by random()) into v_ids
    from players where room_id = p_room_id;

    select array_agg(t order by random()) into v_vice_tiers
    from (select coalesce(c_tiers[i], 'D') as t
          from generate_series(1, v_vice) i) q;
    select array_agg(t order by random()) into v_virtue_tiers
    from (select coalesce(c_tiers[i], 'D') as t
          from generate_series(1, v_virtue) i) q;

    for v_i in 1..v_total loop
      insert into player_secrets (player_id, role, vote, pending_action,
                                  pending_target, assigned_camp, assigned_tier,
                                  role_choice)
      values (v_ids[v_i], null, null, null, null,
              case when v_i <= v_vice then 'vice' else 'virtue' end,
              case when v_i <= v_vice then v_vice_tiers[v_i]
                   else v_virtue_tiers[v_i - v_vice] end,
              null)
      on conflict (player_id) do update
        set role = null, vote = null, pending_action = null,
            pending_target = null, role_choice = null,
            assigned_camp = excluded.assigned_camp,
            assigned_tier = excluded.assigned_tier;
      update players set soul_energy = 100, ready = false, has_voted = false
      where id = v_ids[v_i];
    end loop;

    update rooms set
      status = 'in_game', phase = 'role_select',
      phase_ends_at = now() + interval '30 seconds',
      role_pool = null, eye_uses_left = 1, free_uses_left = 1
    where id = p_room_id;
    return;
  end if;

  -- 'random': secret deal. Tier slots come from the host's config when valid
  -- (today only the C tier has a real choice); who GETS each role is random.
  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'vice', 'S', 'murder'),
        vv_config_slot(v_config, 'vice', 'A', 'intoxication'),
        vv_config_slot(v_config, 'vice', 'B', 'envy'),
        vv_config_slot(v_config, 'vice', 'C', v_vice_c)
      ])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'virtue', 'S', 'empathy'),
        vv_config_slot(v_config, 'virtue', 'A', 'justice'),
        vv_config_slot(v_config, 'virtue', 'B', 'certainty'),
        vv_config_slot(v_config, 'virtue', 'C', v_virtue_c)
      ])[i],
      'virtue_seeker'));
  end loop;

  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action,
                                pending_target, assigned_camp, assigned_tier,
                                role_choice)
    values (v_player.id, v_roles[v_i], null, null, null, null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null,
          assigned_camp = null, assigned_tier = null, role_choice = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  -- Random mode now also opens on the role_overview cast screen (the old
  -- game_overview tutorial screen is retired), then lore_intro -> role_reveal.
  update rooms set
    status = 'in_game', phase = 'role_overview', phase_ends_at = null,
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1
  where id = p_room_id;
end;
$$;

grant execute on function assign_roles_and_start(uuid) to anon, authenticated;
