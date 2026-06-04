-- ============================================
-- Migration 033: Truthfulness + Vengeance server-side (Batch 3b-iii)
-- ============================================
-- Removes the last vote/role reads from these two abilities.
--   Truthfulness: reveal_votes_truthfulness sets vote_reveal; the public
--     voter list comes from get_revealed_voters, which only ever returns
--     the voters of THIS round's imprisoned player (computed server-side),
--     so a set vote_reveal can't be abused to read arbitrary votes.
--   Vengeance: the picker now shows all eligible players (no longer leaks
--     who voted); vengeance_available answers the "was a Vice imprisoned?"
--     gate just for the Vengeance player, without exposing that camp to
--     everyone via a public field.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- Truthfulness (cost 200): verify caller is Truthfulness, there's a unique
-- imprisoned this round, spend SE, broadcast (vote_reveal = true).
create or replace function reveal_votes_truthfulness(p_player_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_se numeric;
  v_acted boolean;
  v_role text;
begin
  select p.room_id, p.soul_energy, p.acted_this_day, s.role
    into v_room_id, v_se, v_acted, v_role
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room_id is null or v_role is distinct from 'truthfulness'
     or v_acted or v_se < 200 then
    return false;
  end if;

  -- Only meaningful if someone is actually being imprisoned this round.
  if (consultation_tally(v_room_id) ->> 'imprisoned_id') is null then
    return false;
  end if;

  update players set soul_energy = soul_energy - 200, acted_this_day = true
  where id = p_player_id;
  update rooms set vote_reveal = true where id = v_room_id;
  return true;
end;
$$;

grant execute on function reveal_votes_truthfulness(uuid) to anon, authenticated;

-- Public voter list for the round's imprisoned player — only when
-- Truthfulness has revealed (vote_reveal). Returns [] otherwise. The
-- target is the server-computed tally winner, so this can't be used to
-- read votes for any other player.
create or replace function get_revealed_voters(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reveal boolean;
  v_target text;
  v_result jsonb;
begin
  select vote_reveal into v_reveal from rooms where id = p_room_id;
  if not coalesce(v_reveal, false) then
    return '[]'::jsonb;
  end if;

  v_target := consultation_tally(p_room_id) ->> 'imprisoned_id';
  if v_target is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(s.player_id), '[]'::jsonb) into v_result
  from player_secrets s join players p on p.id = s.player_id
  where p.room_id = p_room_id and s.vote = v_target;

  return v_result;
end;
$$;

grant execute on function get_revealed_voters(uuid) to anon, authenticated;

-- Vengeance gate: true only for the Vengeance player when the most recent
-- imprisonment was a Vice. Told just to the caller, never broadcast.
create or replace function vengeance_available(p_player_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_role text;
  v_last text;
  v_camp text;
begin
  select p.room_id, s.role into v_room_id, v_role
  from players p join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_role is distinct from 'vengeance' then return false; end if;

  select last_imprisoned_player into v_last from rooms where id = v_room_id;
  if v_last is null then return false; end if;

  select vv_role_camp(s.role) into v_camp
  from player_secrets s where s.player_id = v_last::uuid;

  return v_camp = 'vice';
end;
$$;

grant execute on function vengeance_available(uuid) to anon, authenticated;
