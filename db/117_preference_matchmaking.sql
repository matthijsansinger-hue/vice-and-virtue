-- Migration 117 — preference matchmaking for public AND ranked
--
-- Both queues now work the same way. On pressing Play you pick ONE class you'd
-- like for Vice and ONE for Virtue (you don't know which camp you'll get), and
-- the matchmaker tries to build a lobby where everybody lands on a preference.
--
-- SHAPE: 4v4, eight players, four classes a camp — so every seat is a real
-- class and nothing is dealt a filler role. That's why ranked moved to 4v4, and
-- public uses the same shape.
--
-- AUTOFILL: holding out for a perfect match forever would deadlock a queue
-- where, say, everyone wants Exterminator. After QUEUE_PATIENCE (60s) a player
-- becomes eligible to be placed in ANY free slot. So a lobby forms as soon as
-- eight people are waiting and the leftovers have waited a minute.
--
-- The assignment is greedy per slot (longest-waiting matching player first)
-- rather than a true maximum bipartite matching. Each player has exactly two
-- acceptable slots (one per camp), so greedy does well in practice, and a
-- suboptimal round just means someone gets autofilled a minute later rather
-- than a broken lobby. Worth revisiting only if players report it feels wrong.
--
-- SUPERSEDES the 3v3/5v5 mode queue: ranked_queue.mode now holds the queue KIND
-- ('ranked' | 'public'), and ranked_form_match/ranked_matchmake are replaced by
-- form_match/matchmake. Stale rows from the old modes are cleared.
--
-- find_or_create_public_room (the old "join the fullest open lobby" path) is
-- left in place but is no longer the public route; private code lobbies are
-- unaffected and still use it for rejoin.

begin;

-- Queue kind + the two class preferences.
alter table ranked_queue add column if not exists pref_vice text;
alter table ranked_queue add column if not exists pref_virtue text;
alter table ranked_queue alter column mode set default 'public';

-- Old mode values ('3v3'/'5v5') are meaningless now.
delete from ranked_queue where mode not in ('ranked', 'public');

-- Which camp a class belongs to. Mirrors CLASS_PAIRS in src/lib/roles.ts.
create or replace function vv_class_camp(p_class text)
returns text
language sql
immutable
as $$
  select case p_class
    when 'exterminator' then 'vice'
    when 'troublemaker' then 'vice'
    when 'obstructor' then 'vice'
    when 'manipulator' then 'vice'
    when 'protector' then 'virtue'
    when 'communicator' then 'virtue'
    when 'seeker' then 'virtue'
    when 'catalyst' then 'virtue'
    else null
  end;
$$;

-- Join (or update your spot in) a queue. Re-joining with different preferences
-- keeps your original joined_at, so changing your mind doesn't cost you your
-- place — or your progress toward the autofill grace period.
create or replace function join_queue(
  p_kind text, p_name text, p_pref_vice text, p_pref_virtue text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_kind is null or p_kind not in ('ranked', 'public') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;
  if vv_class_camp(p_pref_vice) is distinct from 'vice'
     or vv_class_camp(p_pref_virtue) is distinct from 'virtue' then
    return jsonb_build_object('ok', false, 'reason', 'bad_preference');
  end if;

  insert into ranked_queue (user_id, mode, name, status, room_code,
                            pref_vice, pref_virtue)
  values (v_user, p_kind, coalesce(nullif(btrim(p_name), ''), 'Player'),
          'waiting', null, p_pref_vice, p_pref_virtue)
  on conflict (user_id) do update
    set mode = excluded.mode,
        name = excluded.name,
        status = 'waiting',
        room_code = null,
        pref_vice = excluded.pref_vice,
        pref_virtue = excluded.pref_virtue,
        -- keep joined_at when already queued for the same kind
        joined_at = case when ranked_queue.mode = excluded.mode
                              and ranked_queue.status = 'waiting'
                         then ranked_queue.joined_at else now() end;

  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function join_queue(text, text, text, text) to authenticated;

create or replace function leave_queue()
returns void
language sql
security definer
set search_path = public
as $$
  delete from ranked_queue where user_id = auth.uid();
$$;
grant execute on function leave_queue() to authenticated;

-- How many are waiting per kind, for the "N searching" line.
create or replace function queue_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ranked', count(*) filter (where mode = 'ranked' and status = 'waiting'),
    'public', count(*) filter (where mode = 'public' and status = 'waiting')
  )
  from ranked_queue;
$$;
grant execute on function queue_counts() to anon, authenticated;

-- Form one lobby of the given kind, or return null if it can't be filled yet.
create or replace function form_match(p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c_seats constant int := 4;                 -- per camp; 4v4
  c_patience constant interval := interval '60 seconds';
  c_vice_classes constant text[] :=
    array['exterminator','troublemaker','obstructor','manipulator'];
  c_virtue_classes constant text[] :=
    array['protector','communicator','seeker','catalyst'];
  v_taken uuid[] := '{}';
  v_pick uuid;
  v_assign jsonb := '[]'::jsonb;   -- [{user, camp, class}]
  v_camp text; v_class text; v_i int;
  v_code text; v_room_id uuid; v_player_id uuid; v_name text;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  r record;
begin
  if (select count(*) from ranked_queue
      where mode = p_kind and status = 'waiting') < 2 * c_seats then
    return null;
  end if;

  -- Pass 1: give people the class they asked for. Longest wait wins a contested
  -- slot, so patience is rewarded rather than arbitrary.
  for v_i in 1..(2 * c_seats) loop
    if v_i <= c_seats then
      v_camp := 'vice';  v_class := c_vice_classes[v_i];
    else
      v_camp := 'virtue'; v_class := c_virtue_classes[v_i - c_seats];
    end if;

    select user_id into v_pick
    from ranked_queue
    where mode = p_kind and status = 'waiting'
      and not (user_id = any(v_taken))
      and (case when v_camp = 'vice' then pref_vice else pref_virtue end) = v_class
    order by joined_at
    limit 1;

    if v_pick is not null then
      v_taken := array_append(v_taken, v_pick);
      v_assign := v_assign || jsonb_build_object(
        'user', v_pick, 'camp', v_camp, 'class', v_class);
    end if;
  end loop;

  -- Pass 2: autofill the leftovers, but only with players who have waited out
  -- the grace period. Anyone who joined seconds ago keeps waiting for a slot
  -- they actually asked for.
  for v_i in 1..(2 * c_seats) loop
    if v_i <= c_seats then
      v_camp := 'vice';  v_class := c_vice_classes[v_i];
    else
      v_camp := 'virtue'; v_class := c_virtue_classes[v_i - c_seats];
    end if;
    if exists (select 1 from jsonb_array_elements(v_assign) as t(elem)
               where t.elem ->> 'camp' = v_camp
                 and t.elem ->> 'class' = v_class) then
      continue;
    end if;

    select user_id into v_pick
    from ranked_queue
    where mode = p_kind and status = 'waiting'
      and not (user_id = any(v_taken))
      and joined_at <= now() - c_patience
    order by joined_at
    limit 1;

    if v_pick is null then
      return null;   -- can't fill this slot yet; try again next poll
    end if;
    v_taken := array_append(v_taken, v_pick);
    v_assign := v_assign || jsonb_build_object(
      'user', v_pick, 'camp', v_camp, 'class', v_class);
  end loop;

  -- Every seat is spoken for: build the room.
  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, phase_ends_at,
                         role_assign_mode, eye_uses_left, free_uses_left)
      values (v_code, false, p_kind = 'ranked', 'in_game', 'role_select',
              now() + interval '30 seconds', 'choose', 1, 1)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  v_i := 0;
  -- Explicit column alias: relying on the implicit name of a set-returning
  -- function's column is the kind of thing that breaks on a version bump.
  for r in select elem from jsonb_array_elements(v_assign) as t(elem) loop
    v_i := v_i + 1;
    select name into v_name from ranked_queue
    where user_id = (r.elem ->> 'user')::uuid;

    -- Two identity columns, and both matter here (migration 106):
    --   user_id  = ACCOUNT identity. Only set when the queuer actually has a
    --              profile — a guest's anonymous uid must NOT go here, or the
    --              whole codebase reads them as a logged-in account and hands
    --              them stats, rewards and the invite/level UI.
    --   auth_uid = SESSION identity, what vv_is_me matches on. Its default is
    --              auth.uid(), which in here is the POLLER who happened to
    --              trigger matchmaking — so it must be set explicitly per seat.
    --              Without this a guest seated by the queue could never pass
    --              vv_is_me and would be unable to act at all.
    insert into players (room_id, user_id, auth_uid, name, is_host)
    values (v_room_id,
            case when exists (select 1 from profiles pr
                              where pr.id = (r.elem ->> 'user')::uuid)
                 then (r.elem ->> 'user')::uuid end,
            (r.elem ->> 'user')::uuid,
            coalesce(v_name, 'Player'), v_i = 1)
    returning id into v_player_id;

    insert into player_secrets (player_id, role, assigned_camp, assigned_class)
    values (v_player_id, null, r.elem ->> 'camp', r.elem ->> 'class');

    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_taken);

  return v_code;
end;
$$;
grant execute on function form_match(text) to authenticated;

-- Client-polled entry point. Advisory-locked so two pollers can't both form a
-- lobby out of the same waiting players (same guard the old ranked_matchmake
-- used, same lock id).
create or replace function matchmake()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  if not pg_try_advisory_xact_lock(778899) then
    return null;
  end if;
  v_code := form_match('ranked');
  if v_code is null then
    v_code := form_match('public');
  end if;
  return v_code;
end;
$$;
grant execute on function matchmake() to authenticated;

commit;
