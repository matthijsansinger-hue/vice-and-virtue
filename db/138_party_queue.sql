-- Migration 138 — queueing as a party (parties batch 3)
--
-- A party (migration 137: you + up to 2 friends) now queues for public and
-- ranked matches as ONE unit and always lands in the same game.
--
-- HOW IT QUEUES: only the leader presses Play. join_queue then puts a row in
-- ranked_queue for EVERY member, sharing party_id and the same joined_at, each
-- with that member's own class picks. A member's picks live on their device,
-- so the client keeps them on the server with party_set_prefs (stored on
-- party_members); a member who never synced gets the first class of each camp.
-- Everyone must be on the home screen (presence, migration 136) to be queued.
--
-- HOW IT MATCHES: form_match now places GROUPS (a party, or one solo player)
-- instead of single players, in queue order, and a group is seated whole or
-- not at all:
--   pass 1 — every member gets a class they asked for (Vice pick, else Virtue
--            pick), or the group waits;
--   pass 2 — groups that have waited the 60 s patience (or every group, in a
--            public bot game) take their picks where free, else any free seat.
-- Party members can land on either camp — being in a party doesn't put you on
-- the same side. Public games still fill empty seats with bots after a minute;
-- ranked never does.
--
-- CANCELLING: any member's Cancel (leave_queue) stops the whole party's search,
-- and so does any change to the party (someone leaves, is removed, or joins).
-- Accepting an invite also stops your own solo search. Every stop and every
-- match nudges the members (party-user:<id>), so their screens follow along.
--
-- ACCOUNTS: join_queue now requires a profile — playing needs an account
-- (decided 2026-11-03; until now that was enforced in the client only).
--
-- form_match is no longer callable by clients: only matchmake (which holds the
-- matchmaking lock) runs it, so two direct calls can't form overlapping games.
--
-- Needs 136 + 137.

begin;

alter table ranked_queue add column if not exists party_id uuid;
create index if not exists ranked_queue_party_idx on ranked_queue (party_id);

alter table party_members add column if not exists pref_vice text;
alter table party_members add column if not exists pref_virtue text;

-- ---- a member keeps their class picks on the server -----------------------

create or replace function party_set_prefs(p_pref_vice text, p_pref_virtue text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if vv_class_camp(p_pref_vice) is distinct from 'vice'
     or vv_class_camp(p_pref_virtue) is distinct from 'virtue' then
    return jsonb_build_object('ok', false, 'reason', 'bad_preference');
  end if;
  update party_members
  set pref_vice = p_pref_vice, pref_virtue = p_pref_virtue
  where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function party_set_prefs(text, text) from public;
grant execute on function party_set_prefs(text, text) to authenticated;

-- ---- join / leave -----------------------------------------------------------

create or replace function join_queue(
  p_kind text, p_name text, p_pref_vice text, p_pref_virtue text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_party uuid;
  v_leader uuid;
  v_size int;
  v_busy record;
  v_since timestamptz;
  v_members uuid[];
begin
  if v_user is null or not exists (select 1 from profiles where id = v_user) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_kind is null or p_kind not in ('ranked', 'public') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if vv_class_camp(p_pref_vice) is distinct from 'vice'
     or vv_class_camp(p_pref_virtue) is distinct from 'virtue' then
    return jsonb_build_object('ok', false, 'reason', 'bad_preference');
  end if;

  select m.party_id, p.leader_id into v_party, v_leader
  from party_members m join parties p on p.id = m.party_id
  where m.user_id = v_user;

  -- Solo (no party): as before.
  if v_party is null then
    insert into ranked_queue (user_id, mode, name, status, room_code,
                              pref_vice, pref_virtue, party_id)
    values (v_user, p_kind, coalesce(nullif(btrim(p_name), ''), 'Player'),
            'waiting', null, p_pref_vice, p_pref_virtue, null)
    on conflict (user_id) do update
      set mode = excluded.mode,
          name = excluded.name,
          status = 'waiting',
          room_code = null,
          pref_vice = excluded.pref_vice,
          pref_virtue = excluded.pref_virtue,
          party_id = null,
          joined_at = case when ranked_queue.mode = excluded.mode
                                and ranked_queue.status = 'waiting'
                                and ranked_queue.party_id is null
                           then ranked_queue.joined_at else now() end;
    return jsonb_build_object('ok', true);
  end if;

  -- In a party: the leader queues everyone.
  perform 1 from parties where id = v_party for update;
  select count(*) into v_size from party_members where party_id = v_party;
  if v_size > 1 and v_leader <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'not_leader');
  end if;

  update party_members set pref_vice = p_pref_vice, pref_virtue = p_pref_virtue
  where user_id = v_user;

  select m.user_id, pr.username, vv_presence_status(m.user_id) as status
    into v_busy
  from party_members m join profiles pr on pr.id = m.user_id
  where m.party_id = v_party and m.user_id <> v_user
    and vv_presence_status(m.user_id) <> 'home'
  order by m.joined_at
  limit 1;
  if v_busy.user_id is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_busy.status = 'offline' then 'member_offline' else 'member_busy' end,
      'name', v_busy.username,
      'status', v_busy.status);
  end if;

  -- Same kind, already waiting: keep the party's place in line.
  select min(joined_at) into v_since
  from ranked_queue
  where party_id = v_party and status = 'waiting' and mode = p_kind;
  v_since := coalesce(v_since, now());

  insert into ranked_queue (user_id, mode, name, status, room_code,
                            pref_vice, pref_virtue, party_id, joined_at)
  select m.user_id, p_kind, pr.username, 'waiting', null,
         case when vv_class_camp(m.pref_vice) = 'vice' then m.pref_vice else 'exterminator' end,
         case when vv_class_camp(m.pref_virtue) = 'virtue' then m.pref_virtue else 'protector' end,
         v_party, v_since
  from party_members m join profiles pr on pr.id = m.user_id
  where m.party_id = v_party
  on conflict (user_id) do update
    set mode = excluded.mode,
        name = excluded.name,
        status = 'waiting',
        room_code = null,
        pref_vice = excluded.pref_vice,
        pref_virtue = excluded.pref_virtue,
        party_id = excluded.party_id,
        joined_at = excluded.joined_at;

  v_members := vv_party_member_ids(v_party);
  perform vv_party_nudge(v_members);
  return jsonb_build_object('ok', true, 'party_size', v_size);
end;
$$;
revoke all on function join_queue(text, text, text, text) from public;
grant execute on function join_queue(text, text, text, text) to authenticated;

-- Leaving while your party is still searching stops the search for all of
-- you. After a match, only your own (matched) row goes.
create or replace function leave_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row ranked_queue;
  v_left uuid[];
begin
  delete from ranked_queue where user_id = auth.uid() returning * into v_row;
  if v_row.party_id is not null and v_row.status = 'waiting' then
    with d as (
      delete from ranked_queue
      where party_id = v_row.party_id and status = 'waiting'
      returning user_id
    )
    select coalesce(array_agg(user_id), '{}'::uuid[]) into v_left from d;
    perform vv_party_nudge(vv_party_member_ids(v_row.party_id) || v_left);
  end if;
end;
$$;
revoke all on function leave_queue() from public;
grant execute on function leave_queue() to authenticated;

-- ---- the matchmaker -----------------------------------------------------------

create or replace function form_match(p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c_seats constant int := 4;                 -- per camp; 4v4
  c_patience constant interval := interval '60 seconds';
  c_seat_keys constant text[] := array[
    'vice:exterminator', 'vice:troublemaker', 'vice:obstructor', 'vice:manipulator',
    'virtue:protector', 'virtue:communicator', 'virtue:seeker', 'virtue:catalyst'];
  c_bot_roles constant text[] := array['murder','intoxication','envy','torment',
    'vengeance','vice_worshipper','empathy','justice','certainty','truthfulness',
    'sacrifice','virtue_seeker','generosity'];
  c_bot_names constant text[] := array['Aldric','Brienne','Cedric','Darra',
    'Edmund','Fiora','Godric','Hilde','Isolde','Jorah','Kestrel','Leofric',
    'Maren','Niall','Osric','Perrin','Quenna','Rowan','Seren','Tamsin',
    'Ulric','Vesna','Wystan','Yselde'];
  v_free text[] := c_seat_keys;    -- seats still open
  v_placed uuid[] := '{}';         -- groups seated (party id, or the solo's user id)
  v_assign jsonb := '[]'::jsonb;   -- [{user, camp, class}]  (user null = a bot seat)
  v_try_free text[];
  v_try_assign jsonb;
  v_ok boolean;
  v_seat text;
  v_pass int;
  v_matched uuid[];
  v_code text; v_room_id uuid; v_player_id uuid; v_name text; v_i int;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bot_mode boolean := false;
  v_is_bot boolean;
  v_role text;
  v_pick_s double precision;
  v_lock_s double precision;
  g record;
  m record;
  r record;
begin
  if (select count(*) from ranked_queue
      where mode = p_kind and status = 'waiting') < 2 * c_seats then
    if p_kind = 'public' and exists (
         select 1 from ranked_queue
         where mode = 'public' and status = 'waiting'
           and joined_at <= now() - c_patience) then
      v_bot_mode := true;
    else
      return null;
    end if;
  end if;

  -- Seat whole groups in queue order. Pass 1: picks only. Pass 2: groups that
  -- waited out the patience (all groups in bot mode) may be autofilled.
  for v_pass in 1..2 loop
    for g in
      select coalesce(party_id, user_id) as gid,
             min(joined_at) as since,
             count(*) as n
      from ranked_queue
      where mode = p_kind and status = 'waiting'
      group by coalesce(party_id, user_id)
      order by min(joined_at), coalesce(party_id, user_id)
    loop
      continue when g.gid = any(v_placed);
      continue when g.n > coalesce(array_length(v_free, 1), 0);
      continue when v_pass = 2 and not v_bot_mode and g.since > now() - c_patience;

      v_try_free := v_free;
      v_try_assign := '[]'::jsonb;
      v_ok := true;
      for m in
        select user_id, pref_vice, pref_virtue
        from ranked_queue
        where mode = p_kind and status = 'waiting'
          and coalesce(party_id, user_id) = g.gid
        order by joined_at, user_id
      loop
        if ('vice:' || m.pref_vice) = any(v_try_free) then
          v_seat := 'vice:' || m.pref_vice;
        elsif ('virtue:' || m.pref_virtue) = any(v_try_free) then
          v_seat := 'virtue:' || m.pref_virtue;
        elsif v_pass = 2 then
          v_seat := v_try_free[1];
        else
          v_ok := false;
          exit;
        end if;
        v_try_free := array_remove(v_try_free, v_seat);
        v_try_assign := v_try_assign || jsonb_build_object(
          'user', m.user_id,
          'camp', split_part(v_seat, ':', 1),
          'class', split_part(v_seat, ':', 2));
      end loop;

      if v_ok then
        v_free := v_try_free;
        v_assign := v_assign || v_try_assign;
        v_placed := array_append(v_placed, g.gid);
      end if;
    end loop;
  end loop;

  if coalesce(array_length(v_free, 1), 0) > 0 then
    if not v_bot_mode then
      return null;
    end if;
    foreach v_seat in array v_free loop
      v_assign := v_assign || jsonb_build_object(
        'user', null,
        'camp', split_part(v_seat, ':', 1),
        'class', split_part(v_seat, ':', 2));
    end loop;
  end if;

  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, phase_ends_at,
                         role_assign_mode, eye_uses_left, free_uses_left, server_hosted)
      values (v_code, false, p_kind = 'ranked', 'in_game', 'role_select',
              now() + interval '30 seconds', 'choose', 1, 1, true)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  for r in
    select elem from jsonb_array_elements(v_assign) as t(elem)
    order by (t.elem ->> 'user') is null
  loop
    v_is_bot := (r.elem ->> 'user') is null;

    if v_is_bot then
      select n into v_name from unnest(c_bot_names) n
      where n || ' (bot)' not in (select name from players where room_id = v_room_id)
      order by random() limit 1;
      v_name := coalesce(v_name, 'Shade') || ' (bot)';

      insert into players (room_id, user_id, auth_uid, name, is_host, is_bot)
      values (v_room_id, null, null, v_name, false, true)
      returning id into v_player_id;

      select x into v_role from unnest(c_bot_roles) x
      where vv_role_camp(x) = r.elem ->> 'camp'
        and vv_role_class(x) = r.elem ->> 'class'
      order by random() limit 1;
      v_role := coalesce(v_role, case when r.elem ->> 'camp' = 'virtue'
                                      then 'virtue_seeker' else 'vice_worshipper' end);

      -- Bots decide like people (migration 127): a tentative pick after 2-12s,
      -- locked 2-12s later, played out by vv_tick_room.
      v_pick_s := 2 + random() * 10;
      v_lock_s := v_pick_s + 2 + random() * 10;
      insert into player_secrets (player_id, role, role_choice, assigned_camp,
                                  assigned_class, bot_memory)
      values (v_player_id, null, null, r.elem ->> 'camp', r.elem ->> 'class',
              jsonb_build_object(
                'plan', v_role,
                'pick_at', now() + make_interval(secs => v_pick_s),
                'lock_at', now() + make_interval(secs => v_lock_s)));
    else
      select name into v_name from ranked_queue
      where user_id = (r.elem ->> 'user')::uuid;

      -- user_id = ACCOUNT identity (only with a profile); auth_uid = SESSION
      -- identity (what vv_is_me matches) — see migration 106. No host: the
      -- server runs this room.
      insert into players (room_id, user_id, auth_uid, name, is_host)
      values (v_room_id,
              case when exists (select 1 from profiles pr
                                where pr.id = (r.elem ->> 'user')::uuid)
                   then (r.elem ->> 'user')::uuid end,
              (r.elem ->> 'user')::uuid,
              coalesce(v_name, 'Player'), false)
      returning id into v_player_id;

      insert into player_secrets (player_id, role, assigned_camp, assigned_class)
      values (v_player_id, null, r.elem ->> 'camp', r.elem ->> 'class');
    end if;

    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  select coalesce(array_agg((t.elem ->> 'user')::uuid), '{}'::uuid[]) into v_matched
  from jsonb_array_elements(v_assign) as t(elem)
  where t.elem ->> 'user' is not null;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_matched);

  -- Party members may be on another page: tell their clients to come in.
  perform vv_party_nudge(array(
    select user_id from ranked_queue
    where user_id = any(v_matched) and party_id is not null));

  return v_code;
end;
$$;
revoke all on function form_match(text) from public, anon, authenticated;

-- ---- party changes stop the party's search ------------------------------------

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
  -- The party changed: a search it had running stops (yours included).
  delete from ranked_queue
  where status = 'waiting' and (party_id = v_party or user_id = p_user);

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

  -- A new member wasn't part of the party's search, and your own solo search
  -- ends now that you're in a party: both stop.
  delete from ranked_queue
  where status = 'waiting' and (party_id = v_inv.party_id or user_id = v_me);

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

-- my_party gains `queue`: your own row of the party's search (waiting, or
-- matched into a game that's still running), so every member's screen shows
-- the search and follows the match.
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
        where i.party_id = pt.id and i.created_at > now() - interval '3 minutes'),
      'queue', (
        select jsonb_build_object(
          'kind', q.mode,
          'status', q.status,
          'room_code', q.room_code,
          'since', q.joined_at,
          'age_s', extract(epoch from now() - q.joined_at))
        from ranked_queue q
        where q.user_id = v_me and q.party_id = pt.id
          and (q.status = 'waiting'
               or exists (select 1 from rooms r
                          where r.code = q.room_code and r.status <> 'ended')))
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
