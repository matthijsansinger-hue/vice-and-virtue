-- Migration 107 — Steam purchase init→finalize handoff table
--
-- Completes the Steam Microtransactions backend (migration 105 already has the
-- `steam_purchases` ledger + `credit_steam_purchase`). The `steam-purchase`
-- Edge Function records the INTENT here before calling Steam's InitTxn, so that
-- when the client comes back with only an order id, the server can still resolve
-- WHICH account and WHICH package that order belongs to — the client never gets
-- to say who to credit or what to grant.
--
-- Locked down: no RLS policies at all, so anon/authenticated cannot read or
-- write it. Only the Edge Function's service role touches it.

begin;

create table if not exists steam_pending (
  order_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  package text not null,
  steam_id text,
  created_at timestamptz not null default now()
);

alter table steam_pending enable row level security;
-- (deliberately no policies — service role only)

-- Abandoned intents (user closed the overlay, never confirmed) would otherwise
-- accumulate forever. A finalize deletes its own row; this sweeps the rest.
create index if not exists steam_pending_created_idx on steam_pending (created_at);

create or replace function cleanup_steam_pending()
returns void
language sql
security definer
set search_path = public
as $$
  delete from steam_pending where created_at < now() - interval '24 hours';
$$;
revoke all on function cleanup_steam_pending() from public, anon, authenticated;

-- Runs alongside the existing nightly room cleanup (migration 027 set up pg_cron).
select cron.schedule(
  'cleanup-steam-pending',
  '30 4 * * *',
  $$select cleanup_steam_pending()$$
);

commit;
