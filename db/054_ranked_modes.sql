-- ============================================
-- Ranked gamemodes + loadout-honoring assignment (migration 054) — batch 3b-ii.
-- ============================================
-- Two ranked modes: '3v3' (6 players) and '6v6' (12). Players pick a mode + a
-- side; matchmaking is per-mode. Role-within-camp is no longer random — it
-- comes from each player's saved loadout (account_role_config): tier slots are
-- handed out at random (you don't choose your tier), but within your tier you
-- get your preferred role when it's available.
--
-- Self-contained: drops + recreates the (still-new, data-free) ranked_queue,
-- so it runs whether or not migration 053 was applied. Supersedes 053's queue.

drop table if exists ranked_queue cascade;

create table ranked_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default '3v3',         -- '3v3' (6 players) | '6v6' (12)
  side text not null,                       -- 'vice' | 'virtue'
  name text not null,
  status text not null default 'waiting',   -- 'waiting' | 'matched'
  room_code text,
  joined_at timestamptz not null default now()
);

alter table ranked_queue enable row level security;

-- Read ONLY your own row (so nobody can see who queued which side).
create policy "read own queue row"
  on ranked_queue for select using (auth.uid() = user_id);

create or replace function join_ranked_queue(p_mode text, p_side text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  if p_side not in ('vice', 'virtue') then return; end if;
  if p_mode not in ('3v3', '6v6') then return; end if;
  insert into ranked_queue (user_id, mode, side, name, status, room_code, joined_at)
  values (v_user, p_mode, p_side, coalesce(nullif(btrim(p_name), ''), 'Player'),
          'waiting', null, now())
  on conflict (user_id) do update
    set mode = excluded.mode, side = excluded.side, name = excluded.name,
        status = 'waiting', room_code = null, joined_at = now();
end; $$;
grant execute on function join_ranked_queue(text, text, text) to authenticated;

create or replace function leave_ranked_queue()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from ranked_queue where user_id = auth.uid();
end; $$;
grant execute on function leave_ranked_queue() to authenticated;

create or replace function ranked_queue_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    '3v3', jsonb_build_object(
      'vice',   count(*) filter (where mode = '3v3' and side = 'vice'   and status = 'waiting'),
      'virtue', count(*) filter (where mode = '3v3' and side = 'virtue' and status = 'waiting')),
    '6v6', jsonb_build_object(
      'vice',   count(*) filter (where mode = '6v6' and side = 'vice'   and status = 'waiting'),
      'virtue', count(*) filter (where mode = '6v6' and side = 'virtue' and status = 'waiting'))
  ) from ranked_queue;
$$;
grant execute on function ranked_queue_counts() to authenticated;

-- Role -> role tier (S/A/B/C/D), mirroring roles.ts.
create or replace function vv_role_tier(p_role text)
returns text language sql immutable as $$
  select case p_role
    when 'murder' then 'S'        when 'empathy' then 'S'
    when 'intoxication' then 'A'  when 'justice' then 'A'
    when 'envy' then 'B'          when 'certainty' then 'B'
    when 'torment' then 'C'       when 'vengeance' then 'C'
    when 'truthfulness' then 'C'  when 'sacrifice' then 'C'
    when 'vice_worshipper' then 'D' when 'virtue_seeker' then 'D'
    else null end;
$$;

-- Assign the camp role multiset to its players (aligned to p_users), honoring
-- each player's loadout: greedy over players (caller shuffles, so tier is
-- random), each takes the available role they prefer (highest tier first),
-- else a random remaining role.
create or replace function assign_camp_roles(p_users uuid[], p_camp text, p_roles text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_n int := coalesce(array_length(p_users, 1), 0);
  v_remaining text[] := p_roles;
  v_assign text[] := '{}';
  v_i int; v_j int; v_len int;
  v_loadout jsonb;
  v_best int; v_best_rank int; v_cand_rank int;
  v_role text; v_tier text;
begin
  for v_i in 1..v_n loop
    select config -> p_camp into v_loadout
    from account_role_config where user_id = p_users[v_i];

    v_len := array_length(v_remaining, 1);
    v_best := null; v_best_rank := 99;
    for v_j in 1..v_len loop
      v_role := v_remaining[v_j];
      v_tier := vv_role_tier(v_role);
      if v_loadout is not null and (v_loadout ->> v_tier) = v_role then
        v_cand_rank := case v_tier
          when 'S' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end;
        if v_cand_rank < v_best_rank then
          v_best := v_j; v_best_rank := v_cand_rank;
        end if;
      end if;
    end loop;

    if v_best is null then
      v_best := 1 + floor(random() * v_len)::int;
    end if;

    v_assign := array_append(v_assign, v_remaining[v_best]);
    v_remaining := v_remaining[1:v_best - 1] || v_remaining[v_best + 1:v_len];
  end loop;
  return v_assign;
end; $$;

-- Form a match for a mode of p_n per side, if both sides have enough waiting.
-- Assumes the caller holds the advisory lock. Returns the room code or null.
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
      (array['murder','intoxication','envy','torment','vengeance'])[v_i], 'vice_worshipper'));
    v_virtue_roleset := array_append(v_virtue_roleset, coalesce(
      (array['empathy','justice','certainty','truthfulness','sacrifice'])[v_i], 'virtue_seeker'));
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

-- Try to form a match (6v6 first, then 3v3); advisory-locked so it runs once
-- at a time. Returns the new room code or null.
create or replace function ranked_matchmake()
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  perform pg_advisory_xact_lock(778899);
  v := ranked_form_match('6v6', 6);
  if v is not null then return v; end if;
  return ranked_form_match('3v3', 3);
end; $$;
grant execute on function ranked_matchmake() to authenticated;
