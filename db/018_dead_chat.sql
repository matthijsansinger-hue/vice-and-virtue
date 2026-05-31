-- ============================================
-- Migration 018: dead-player group chat
-- A private chat visible only to players who have died. They can
-- read and send messages to each other; living players don't see
-- it at all. Distinct from the existing message tables:
--   messages              — anonymous camp broadcasts
--   dm_messages           — 1-on-1 outreach chats
--   consultation_messages — public group chat during consultation
--   dead_messages (new)   — dead-only side channel
-- ============================================

create table dead_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid not null references players(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table dead_messages enable row level security;

create policy "open access to dead_messages" on dead_messages
  for all using (true) with check (true);

alter publication supabase_realtime add table dead_messages;
