-- ============================================
-- Lightweight moderation (migration 044)
-- ============================================
-- Players can report each other. After enough DISTINCT players report the
-- same person in a game, that person is auto-muted (can't send chat) for the
-- rest of that game. Every report is also logged for manual review.
--
-- Mute is a public players column so it broadcasts over realtime and the
-- muted client disables their composers immediately. The reports table is
-- locked (no client policies) — only the SECURITY DEFINER RPC writes it, and
-- you review it from the Supabase dashboard (service role bypasses RLS).

alter table players
  add column if not exists muted boolean not null default false;

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  reporter_id uuid not null,                 -- players.id of the reporter
  reported_id uuid not null,                 -- players.id of the reported
  reported_user_id uuid,                     -- account of the reported, if any (repeat-offender review)
  reason text,                               -- optional, currently unused by the one-tap UI
  created_at timestamptz not null default now(),
  unique (room_id, reporter_id, reported_id) -- one report per reporter per target per game
);

create index if not exists reports_room_reported_idx
  on reports (room_id, reported_id);

alter table reports enable row level security;
-- Intentionally NO policies: only report_player() (SECURITY DEFINER) writes,
-- and review happens in the dashboard.

-- Number of distinct players that mutes someone. Tune here.
create or replace function report_player(
  p_room_id uuid,
  p_reporter_id uuid,
  p_reported_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reported_user uuid;
  v_count int;
  v_threshold constant int := 3;
begin
  if p_reporter_id = p_reported_id then
    return; -- no self-reports
  end if;

  -- The reported player must actually be in this room.
  select user_id into v_reported_user
  from players
  where id = p_reported_id and room_id = p_room_id;
  if not found then
    return;
  end if;

  insert into reports
    (room_id, reporter_id, reported_id, reported_user_id, reason)
  values
    (p_room_id, p_reporter_id, p_reported_id, v_reported_user,
     nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (room_id, reporter_id, reported_id) do nothing;

  -- Auto-mute once enough distinct players have reported them this game.
  -- (The unique constraint makes each row a distinct reporter.)
  select count(*) into v_count
  from reports
  where room_id = p_room_id and reported_id = p_reported_id;

  if v_count >= v_threshold then
    update players set muted = true where id = p_reported_id;
  end if;
end;
$$;

grant execute on function report_player(uuid, uuid, uuid, text) to anon, authenticated;
