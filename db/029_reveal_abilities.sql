-- ============================================
-- Migration 029: server-side reveal abilities (Certainty + Empathy)
-- (Batch 2 of "hide roles for real")
-- ============================================
-- These two role-action abilities read other players' secrets to reveal
-- something. Move that read server-side: the RPC verifies the caller
-- really holds the ability (so it can't be spoofed), spends the Soul
-- Energy, marks them acted, and returns only the revealed result.
-- Truthfulness + Vengeance + camp counts come with the consultation /
-- resolution batch (they're entangled with vote tallying).
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- Certainty (cost 100): reveal one target's exact role id. Returns the
-- role id (the client renders its name/camp/card), or null if the caller
-- isn't Certainty / already acted / can't afford / target invalid.
create or replace function reveal_role(p_player_id uuid, p_target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_caller_role text;
  v_target_role text;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_caller_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_caller_role is distinct from 'certainty'
     or v_acted or v_se < 100 then
    return null;
  end if;

  select s.role into v_target_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_target_id and p.room_id = v_room_id;

  if v_target_role is null then
    return null;
  end if;

  update players
  set soul_energy = soul_energy - 100, acted_this_day = true
  where id = p_player_id;

  return v_target_role;
end;
$$;

grant execute on function reveal_role(uuid, uuid) to anon, authenticated;

-- Empathy (cost 150): reveal who voted for whom in the last consultation.
-- Returns a jsonb array [{ target_id, voter_ids:[...] }] (skip / null votes
-- excluded); the client maps ids to names. Null if not Empathy / acted /
-- can't afford.
create or replace function reveal_votes_empathy(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_caller_role text;
  v_result jsonb;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_caller_role
  from players p
  join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_caller_role is distinct from 'empathy'
     or v_acted or v_se < 150 then
    return null;
  end if;

  update players
  set soul_energy = soul_energy - 150, acted_this_day = true
  where id = p_player_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('target_id', target_id, 'voter_ids', voter_ids)),
    '[]'::jsonb
  )
    into v_result
  from (
    select s.vote as target_id, array_agg(s.player_id) as voter_ids
    from player_secrets s
    join players p on p.id = s.player_id
    where p.room_id = v_room_id
      and s.vote is not null
      and s.vote <> 'skip'
    group by s.vote
  ) t;

  return v_result;
end;
$$;

grant execute on function reveal_votes_empathy(uuid) to anon, authenticated;
