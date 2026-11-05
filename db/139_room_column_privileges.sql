-- 139: clients may read only the PUBLIC columns of rooms (column privileges),
-- and may not delete rooms at all.
--
-- The "open access to rooms" policy (for all using (true)) plus Supabase's
-- default table-wide grants let the anon key SELECT every column, so during a
-- game anyone could read the secret ones straight off the REST API, e.g.
--   GET /rest/v1/rooms?select=code,kill_log,envy_swap_a,bombs&status=eq.in_game
-- Migration 121 took rooms out of the realtime publication; this closes the
-- REST (and GraphQL) read too.
--
-- RLS decides which ROWS a role sees; column privileges decide which COLUMNS.
-- The policy stays (every row stays visible: the lobby and room page need
-- that). The table-wide SELECT grant is replaced by a per-column one. A request
-- that names a hidden column, or uses select=*, now fails with 42501
-- "permission denied for table rooms" instead of returning it.
--
-- Hidden from anon/authenticated (secret during play, or server bookkeeping
-- no client reads):
--   envy_swap_a, envy_swap_b, torment_target, pending_murder_death,
--   recent_successor_id, vengeance_imprisoners, pride_target, love_tiebreak,
--   bombs, bombs_planted, kill_log, minigame_awarded_day, bots_acted_key,
--   server_phase_key
-- Clients get what they're allowed to know of these through the existing
-- SECURITY DEFINER RPCs (get_my_secrets, get_display_names, get_kill_log once
-- the game has ended, spectator_secrets for the dead).
--
-- DELETE: the same open policy let ANY client delete ANY room, cascading to its
-- players and every chat row (vv_guard_room_writes only guards UPDATE), e.g.
--   DELETE /rest/v1/rooms?status=eq.in_game
-- would have ended every live game. No client deletes rooms: lobby expiry
-- (expire_stale_lobbies), the abandoned-room sweep in vv_tick_all_rooms and
-- the nightly cleanup_old_rooms are the only deletes, and all are SECURITY
-- DEFINER. So DELETE is simply revoked
-- from anon/authenticated; those functions are unaffected.
--
-- Unchanged:
-- * INSERT / UPDATE grants. Host writes from game.ts / room.ts keep working
--   (still gated by vv_guard_room_writes): their WHERE uses id (public), and
--   PostgREST sends `RETURNING 1` for a write without ?select. createRoom and
--   joinRoom used select() = * and now ask for PUBLIC_ROOM_COLS (src/lib/room.ts).
-- * SECURITY DEFINER functions run as the owner: every resolver, vv_tick_room,
--   run_bots, get_kill_log, court_state, the matchmakers. No invoker-rights
--   function, policy or view reads rooms (checked against db/ for this
--   migration; query 3 below re-checks the live database).
-- * service_role (Edge Functions) and pg_cron (postgres) keep full access.
--
-- DEPLOY ORDER: push the client change first and let Vercel finish deploying,
-- THEN run this. The old client's createRoom/joinRoom select=* fails once this
-- is live (room create/join would break until the deploy lands); the new
-- client works with or without this migration.
--
-- ⚠️ A NEW rooms column is unreadable by clients until it is granted. If a
-- migration adds a column the client reads (e.g. via PUBLIC_ROOM_COLS), add in
-- that same migration:
--     grant select (<column>) on rooms to anon, authenticated;
-- Forgetting it doesn't leak anything, but a PUBLIC_ROOM_COLS select naming an
-- ungranted column fails as a whole, and the room page won't load.
-- Also add the column to the list below: re-running this file resets client
-- reads to exactly this list (the REVOKE drops every column grant too).
--
-- court_step / court_defendant_id (migration 136, the Trial) are public
-- (everyone sees the trial step and the defendant) and are granted here if
-- they exist. If 136 is applied AFTER this file, re-run this file or run:
--     grant select (court_step, court_defendant_id) on rooms to anon, authenticated;
--
-- Safe to re-run.

begin;

-- Drops the table-wide SELECT and, per Postgres, every column-level SELECT grant
-- on rooms for these roles, so the grant below is the whole truth.
revoke select on rooms from public, anon, authenticated;

-- Clients never delete rooms (see the header); only owner-run functions do.
revoke delete on rooms from public, anon, authenticated;

do $$
declare
  v_public text[] := array[
    'id', 'code', 'status', 'is_public', 'is_ranked',
    'phase', 'phase_ends_at', 'phase_started_at', 'day',
    'outreach_enabled', 'last_imprisoned_player', 'vote_reveal',
    'revote_candidates', 'last_events',
    'group_action_result', 'group_action_freed_id',
    'eye_revealed', 'eye_uses_left', 'free_uses_left',
    'role_pool', 'role_assign_mode', 'role_config',
    'next_room_code', 'minigame_clue',
    'winner', 'anomaly_win',
    'server_hosted', 'server_substate',
    'court_step', 'court_defendant_id',   -- migration 136; skipped if absent
    'created_at'
  ];
  v_cols text;
  v_missing text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'rooms'
     and c.column_name = any (v_public);

  execute format('grant select (%s) on rooms to anon, authenticated', v_cols);

  select string_agg(n, ', ') into v_missing
    from unnest(v_public) n
   where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = 'rooms'
                        and c.column_name = n);
  if v_missing is not null then
    raise notice 'rooms columns not present (not granted): %', v_missing;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Verification (run separately in the SQL editor)
--
-- 1. What clients may read now: expect the list above (29 names, 31 once 136
--    is applied), for both anon and authenticated.
-- select grantee, count(*), string_agg(column_name, ', ' order by column_name)
--   from information_schema.column_privileges
--  where table_schema = 'public' and table_name = 'rooms'
--    and privilege_type = 'SELECT' and grantee in ('anon', 'authenticated')
--  group by grantee;
--
-- 2. No table-wide SELECT or any DELETE left for clients: expect 0 rows.
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'rooms'
--    and privilege_type in ('SELECT', 'DELETE')
--    and grantee in ('anon', 'authenticated', 'PUBLIC');
--
-- 3. Nothing that runs with the CALLER's rights reads rooms (it would now fail
--    for clients): expect 0 rows from each.
-- select proname from pg_proc
--  where pronamespace = 'public'::regnamespace and not prosecdef
--    and prosrc ~* '\mrooms\M';
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and (coalesce(qual, '') ~* '\mrooms\M' or coalesce(with_check, '') ~* '\mrooms\M');
-- select viewname from pg_views
--  where schemaname = 'public' and definition ~* '\mrooms\M';
