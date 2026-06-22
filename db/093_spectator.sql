-- ============================================
-- Migration 093: dead-player spectator read
-- ============================================
-- Dead players become omniscient spectators. This one SECURITY DEFINER read
-- returns the secret per-player snapshot (role, Soul Energy, queued role action,
-- consultation vote, Quiz guesses, Market purchases) for EVERY player in the
-- room — but ONLY when the caller is dead. A living caller gets {ok:false}.
--
-- The dead-gate is the entire security boundary (same shape as my_voters /
-- reveal_all_roles). DMs are open-RLS, so the spectator reads chats client-side.
--
-- Run this in the Supabase SQL Editor.
-- ============================================

create or replace function spectator_secrets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_dead boolean;
  v_players jsonb;
begin
  select room_id, dead into v_room, v_dead from players where id = p_player_id;
  -- Only the dead may peek. Everyone else gets nothing.
  if v_room is null or not coalesce(v_dead, false) then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', p.id,
    'role', s.role,
    'soul_energy', p.soul_energy,
    'pending_action', s.pending_action,
    'pending_target', s.pending_target,
    'vote', s.vote,
    'guesses', s.minigame_guesses,
    'potions', jsonb_build_object(
      'kill', s.potion_kill_target,
      'hosp', s.potion_hosp_target,
      'protect', coalesce(s.potion_protect, false),
      'mult', coalesce(s.potion_minigame_mult, false),
      'vote_reveal', coalesce(s.potion_vote_reveal, false),
      'iron_will', coalesce(s.potion_iron_will, false)
    )
  ) order by p.created_at), '[]'::jsonb)
  into v_players
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = v_room;

  return jsonb_build_object('ok', true, 'players', v_players);
end;
$$;
grant execute on function spectator_secrets(uuid) to anon, authenticated;
