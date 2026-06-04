-- ============================================
-- Migration 028: player_secrets + server-side minigame scoring
-- (Batch 1 of "hide roles for real")
-- ============================================
-- Secret per-player fields (role, vote, queued action) move into their
-- own locked-down table so they can stop being sent to the browser. The
-- public `players` table keeps every non-secret field, so its realtime
-- subscription is unchanged.
--
-- During the migration we KEEP the old players.* columns and mirror them
-- into player_secrets via a trigger, so today's client code keeps working
-- while we move logic server-side batch by batch. The final batch drops
-- the bridge + the old columns.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- Static role -> camp lookup, reused by every server-side game function.
create or replace function vv_role_camp(p_role text)
returns text
language sql
immutable
as $$
  select case
    when p_role in
      ('murder','intoxication','envy','torment','vengeance','vice_worshipper')
      then 'vice'
    when p_role in
      ('empathy','justice','truthfulness','certainty','sacrifice','virtue_seeker')
      then 'virtue'
    else null
  end;
$$;

-- The secrets table. No RLS policies => anon/authenticated cannot read or
-- write it directly; the only access is through the SECURITY DEFINER
-- trigger + RPCs below (which run as the owner and bypass RLS). It is NOT
-- added to the realtime publication, so it is never broadcast.
create table player_secrets (
  player_id uuid primary key references players(id) on delete cascade,
  role text,
  vote text,
  pending_action text,
  pending_target text
);

alter table player_secrets enable row level security;

-- Backfill from the current players rows.
insert into player_secrets (player_id, role, vote, pending_action, pending_target)
select id, role, vote, pending_action, pending_target from players
on conflict (player_id) do nothing;

-- Bridge: keep player_secrets in sync with every write to players.* while
-- the codebase still writes the old columns. SECURITY DEFINER so it can
-- write the locked-down table.
create or replace function mirror_player_secrets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into player_secrets (player_id, role, vote, pending_action, pending_target)
  values (new.id, new.role, new.vote, new.pending_action, new.pending_target)
  on conflict (player_id) do update
    set role = excluded.role,
        vote = excluded.vote,
        pending_action = excluded.pending_action,
        pending_target = excluded.pending_target;
  return new;
end;
$$;

drop trigger if exists trg_mirror_player_secrets on players;
create trigger trg_mirror_player_secrets
  after insert or update on players
  for each row execute function mirror_player_secrets();

-- Server-side minigame scoring. The client sends only its guesses
-- ({ "<other player id>": "vice" | "virtue" | "unknown" }); the real
-- roles never leave the database. Ports computeScore from Minigame.tsx:
--   +1 correct, +0.4 unknown/untagged, and ANY explicit wrong tag => 0.
-- Targets are the same set the client scores: other players in the room
-- who are not dead and not imprisoned (hospitalized still count).
create or replace function submit_minigame_guesses(
  p_player_id uuid,
  p_guesses jsonb default '{}'::jsonb
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_score numeric := 0;
  v_target record;
  v_guess text;
  v_truth text;
begin
  -- Only active players score (matches the client guard).
  select room_id into v_room_id
  from players
  where id = p_player_id and not dead and not in_prison and not in_hospital;
  if v_room_id is null then
    return 0;
  end if;

  for v_target in
    select p.id, s.role
    from players p
    left join player_secrets s on s.player_id = p.id
    where p.room_id = v_room_id
      and p.id <> p_player_id
      and not p.dead
      and not p.in_prison
  loop
    v_guess := p_guesses ->> v_target.id::text;
    v_truth := vv_role_camp(v_target.role);
    if v_guess is null or v_guess = 'unknown' or v_truth is null then
      v_score := v_score + 0.4;
    elsif v_guess = v_truth then
      v_score := v_score + 1;
    else
      v_score := 0;   -- any wrong explicit tag zeroes the whole round
      exit;
    end if;
  end loop;

  update players
  set minigame_score = v_score,
      minigame_submitted_at = now(),
      ready = true
  where id = p_player_id;

  return v_score;
end;
$$;

grant execute on function submit_minigame_guesses(uuid, jsonb) to anon, authenticated;
