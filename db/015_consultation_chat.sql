-- ============================================
-- Migration 015: group chat during consultation
-- A dedicated table for the public group chat shown during the
-- consultation phase (think "meeting chat" in Among Us). Distinct
-- from the existing `messages` table, which is anonymous camp-only
-- chat from Worshipper / Seeker.
-- ============================================

create table consultation_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid not null references players(id) on delete cascade,
  day integer not null,
  text text not null,
  created_at timestamptz not null default now()
);

alter table consultation_messages enable row level security;

create policy "open access to consultation_messages" on consultation_messages
  for all using (true) with check (true);

alter publication supabase_realtime add table consultation_messages;
