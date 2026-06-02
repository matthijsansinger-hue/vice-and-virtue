-- ============================================
-- Migration 023: friendships
-- A friendship/request between two accounts. One row per pair; the
-- requester sends, the addressee accepts. Proper per-user RLS (this is
-- consent-related, like profiles — not the open MVP game-table policy).
--
-- Run this in the Supabase SQL Editor.
-- ============================================

create table if not exists friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',          -- 'pending' | 'accepted'
  created_at timestamptz not null default now(),
  constraint friendships_no_self check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index if not exists friendships_requester_idx on friendships (requester_id);
create index if not exists friendships_addressee_idx on friendships (addressee_id);

alter table friendships enable row level security;

-- You can see only friendship rows you're part of.
create policy "see own friendships"
  on friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- You can create a request only as yourself (the requester).
create policy "create own requests"
  on friendships for insert
  with check (auth.uid() = requester_id);

-- Only the addressee can update (i.e. accept) a request.
create policy "addressee updates request"
  on friendships for update
  using (auth.uid() = addressee_id)
  with check (auth.uid() = addressee_id);

-- Either party can delete (decline / cancel / unfriend).
create policy "either party deletes"
  on friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Realtime so incoming requests / accepts reflect live.
alter publication supabase_realtime add table friendships;
