-- Migration 011: direct messages for the outreach phase.
-- Run this in the Supabase SQL Editor.

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid not null references players(id) on delete cascade,
  recipient_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table dm_messages enable row level security;

create policy "open access to dm_messages" on dm_messages
  for all using (true) with check (true);

alter publication supabase_realtime add table dm_messages;
