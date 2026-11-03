-- Migration 137 — parties (parties batch 2)
--
-- A party is you + up to 2 friends (3 players). The leader invites friends
-- who are on the home screen (migration 136 presence); an invite lasts 3
-- minutes. Accepting moves you into that party (out of any other). Anyone can
-- leave; the leader can remove a member or cancel an invite; when the leader
-- leaves, the longest-standing member takes over. A party with nobody left is
-- deleted.
--
-- Taking the party somewhere: when the leader starts a private lobby or joins
-- one by code, party_goto records that lobby's code; each member's client sees
-- it and joins the same lobby. (Queueing as a party is batch 3.)
--
-- Members who closed the app (no presence for 10 minutes) drop out the next
-- time anyone in the party reads it, so parties don't fill with ghosts.
--
-- Live updates: every change sends a payload-free "changed" nudge on each
-- affected user's topic `party-user:<user id>` (same Broadcast pattern as
-- migration 121); clients re-read my_party(). A failed nudge never breaks the
-- write, and clients also re-read on a slow timer.
--
-- All three tables are locked (RLS on, no policies): only these functions
-- touch them.

begin;

create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references auth.users (id) on delete cascade,
  mode text not null default 'public' check (mode in ('public', 'ranked')),
  room_code text,
  room_set_at timestamptz,
  created_at timestamptz not null default now()
);

-- One party per user: user_id is the primary key.
create table if not exists party_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  party_id uuid not null references parties (id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists party_members_party_idx on party_members (party_id);

create table if not exists party_invites (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (party_id, to_user)
);
create index if not exists party_invites_to_idx on party_invites (to_user);

alter table parties enable row level security;
alter table party_members enable row level security;
alter table party_invites enable row level security;

-- ---- internal helpers (not callable by clients) ----------------------------

create or replace function vv_party_nudge(p_users uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v uuid;
begin
  foreach v in array coalesce(p_users, '{}'::uuid[]) loop
    begin
      perform realtime.send('{}'::jsonb, 'changed', 'party-user:' || v::text, false);
    exception when others then
      null; -- clients re-read on a timer anyway
    end;
  end loop;
end;
$$;
revoke all on function vv_party_nudge(uuid[]) from public, anon, authenticated;

create or replace function vv_party_member_ids(p_party uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(user_id), '{}'::uuid[])
  from party_members where party_id = p_party;
$$;
revoke all on function vv_party_member_ids(uuid) from public, anon, authenticated;

-- 'home' | 'lobby' | 'game' | 'offline' (same rule as friends_presence).
create or replace function vv_presence_status(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when last_seen > now() - interval '75 seconds' then location end
     from account_presence where user_id = p_user),
    'offline');
$$;
revoke all on function vv_presence_status(uuid) from public, anon, authenticated;

-- Take a user out of their party. The longest-standing member takes over from
-- a leaving leader; an empty party is deleted (its invites go with it).
create or replace function vv_party_remove(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party uuid;
  v_leader uuid;
  v_next uuid;
begin
  delete from party_members where user_id = p_user returning party_id into v_party;
  if v_party is null then
    return null;
  end if;
  select leader_id into v_leader from parties where id = v_party for update;
  select user_id into v_next
  from party_members where party_id = v_party
  order by joined_at, user_id limit 1;
  if v_next is null then
    delete from parties where id = v_party;
  elsif v_leader = p_user then
    update parties set leader_id = v_next where id = v_party;
  end if;
  perform vv_party_nudge(vv_party_member_ids(v_party) || p_user);
  return v_party;
end;
$$;
revoke all on function vv_party_remove(uuid) from public, anon, authenticated;

-- ---- client RPCs ------------------------------------------------------------

-- Invite a friend who is on the home screen. Creates your party (with you as
-- leader, in `p_mode`) if you aren't in one yet. Only the leader invites.
create or replace function party_invite(p_to uuid, p_mode text default 'public')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_party uuid;
  v_leader uuid;
  v_count int;
begin
  if v_me is null or not exists (select 1 from profiles where id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('vv_party:' || v_me::text));
  if p_to is null or p_to = v_me then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;
  if not exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and ((f.requester_id = v_me and f.addressee_id = p_to)
        or (f.requester_id = p_to and f.addressee_id = v_me))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_friends');
  end if;
  if vv_presence_status(p_to) <> 'home' then
    return jsonb_build_object('ok', false, 'reason', 'not_home');
  end if;
  -- Already partied up with someone else (a party of one doesn't count).
  if exists (
    select 1 from party_members m
    where m.user_id = p_to
      and (select count(*) from party_members m2 where m2.party_id = m.party_id) > 1
      and not exists (select 1 from party_members me
                      where me.user_id = v_me and me.party_id = m.party_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'in_party');
  end if;

  select party_id into v_party from party_members where user_id = v_me;
  if v_party is null then
    insert into parties (leader_id, mode)
    values (v_me, case when p_mode in ('public', 'ranked') then p_mode else 'public' end)
    returning id into v_party;
    insert into party_members (user_id, party_id) values (v_me, v_party);
  end if;

  select leader_id into v_leader from parties where id = v_party for update;
  if v_leader <> v_me then
    return jsonb_build_object('ok', false, 'reason', 'not_leader');
  end if;
  if exists (select 1 from party_members where party_id = v_party and user_id = p_to) then
    return jsonb_build_object('ok', false, 'reason', 'already_member');
  end if;
  select (select count(*) from party_members where party_id = v_party)
       + (select count(*) from party_invites
          where party_id = v_party and to_user <> p_to
            and created_at > now() - interval '3 minutes')
    into v_count;
  if v_count >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  insert into party_invites (party_id, from_user, to_user)
  values (v_party, v_me, p_to)
  on conflict (party_id, to_user) do update
    set created_at = now(), from_user = excluded.from_user;

  perform vv_party_nudge(array[p_to, v_me]);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function party_invite(uuid, text) from public;
grant execute on function party_invite(uuid, text) to authenticated;

-- Accept or decline an invite sent to you.
create or replace function party_respond(p_invite uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_inv party_invites;
  v_count int;
  v_others uuid[];
begin
  if v_me is null or not exists (select 1 from profiles where id = v_me) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('vv_party:' || v_me::text));
  select * into v_inv from party_invites where id = p_invite and to_user = v_me;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;

  if not coalesce(p_accept, false) then
    delete from party_invites where id = p_invite;
    perform vv_party_nudge(vv_party_member_ids(v_inv.party_id) || v_me);
    return jsonb_build_object('ok', true);
  end if;

  if v_inv.created_at <= now() - interval '3 minutes' then
    delete from party_invites where id = p_invite;
    perform vv_party_nudge(array[v_me, v_inv.from_user]);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  perform 1 from parties where id = v_inv.party_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if exists (select 1 from party_members
             where user_id = v_me and party_id = v_inv.party_id) then
    delete from party_invites where id = p_invite;
    return jsonb_build_object('ok', true);
  end if;
  select count(*) into v_count from party_members where party_id = v_inv.party_id;
  if v_count >= 3 then
    delete from party_invites where id = p_invite;
    perform vv_party_nudge(vv_party_member_ids(v_inv.party_id) || v_me);
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  perform vv_party_remove(v_me); -- out of any party you were in
  insert into party_members (user_id, party_id) values (v_me, v_inv.party_id);

  -- One party at a time: every other invite to you lapses.
  with d as (
    delete from party_invites where to_user = v_me returning from_user
  )
  select coalesce(array_agg(distinct from_user), '{}'::uuid[]) into v_others from d;

  perform vv_party_nudge(vv_party_member_ids(v_inv.party_id) || v_others);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function party_respond(uuid, boolean) from public;
grant execute on function party_respond(uuid, boolean) to authenticated;

create or replace function party_leave()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('vv_party:' || v_me::text));
  perform vv_party_remove(v_me);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function party_leave() from public;
grant execute on function party_leave() to authenticated;

-- Leader only: remove a member, or cancel a pending invite to that user.
create or replace function party_kick(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_party uuid;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext('vv_party:' || v_me::text));
  select m.party_id into v_party
  from party_members m join parties p on p.id = m.party_id
  where m.user_id = v_me and p.leader_id = v_me;
  if v_party is null then
    return jsonb_build_object('ok', false, 'reason', 'not_leader');
  end if;
  if p_user is null or p_user = v_me then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;

  delete from party_invites where party_id = v_party and to_user = p_user;
  if exists (select 1 from party_members where user_id = p_user and party_id = v_party) then
    perform vv_party_remove(p_user);
  else
    perform vv_party_nudge(vv_party_member_ids(v_party) || p_user);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function party_kick(uuid) from public;
grant execute on function party_kick(uuid) to authenticated;

-- Leader only: the queue mode the party will play (shown to members).
create or replace function party_set_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_party uuid;
begin
  if p_mode is null or p_mode not in ('public', 'ranked') then
    return jsonb_build_object('ok', false, 'reason', 'bad_mode');
  end if;
  update parties set mode = p_mode
  where leader_id = v_me
    and id = (select party_id from party_members where user_id = v_me)
  returning id into v_party;
  if v_party is null then
    return jsonb_build_object('ok', false, 'reason', 'not_leader');
  end if;
  perform vv_party_nudge(vv_party_member_ids(v_party));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function party_set_mode(text) from public;
grant execute on function party_set_mode(text) to authenticated;

-- Leader only: take the party to an open lobby (the leader is already in it).
create or replace function party_goto(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_party uuid;
begin
  if not exists (select 1 from rooms where code = v_code and status = 'lobby') then
    return jsonb_build_object('ok', false, 'reason', 'no_lobby');
  end if;
  update parties set room_code = v_code, room_set_at = now()
  where leader_id = v_me
    and id = (select party_id from party_members where user_id = v_me)
  returning id into v_party;
  if v_party is null then
    return jsonb_build_object('ok', false, 'reason', 'not_leader');
  end if;
  perform vv_party_nudge(vv_party_member_ids(v_party));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function party_goto(text) from public;
grant execute on function party_goto(text) to authenticated;

-- Your party (members with character, level xp and presence; invites still
-- pending) and the invites waiting for you. Drops members who've been gone 10
-- minutes, so it isn't marked stable.
create or replace function my_party()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_party uuid;
  v_stale uuid;
  v_result jsonb;
  v_invites jsonb;
begin
  if v_me is null then
    return jsonb_build_object('party', null, 'invites', '[]'::jsonb);
  end if;

  select party_id into v_party from party_members where user_id = v_me;
  if v_party is not null then
    for v_stale in
      select m.user_id
      from party_members m
      left join account_presence p on p.user_id = m.user_id
      where m.party_id = v_party and m.user_id <> v_me
        and coalesce(p.last_seen, m.joined_at) < now() - interval '10 minutes'
    loop
      perform vv_party_remove(v_stale);
    end loop;

    select jsonb_build_object(
      'id', pt.id,
      'leader_id', pt.leader_id,
      'mode', pt.mode,
      'room_code', pt.room_code,
      'room_set_at', pt.room_set_at,
      -- seconds since the leader picked the lobby, by the server's clock (a
      -- follower's phone clock may be off)
      'room_age_s', extract(epoch from now() - pt.room_set_at),
      'members', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', m.user_id,
          'username', pr.username,
          'appearance', pr.appearance,
          'xp', coalesce(e.xp, 0),
          'joined_at', m.joined_at,
          'status', vv_presence_status(m.user_id)
        ) order by m.joined_at, m.user_id), '[]'::jsonb)
        from party_members m
        join profiles pr on pr.id = m.user_id
        left join account_economy e on e.user_id = m.user_id
        where m.party_id = pt.id),
      'invited', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', i.to_user,
          'username', pr.username,
          'appearance', pr.appearance,
          'created_at', i.created_at
        ) order by i.created_at), '[]'::jsonb)
        from party_invites i
        join profiles pr on pr.id = i.to_user
        where i.party_id = pt.id and i.created_at > now() - interval '3 minutes')
    ) into v_result
    from parties pt where pt.id = v_party;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'from_user', i.from_user,
    'from_username', pr.username,
    'from_appearance', pr.appearance,
    'party_size', (select count(*) from party_members m where m.party_id = i.party_id),
    'created_at', i.created_at
  ) order by i.created_at desc), '[]'::jsonb)
  into v_invites
  from party_invites i
  join profiles pr on pr.id = i.from_user
  where i.to_user = v_me
    and i.created_at > now() - interval '3 minutes'
    and (v_party is null or i.party_id <> v_party);

  return jsonb_build_object('party', v_result, 'invites', v_invites);
end;
$$;
revoke all on function my_party() from public;
grant execute on function my_party() to authenticated;

commit;
