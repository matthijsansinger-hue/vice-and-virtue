-- ============================================
-- One C-tier role per game; ranked 6v6 -> 5v5 (migration 057).
-- ============================================
-- The role tiers are S/A/B/C/D. Until now the C tier put TWO roles into every
-- game (Vice: torment + vengeance, Virtue: truthfulness + sacrifice), so a full
-- camp ran S,A,B,C,C,D and the largest ranked mode was 6v6. We now use exactly
-- ONE C-tier role per camp per game, chosen at random from that camp's two, so a
-- full camp is S,A,B,C,D and the largest ranked mode is 5v5.
--
-- Touches: casual assignment (assign_roles_and_start) + the ranked queue
-- (join_ranked_queue / ranked_queue_counts / ranked_form_match /
-- ranked_matchmake). The ranked_queue table itself is unchanged (mode is a free
-- text column); we just stop accepting '6v6' and clear any stale rows.

-- Any players still queued for the retired 6v6 mode get dropped (they re-queue).
delete from ranked_queue where mode = '6v6';

-- --- Casual assignment: one random C-tier role per camp ---
create or replace function assign_roles_and_start(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_player record;
  v_i int := 1;
  -- Exactly one C-tier role per camp per game, picked at random from the two
  -- (Vice: torment/vengeance, Virtue: truthfulness/sacrifice). Every other tier
  -- contributes one role, so a full camp is S,A,B,C,D and then D-tier filler.
  v_vice_c text := (array['torment','vengeance'])[1 + floor(random() * 2)::int];
  v_virtue_c text := (array['truthfulness','sacrifice'])[1 + floor(random() * 2)::int];
begin
  select count(*) into v_total from players where room_id = p_room_id;
  v_vice := floor(v_total / 2.0);
  v_virtue := v_total - v_vice;

  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array['murder','intoxication','envy', v_vice_c])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array['empathy','justice','certainty', v_virtue_c])[i],
      'virtue_seeker'));
  end loop;

  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action, pending_target)
    values (v_player.id, v_roles[v_i], null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  update rooms set
    status = 'in_game', phase = 'game_overview',
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1
  where id = p_room_id;
end;
$$;

grant execute on function assign_roles_and_start(uuid) to anon, authenticated;

-- --- Ranked queue: replace mode '6v6' with '5v5' ---
create or replace function join_ranked_queue(p_mode text, p_side text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  if p_side not in ('vice', 'virtue') then return; end if;
  if p_mode not in ('3v3', '5v5') then return; end if;
  insert into ranked_queue (user_id, mode, side, name, status, room_code, joined_at)
  values (v_user, p_mode, p_side, coalesce(nullif(btrim(p_name), ''), 'Player'),
          'waiting', null, now())
  on conflict (user_id) do update
    set mode = excluded.mode, side = excluded.side, name = excluded.name,
        status = 'waiting', room_code = null, joined_at = now();
end; $$;
grant execute on function join_ranked_queue(text, text, text) to authenticated;

create or replace function ranked_queue_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    '3v3', jsonb_build_object(
      'vice',   count(*) filter (where mode = '3v3' and side = 'vice'   and status = 'waiting'),
      'virtue', count(*) filter (where mode = '3v3' and side = 'virtue' and status = 'waiting')),
    '5v5', jsonb_build_object(
      'vice',   count(*) filter (where mode = '5v5' and side = 'vice'   and status = 'waiting'),
      'virtue', count(*) filter (where mode = '5v5' and side = 'virtue' and status = 'waiting'))
  ) from ranked_queue;
$$;
grant execute on function ranked_queue_counts() to authenticated;

-- --- Ranked match formation: one random C-tier role per camp ---
create or replace function ranked_form_match(p_mode text, p_n int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_vice int; v_virtue int;
  v_vice_users uuid[]; v_virtue_users uuid[];
  v_vice_roleset text[] := '{}'; v_virtue_roleset text[] := '{}';
  v_vice_roles text[]; v_virtue_roles text[];
  v_code text; v_room_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_i int; v_name text; v_player_id uuid; v_first boolean := true;
  -- One random C-tier role per camp this game (the other tiers are 1 role each),
  -- so a 5-per-side match is S,A,B,C,D and 3-per-side is S,A,B.
  v_vice_c text := (array['torment','vengeance'])[1 + floor(random() * 2)::int];
  v_virtue_c text := (array['truthfulness','sacrifice'])[1 + floor(random() * 2)::int];
begin
  select count(*) filter (where side = 'vice'),
         count(*) filter (where side = 'virtue')
  into v_vice, v_virtue
  from ranked_queue where status = 'waiting' and mode = p_mode;

  if v_vice < p_n or v_virtue < p_n then return null; end if;

  select array_agg(user_id order by random()) into v_vice_users
  from (select user_id from ranked_queue
        where status = 'waiting' and mode = p_mode and side = 'vice'
        order by joined_at limit p_n) q;
  select array_agg(user_id order by random()) into v_virtue_users
  from (select user_id from ranked_queue
        where status = 'waiting' and mode = p_mode and side = 'virtue'
        order by joined_at limit p_n) q;

  for v_i in 1..p_n loop
    v_vice_roleset := array_append(v_vice_roleset, coalesce(
      (array['murder','intoxication','envy', v_vice_c])[v_i], 'vice_worshipper'));
    v_virtue_roleset := array_append(v_virtue_roleset, coalesce(
      (array['empathy','justice','certainty', v_virtue_c])[v_i], 'virtue_seeker'));
  end loop;

  v_vice_roles := assign_camp_roles(v_vice_users, 'vice', v_vice_roleset);
  v_virtue_roles := assign_camp_roles(v_virtue_users, 'virtue', v_virtue_roleset);

  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, eye_uses_left, free_uses_left)
      values (v_code, false, true, 'in_game', 'game_overview', 1, 1)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  for v_i in 1..p_n loop
    select name into v_name from ranked_queue where user_id = v_vice_users[v_i];
    insert into players (room_id, user_id, name, is_host)
    values (v_room_id, v_vice_users[v_i], v_name, v_first)
    returning id into v_player_id;
    insert into player_secrets (player_id, role) values (v_player_id, v_vice_roles[v_i]);
    update players set soul_energy = 100 where id = v_player_id;
    v_first := false;
  end loop;
  for v_i in 1..p_n loop
    select name into v_name from ranked_queue where user_id = v_virtue_users[v_i];
    insert into players (room_id, user_id, name, is_host)
    values (v_room_id, v_virtue_users[v_i], v_name, false)
    returning id into v_player_id;
    insert into player_secrets (player_id, role) values (v_player_id, v_virtue_roles[v_i]);
    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update rooms set role_pool = (
    select jsonb_agg(distinct x) from unnest(v_vice_roleset || v_virtue_roleset) x
  ) where id = v_room_id;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_vice_users) or user_id = any(v_virtue_users);

  return v_code;
end; $$;

-- --- Matchmaker: try 5v5 first, then 3v3 ---
create or replace function ranked_matchmake()
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform pg_advisory_xact_lock(778899);
  v := ranked_form_match('5v5', 5);
  if v is not null then return v; end if;
  return ranked_form_match('3v3', 3);
end; $$;
grant execute on function ranked_matchmake() to authenticated;
