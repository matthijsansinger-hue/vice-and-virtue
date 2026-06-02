-- ============================================
-- Migration 021: avatar storage bucket
-- Creates a public "avatars" Storage bucket for profile photos and
-- restricts writes so a user can only manage files inside their own
-- folder (path prefix = their user id). Reads are public so avatars
-- show up for everyone.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

-- Public bucket, 2 MB cap, images only. (We resize client-side to a
-- small square before upload, so files are far under the cap.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Anyone can read avatar files.
create policy "avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- A user can upload/replace/delete only files in their own folder:
-- the first path segment must equal their user id (e.g. "<uid>/avatar.png").
create policy "users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
