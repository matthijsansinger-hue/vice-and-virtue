-- 038_featured_badges.sql
-- Players can showcase up to two badges next to their name in the lobby and at
-- game over. The chosen badge ids live on the account profile (picked on the
-- /profile page). RLS is unchanged: profiles are world-readable, write-your-own.
alter table profiles
  add column if not exists featured_badges text[] not null default '{}';
