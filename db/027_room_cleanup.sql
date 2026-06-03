-- ============================================
-- Migration 027: automatic room cleanup
-- ============================================
-- Keeps the database lean. A game lasts ~45 min, so any room older
-- than 24 hours is finished (or an abandoned lobby). Deleting it
-- cascades to its players + all four chat tables (messages,
-- dm_messages, consultation_messages, dead_messages).
--
-- Durable account data is NOT affected: game_results has no FK to
-- rooms (it survives on purpose), and profiles / user_achievements /
-- friendships key off auth.users, not rooms.
--
-- Run this whole file once in the Supabase SQL Editor.
-- ============================================

-- pg_cron lets Postgres run scheduled jobs. Supabase ships it; this
-- enables it. If this line errors, enable "pg_cron" first in the
-- dashboard: Database -> Extensions -> search "pg_cron" -> toggle on,
-- then re-run the rest of this file.
create extension if not exists pg_cron;

-- The janitor: delete every room older than 24 hours. SECURITY DEFINER
-- so it runs with full rights (bypasses the open RLS policies) and so
-- you can also call it by hand. Returns how many rooms it removed.
create or replace function public.cleanup_old_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.rooms
  where created_at < now() - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- Schedule it nightly at 04:00 UTC. Unschedule any prior copy first so
-- re-running this file doesn't create duplicate jobs.
do $$
begin
  perform cron.unschedule('cleanup-old-rooms');
exception
  when others then null;  -- no existing job to remove; ignore
end;
$$;

select cron.schedule(
  'cleanup-old-rooms',
  '0 4 * * *',                       -- every day at 04:00 UTC
  $$ select public.cleanup_old_rooms(); $$
);
