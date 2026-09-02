-- Migration 112 — Host/caller gate repair (URGENT: the gates are bypassable live)
--
-- Two independent holes, both CONFIRMED against the live database on 2026-09-02
-- using nothing but the publishable key that ships inside the web client.
--
-- ────────────────────────────────────────────────────────────────────────────
-- (1) EVERY *_impl IS DIRECTLY CALLABLE, so 097 + 098's gates do nothing.
--
--     097/098 renamed each real body to <name>_impl, put a thin gate in front
--     under the original name, and then wrote:
--
--         revoke execute on function X_impl(...) from anon, authenticated;
--
--     That does NOT lock the function. Postgres grants EXECUTE to PUBLIC by
--     default on every new function, and `anon` is a member of PUBLIC, so
--     revoking the *explicit* grant leaves the *default* one in place. The gate
--     is skipped by appending "_impl" to the RPC name:
--
--         POST /rest/v1/rpc/resolve_role_action      -> {"message":"not host"}
--         POST /rest/v1/rpc/resolve_role_action_impl -> 204 No Content (ran!)
--
--     Verified live, anonymously: get_my_secrets_impl returned HTTP 200 with the
--     secrets payload — that one reads ANY player's role, and player ids are
--     public in the open-RLS players table, so the entire hidden-role model is
--     readable by anyone in the room. queue_action_impl, every resolve_*_impl,
--     clear_room_votes_impl, assign_roles_and_start_impl and grant_achievements
--     all executed as anon too.
--
--     Migration 105 got this right — `revoke all ... from public, anon,
--     authenticated` — and credit_steam_purchase is correctly denied today.
--     That positive/negative contrast is what pins the cause to the missing
--     `public`, rather than to anything about SECURITY DEFINER or PostgREST.
--
-- (2) MIGRATION 111 DELETED THREE GATES.
--
--     111 shipped `create or replace function <name>(...)` with FULL bodies for
--     enter_store (097), buy_potion (098) and my_potions (098), overwriting the
--     wrappers. Verified live: all three run their body for an anonymous caller
--     where their siblings return 'not host' / 'forbidden'. buy_potion is the
--     costly one — without vv_is_me, a client can spend ANOTHER player's Soul
--     Energy and arm kill potions in their name.
--
--     This is exactly the failure mode db/schema.sql invites: its mirror
--     predates 097, so copying a body out of it silently drops a gate.
--     schema.sql is reconciled alongside this migration, and 111 is fixed in
--     place so re-running it is safe.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ── (2) Restore the three clobbered wrappers ────────────────────────────────
-- 111's bodies are the CURRENT, WANTED logic (the Communication potion etc.),
-- so rather than retyping them (buy_potion alone is ~200 lines) we drop the
-- superseded _impl and rename 111's body into its place.
--
-- Guarded by `prosrc not like '%<name>_impl%'`: it only fires where the
-- un-suffixed function still holds a body. If 111 was never applied, or this
-- migration is run twice, the wrapper is already in place and nothing moves —
-- which matters, because renaming a WRAPPER to _impl would leave it calling
-- itself forever.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('enter_store', 'uuid, timestamptz'),
      ('buy_potion',  'uuid, text, uuid'),
      ('my_potions',  'uuid')
    ) as t(fname, args)
  loop
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = r.fname
        -- Whitespace-insensitive: identity_arguments gives "uuid, timestamptz"
        -- but regprocedure renders "uuid,timestamptz". Normalise both sides so
        -- the guard can't silently fail to match and skip the repair.
        and replace(pg_get_function_identity_arguments(p.oid), ' ', '')
            = replace(r.args, ' ', '')
        and p.prosrc not like '%' || r.fname || '_impl%'
    ) then
      execute format('drop function if exists %I(%s)', r.fname || '_impl', r.args);
      execute format('alter function %I(%s) rename to %I', r.fname, r.args, r.fname || '_impl');
      raise notice 'moved % body into %_impl', r.fname, r.fname;
    else
      raise notice '% already wrapped — left alone', r.fname;
    end if;
  end loop;
end $$;

-- Recreate the three wrappers verbatim from 097/098. `create or replace` so
-- this is a no-op when the wrapper survived.
create or replace function enter_store(p_room_id uuid, p_ends_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_host(p_room_id) then raise exception 'not host' using errcode = '42501'; end if;
  perform enter_store_impl(p_room_id, p_ends_at);
end; $$;
grant execute on function enter_store(uuid, timestamptz) to anon, authenticated;

create or replace function buy_potion(p_player_id uuid, p_potion text, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return buy_potion_impl(p_player_id, p_potion, p_target);
end; $$;
grant execute on function buy_potion(uuid, text, uuid) to anon, authenticated;

create or replace function my_potions(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_potions_impl(p_player_id);
end; $$;
grant execute on function my_potions(uuid) to anon, authenticated;

-- ── (1) Lock every *_impl away from PUBLIC ──────────────────────────────────
-- Set-based rather than 46 hand-written signatures: it uses each function's
-- real signature (regprocedure) so it can't typo one, won't roll the whole
-- migration back over a function that isn't there, and automatically covers any
-- *_impl added later and locked the same wrong way. The wrappers keep working —
-- they're SECURITY DEFINER and run as the owner, who keeps EXECUTE.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public'
      and (p.proname like '%\_impl' or p.proname = 'grant_achievements')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'locked % internal functions away from PUBLIC', n;
end $$;

commit;

-- ── Verify (run separately; both queries should return zero rows) ────────────
--
-- a) Anything internal still executable by anon or PUBLIC:
--   select p.oid::regprocedure as still_open
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and (p.proname like '%\_impl' or p.proname = 'grant_achievements')
--     and (has_function_privilege('anon', p.oid, 'execute')
--       or has_function_privilege('public', p.oid, 'execute'));
--
-- b) Any wrapper that lost its gate (body no longer delegates to its _impl):
--   select p.proname as ungated
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and exists (select 1 from pg_proc i join pg_namespace ni on ni.oid = i.pronamespace
--                 where ni.nspname = 'public' and i.proname = p.proname || '_impl')
--     and p.prosrc not like '%' || p.proname || '_impl%';
--
-- Then re-run the black-box check from any browser console — every one of these
-- should now be a 401/permission error rather than 200/204:
--   fetch(URL+'/rest/v1/rpc/get_my_secrets_impl', {method:'POST',
--     headers:{apikey:KEY,'content-type':'application/json'},
--     body:'{"p_player_id":"00000000-0000-0000-0000-000000000000"}'}).then(r=>r.status)
