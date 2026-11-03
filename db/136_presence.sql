-- Migration 136 — friend presence (on the home screen / in a lobby / in a game)
--
-- Party play (next batches) needs to know which friends you can invite: only
-- friends who are online on the home screen. Each signed-in client reports
-- where it is every 30 s (presence_ping); a friend whose last report is older
-- than 75 s reads as offline. Reads go through friends_presence(), which only
-- ever returns your ACCEPTED friends — nobody else's whereabouts.
--
-- Guest sessions are ignored (no profile = no friends to show it to), so the
-- table only holds accounts.

begin;

create table if not exists account_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  location text not null default 'home'
    check (location in ('home', 'lobby', 'game')),
  last_seen timestamptz not null default now()
);

-- Locked: no client policies. Written by presence_ping, read by friends_presence.
alter table account_presence enable row level security;

create or replace function presence_ping(p_location text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or p_location is null
     or p_location not in ('home', 'lobby', 'game') then
    return;
  end if;
  if not exists (select 1 from profiles where id = v_user) then
    return;
  end if;
  insert into account_presence (user_id, location, last_seen)
  values (v_user, p_location, now())
  on conflict (user_id) do update
    set location = excluded.location,
        last_seen = excluded.last_seen;
end;
$$;
revoke all on function presence_ping(text) from public;
grant execute on function presence_ping(text) to authenticated;

-- Each accepted friend's status: 'home' | 'lobby' | 'game' | 'offline'.
create or replace function friends_presence()
returns table (user_id uuid, status text)
language sql
stable
security definer
set search_path = public
as $$
  with fr as (
    select case when f.requester_id = auth.uid() then f.addressee_id
                else f.requester_id end as uid
    from friendships f
    where f.status = 'accepted'
      and auth.uid() in (f.requester_id, f.addressee_id)
  )
  select fr.uid,
         case when p.last_seen > now() - interval '75 seconds'
              then p.location else 'offline' end
  from fr
  left join account_presence p on p.user_id = fr.uid;
$$;
revoke all on function friends_presence() from public;
grant execute on function friends_presence() to authenticated;

commit;
