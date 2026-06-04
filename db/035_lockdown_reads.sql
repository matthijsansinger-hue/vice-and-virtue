-- ============================================
-- Migration 035: source every secret READ from the server (Batch 4, step 1)
-- ============================================
-- After this, the browser no longer needs the players.role/vote/pending
-- columns for any read:
--   get_my_secrets     -> a player's OWN role/vote/queued action
--   eligible_successors-> the dying Murder's Vice successors (succession)
--   reveal_all_roles   -> every role, only once the game has ended
--   rooms.role_pool    -> the set of roles in the game (Game Overview list)
-- The columns still exist (writes + the mirror keep player_secrets in
-- sync), so this step is reversible. The next step flips writes and stops
-- sending the columns.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- The set of roles present in the game (not who has them) — public, for
-- the Game Overview "roles in this game" list. Written by startGame.
alter table rooms add column if not exists role_pool jsonb;

-- A player's own secrets (role / vote / queued action). Keyed on the
-- caller's player id (no login — see project notes on the threat model).
create or replace function get_my_secrets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'role', role, 'vote', vote,
    'pending_action', pending_action, 'pending_target', pending_target)
  into v
  from player_secrets where player_id = p_player_id;
  return coalesce(v, '{}'::jsonb);
end;
$$;

grant execute on function get_my_secrets(uuid) to anon, authenticated;

-- The dying Murder's eligible Vice successors (active, not the dying one).
-- Only meaningful during the murder_succession sub-phase.
create or replace function eligible_successors(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dying text;
  v_result jsonb;
begin
  select pending_murder_death into v_dying from rooms where id = p_room_id;
  if v_dying is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(p.id), '[]'::jsonb) into v_result
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id and p.id <> v_dying::uuid
    and vv_role_camp(s.role) = 'vice'
    and not p.dead and not p.in_prison and not p.in_hospital;

  return v_result;
end;
$$;

grant execute on function eligible_successors(uuid) to anon, authenticated;

-- Every player's role — ONLY once the game has ended (game-over reveal +
-- stats recording). Returns [{ player_id, user_id, role }].
create or replace function reveal_all_roles(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_result jsonb;
begin
  select status into v_status from rooms where id = p_room_id;
  if v_status <> 'ended' then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id, 'user_id', p.user_id, 'role', s.role)), '[]'::jsonb)
  into v_result
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id;

  return v_result;
end;
$$;

grant execute on function reveal_all_roles(uuid) to anon, authenticated;
