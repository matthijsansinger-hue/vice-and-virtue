-- ============================================
-- Public lobbies (migration 041) — Batch 1: the Public/Private flag
-- ============================================
-- Adds a visibility flag to rooms.
--   Private (default) = code-only; nobody can find it via matchmaking.
--   Public            = discoverable by "Find Public Session" matchmaking.
-- Every room still has a join code, so friends can join manually regardless
-- of the flag. The matchmaking function itself lands in migration 042.

alter table rooms
  add column if not exists is_public boolean not null default false;

-- Speeds up the matchmaker's scan for open public lobbies.
create index if not exists rooms_public_lobby_idx
  on rooms (is_public, status)
  where is_public and status = 'lobby';
