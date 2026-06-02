-- ============================================
-- Migration 020: user accounts (profiles)
-- Adds a `profiles` table, one row per registered account, keyed to
-- Supabase's built-in `auth.users`. Joining a room stays guest-only;
-- an account is only needed to CREATE a room and to keep stats.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

-- One profile per auth user. `username` is the public display name;
-- `favorite_role` is a role id from src/lib/roles.ts (nullable);
-- `avatar_url` points at an uploaded profile photo (added in a later
-- batch — nullable for now).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  favorite_role text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: "Alex" and "alex" can't both exist.
create unique index if not exists profiles_username_lower_idx
  on profiles (lower(username));

alter table profiles enable row level security;

-- Profiles are publicly readable: we show usernames + avatars to other
-- players and need to search them when adding friends. No private data
-- lives here (email stays in auth.users, which is never exposed).
create policy "profiles are readable by everyone"
  on profiles for select using (true);

-- A logged-in user may create only their own profile row...
create policy "users insert their own profile"
  on profiles for insert with check (auth.uid() = id);

-- ...and edit only their own profile row.
create policy "users update their own profile"
  on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- When a new auth user is created (sign-up), automatically create their
-- profile row using the username they passed in sign-up metadata. Runs
-- as the table owner (security definer) so it bypasses RLS during the
-- pre-confirmation window when there is no logged-in session yet.
-- A duplicate username trips the unique index and aborts the sign-up;
-- the client pre-checks availability first to give a clean error.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Realtime so a freshly edited profile (e.g. new avatar) reflects live.
alter publication supabase_realtime add table profiles;
