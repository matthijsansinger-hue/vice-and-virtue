-- Migration 009: per-camp messages, used by Vice Worshipper / Virtue Seeker.
-- Run this in the Supabase SQL Editor.

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  camp text not null,                            -- 'vice' or 'virtue'
  sender_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- RLS open for the MVP, same as our other tables.
alter table messages enable row level security;

create policy "open access to messages" on messages
  for all using (true) with check (true);

-- Live updates: recipients see new messages without refreshing.
alter publication supabase_realtime add table messages;
