-- ============================================
-- Ranked matchmaking queue (migration 053) — batch 3b of the meta layer.
-- ============================================
-- A two-sided queue: players join as Vice or Virtue, and matchmaking forms a
-- balanced game (N Vice + N Virtue) the moment both sides have enough waiting.
-- There's no game server, so queued clients poll ranked_matchmake(); a Postgres
-- advisory lock serializes them so a match forms exactly once. On a match the
-- RPC creates a ranked room, seats everyone, assigns roles HONORING their
-- chosen side (role-within-camp is random for now; loadout-honoring comes next),
-- and auto-starts into game_overview.
--
-- A player's chosen side is NEVER written to the public players row (that would
-- leak camps) — it's consumed at match time to pick a role of that camp, which
-- lands (secret) in player_secrets.role like any other game.

drop table if exists ranked_queue cascade;

create table ranked_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  side text not null,                       -- 'vice' | 'virtue' (preferred side)
  name text not null,                       -- display name to seat with
  status text not null default 'waiting',   -- 'waiting' | 'matched'
  room_code text,                           -- set when matched
  joined_at timestamptz not null default now()
);

alter table ranked_queue enable row level security;

-- Read ONLY your own row (so nobody can see who queued which side — that would
-- leak camps). Writes go through the SECURITY DEFINER RPCs below. Aggregate
-- waiting counts come from ranked_queue_counts(), which exposes no identities.
create policy "read own queue row"
  on ranked_queue for select using (auth.uid() = user_id);

-- Join (or re-join) the ranked queue on a chosen side.
create or replace function join_ranked_queue(p_side text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  if p_side not in ('vice', 'virtue') then return; end if;
  insert into ranked_queue (user_id, side, name, status, room_code, joined_at)
  values (v_user, p_side, coalesce(nullif(btrim(p_name), ''), 'Player'),
          'waiting', null, now())
  on conflict (user_id) do update
    set side = excluded.side, name = excluded.name,
        status = 'waiting', room_code = null, joined_at = now();
end;
$$;

grant execute on function join_ranked_queue(text, text) to authenticated;

create or replace function leave_ranked_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from ranked_queue where user_id = auth.uid();
end;
$$;

grant execute on function leave_ranked_queue() to authenticated;

-- Aggregate waiting counts per side (no identities — safe to show everyone).
create or replace function ranked_queue_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'vice', count(*) filter (where side = 'vice' and status = 'waiting'),
    'virtue', count(*) filter (where side = 'virtue' and status = 'waiting')
  )
  from ranked_queue;
$$;

grant execute on function ranked_queue_counts() to authenticated;

-- Try to form a match. Returns the new room code if one formed, else null.
-- Called by queued clients on a poll; the advisory lock means only one runs
-- the match-forming at a time, so 2N waiters are consumed exactly once.
create or replace function ranked_matchmake()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c_min constant int := 3;     -- per side -> 6-player minimum game
  c_max constant int := 10;    -- per side -> 20-player cap
  v_vice int;
  v_virtue int;
  v_n int;
  v_vice_users uuid[];
  v_virtue_users uuid[];
  v_vice_roles text[] := '{}';
  v_virtue_roles text[] := '{}';
  v_code text;
  v_room_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- mirrors CODE_ALPHABET in room.ts
  v_i int;
  v_name text;
  v_player_id uuid;
  v_first boolean := true;
begin
  -- Serialize matchmaking so concurrent callers can't grab the same waiters.
  perform pg_advisory_xact_lock(778899);

  select
    count(*) filter (where side = 'vice'),
    count(*) filter (where side = 'virtue')
  into v_vice, v_virtue
  from ranked_queue where status = 'waiting';

  v_n := least(v_vice, v_virtue, c_max);
  if v_n < c_min then
    return null;
  end if;

  select array_agg(user_id order by joined_at) into v_vice_users
  from (
    select user_id, joined_at from ranked_queue
    where status = 'waiting' and side = 'vice'
    order by joined_at limit v_n
  ) q;
  select array_agg(user_id order by joined_at) into v_virtue_users
  from (
    select user_id, joined_at from ranked_queue
    where status = 'waiting' and side = 'virtue'
    order by joined_at limit v_n
  ) q;

  -- Create the ranked room (retry on code collision).
  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code ||
        substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase,
                         eye_uses_left, free_uses_left)
      values (v_code, false, true, 'in_game', 'game_overview', 1, 1)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
      -- code taken, generate another
    end;
  end loop;

  -- Camp role sets by count N, mirroring assign_roles_and_start, then shuffle
  -- within camp (which specific role you get is random for now).
  for v_i in 1..v_n loop
    v_vice_roles := array_append(v_vice_roles, coalesce(
      (array['murder','intoxication','envy','torment','vengeance'])[v_i],
      'vice_worshipper'));
    v_virtue_roles := array_append(v_virtue_roles, coalesce(
      (array['empathy','justice','certainty','truthfulness','sacrifice'])[v_i],
      'virtue_seeker'));
  end loop;
  select array_agg(x order by random()) into v_vice_roles from unnest(v_vice_roles) x;
  select array_agg(x order by random()) into v_virtue_roles from unnest(v_virtue_roles) x;

  -- Seat Vice players + assign vice roles (first seated is host).
  for v_i in 1..v_n loop
    select name into v_name from ranked_queue where user_id = v_vice_users[v_i];
    insert into players (room_id, user_id, name, is_host)
    values (v_room_id, v_vice_users[v_i], v_name, v_first)
    returning id into v_player_id;
    insert into player_secrets (player_id, role) values (v_player_id, v_vice_roles[v_i]);
    update players set soul_energy = 100 where id = v_player_id;
    v_first := false;
  end loop;

  -- Seat Virtue players + assign virtue roles.
  for v_i in 1..v_n loop
    select name into v_name from ranked_queue where user_id = v_virtue_users[v_i];
    insert into players (room_id, user_id, name, is_host)
    values (v_room_id, v_virtue_users[v_i], v_name, false)
    returning id into v_player_id;
    insert into player_secrets (player_id, role) values (v_player_id, v_virtue_roles[v_i]);
    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update rooms set role_pool = (
    select jsonb_agg(distinct x) from unnest(v_vice_roles || v_virtue_roles) x
  ) where id = v_room_id;

  -- Mark the matched players so they navigate into the room (and drop out of
  -- the waiting counts).
  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_vice_users) or user_id = any(v_virtue_users);

  return v_code;
end;
$$;

grant execute on function ranked_matchmake() to authenticated;
