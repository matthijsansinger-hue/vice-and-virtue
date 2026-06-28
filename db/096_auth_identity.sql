-- Migration 096 — Auth identity foundation (untrusted-client / Steam hardening, phase 1)
--
-- Anonymous auth (enable it first: Supabase dashboard → Authentication →
-- Sign In / Providers → "Anonymous sign-ins") gives EVERY session — guests
-- included — an auth.uid(). This migration stamps that identity onto player rows
-- and adds the predicates the later phases use to enforce "you can only act as
-- yourself / only the host drives the game".
--
-- NON-BREAKING: the helpers below are not referenced by anything yet, and the
-- column default only fills user_id when an INSERT omits it. Enforcement (binding
-- the gameplay RPCs + locking the open table policies + the grant_match_rewards/
-- queue_action rewrites) lands in the follow-up migrations 097+.

-- Auto-stamp the caller's identity (account OR anonymous) on new player rows.
-- The client now passes it explicitly too; this is the safety net. Works inside
-- SECURITY DEFINER inserts as well, since auth.uid() reads the CALLER's JWT.
alter table players alter column user_id set default auth.uid();

-- "Is the caller this player?" — the passed player row belongs to auth.uid().
create or replace function vv_is_me(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from players
    where id = p_player_id
      and user_id is not null
      and user_id = auth.uid()
  );
$$;
grant execute on function vv_is_me(uuid) to anon, authenticated;

-- "Is the caller the host of this room?"
create or replace function vv_is_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from players
    where room_id = p_room_id
      and is_host
      and user_id is not null
      and user_id = auth.uid()
  );
$$;
grant execute on function vv_is_host(uuid) to anon, authenticated;
