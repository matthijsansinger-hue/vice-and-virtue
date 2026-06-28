-- Migration 098 — Caller gate (untrusted-client / Steam hardening, phase 2b)
--
-- Fixes audit finding C2: every player-action / own-info RPC trusted a client-
-- supplied player id with no check that it belongs to the caller. Since player
-- UUIDs are handed to every client, an attacker could vote / queue actions / use
-- abilities / read secrets AS ANY player. This binds each one to the caller via
-- vv_is_me() (migration 096) using the same rename-and-wrap technique as 097
-- (bodies renamed UNCHANGED to _impl; thin same-signature wrapper checks then
-- delegates; no client changes).
--
-- Verified safe: a schema-wide grep confirms NONE of these are called server-side
-- by another function, so binding to the caller can't break an internal chain.
--
-- Special cases: report_player's caller is its 2nd arg (p_reporter_id); leave_room
-- also allows the room host (so a host-kick, if used, still works).
--
-- NOT YET FIXED here (logic rewrites land in 099): queue_action still trusts its
-- client cost/action (C3) — this only stops queuing AS SOMEONE ELSE; submit_vote
-- still lacks phase+lock (H1).
--
-- ⚠️ PREREQUISITE — apply only AFTER 096 + anonymous auth are live (every player
-- has a user_id) AND 097. Otherwise vv_is_me() matches nobody and all actions are
-- rejected.

begin;

-- get_my_secrets(uuid) -> jsonb  (you may only read YOUR OWN secret role/state)
alter function get_my_secrets(uuid) rename to get_my_secrets_impl;
create function get_my_secrets(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return get_my_secrets_impl(p_player_id);
end; $$;
revoke execute on function get_my_secrets_impl(uuid) from anon, authenticated;
grant execute on function get_my_secrets(uuid) to anon, authenticated;

-- spectator_secrets(uuid) -> jsonb  (caller must be passing their own dead row)
alter function spectator_secrets(uuid) rename to spectator_secrets_impl;
create function spectator_secrets(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return spectator_secrets_impl(p_player_id);
end; $$;
revoke execute on function spectator_secrets_impl(uuid) from anon, authenticated;
grant execute on function spectator_secrets(uuid) to anon, authenticated;

-- submit_vote(uuid, text) -> void
alter function submit_vote(uuid, text) rename to submit_vote_impl;
create function submit_vote(p_player_id uuid, p_vote text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  perform submit_vote_impl(p_player_id, p_vote);
end; $$;
revoke execute on function submit_vote_impl(uuid, text) from anon, authenticated;
grant execute on function submit_vote(uuid, text) to anon, authenticated;

-- queue_action(uuid, numeric, text, text) -> void  (C2 only; C3 cost/role in 099)
alter function queue_action(uuid, numeric, text, text) rename to queue_action_impl;
create function queue_action(p_player_id uuid, p_cost numeric, p_action text, p_target text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  perform queue_action_impl(p_player_id, p_cost, p_action, p_target);
end; $$;
revoke execute on function queue_action_impl(uuid, numeric, text, text) from anon, authenticated;
grant execute on function queue_action(uuid, numeric, text, text) to anon, authenticated;

-- submit_minigame_guesses(uuid, jsonb) -> numeric
alter function submit_minigame_guesses(uuid, jsonb) rename to submit_minigame_guesses_impl;
create function submit_minigame_guesses(p_player_id uuid, p_guesses jsonb default '{}'::jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return submit_minigame_guesses_impl(p_player_id, p_guesses);
end; $$;
revoke execute on function submit_minigame_guesses_impl(uuid, jsonb) from anon, authenticated;
grant execute on function submit_minigame_guesses(uuid, jsonb) to anon, authenticated;

-- select_role(uuid, text, boolean) -> boolean
alter function select_role(uuid, text, boolean) rename to select_role_impl;
create function select_role(p_player_id uuid, p_role text, p_lock boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return select_role_impl(p_player_id, p_role, p_lock);
end; $$;
revoke execute on function select_role_impl(uuid, text, boolean) from anon, authenticated;
grant execute on function select_role(uuid, text, boolean) to anon, authenticated;

-- submit_soul_escape(uuid, jsonb) -> boolean
alter function submit_soul_escape(uuid, jsonb) rename to submit_soul_escape_impl;
create function submit_soul_escape(p_player_id uuid, p_guess jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return submit_soul_escape_impl(p_player_id, p_guess);
end; $$;
revoke execute on function submit_soul_escape_impl(uuid, jsonb) from anon, authenticated;
grant execute on function submit_soul_escape(uuid, jsonb) to anon, authenticated;

-- buy_potion(uuid, text, uuid) -> jsonb
alter function buy_potion(uuid, text, uuid) rename to buy_potion_impl;
create function buy_potion(p_player_id uuid, p_potion text, p_target uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return buy_potion_impl(p_player_id, p_potion, p_target);
end; $$;
revoke execute on function buy_potion_impl(uuid, text, uuid) from anon, authenticated;
grant execute on function buy_potion(uuid, text, uuid) to anon, authenticated;

-- buy_soul_ward(uuid) -> jsonb
alter function buy_soul_ward(uuid) rename to buy_soul_ward_impl;
create function buy_soul_ward(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return buy_soul_ward_impl(p_player_id);
end; $$;
revoke execute on function buy_soul_ward_impl(uuid) from anon, authenticated;
grant execute on function buy_soul_ward(uuid) to anon, authenticated;

-- buy_extra_life(uuid) -> jsonb
alter function buy_extra_life(uuid) rename to buy_extra_life_impl;
create function buy_extra_life(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return buy_extra_life_impl(p_player_id);
end; $$;
revoke execute on function buy_extra_life_impl(uuid) from anon, authenticated;
grant execute on function buy_extra_life(uuid) to anon, authenticated;

-- contribute_release(uuid, uuid) -> jsonb
alter function contribute_release(uuid, uuid) rename to contribute_release_impl;
create function contribute_release(p_player_id uuid, p_prisoner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return contribute_release_impl(p_player_id, p_prisoner);
end; $$;
revoke execute on function contribute_release_impl(uuid, uuid) from anon, authenticated;
grant execute on function contribute_release(uuid, uuid) to anon, authenticated;

-- gift_soul_energy(uuid, uuid) -> jsonb  (caller = giver = p_player_id)
alter function gift_soul_energy(uuid, uuid) rename to gift_soul_energy_impl;
create function gift_soul_energy(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return gift_soul_energy_impl(p_player_id, p_target_id);
end; $$;
revoke execute on function gift_soul_energy_impl(uuid, uuid) from anon, authenticated;
grant execute on function gift_soul_energy(uuid, uuid) to anon, authenticated;

-- grant_extra_life(uuid, uuid) -> jsonb  (caller = Generosity = p_player_id)
alter function grant_extra_life(uuid, uuid) rename to grant_extra_life_impl;
create function grant_extra_life(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return grant_extra_life_impl(p_player_id, p_target_id);
end; $$;
revoke execute on function grant_extra_life_impl(uuid, uuid) from anon, authenticated;
grant execute on function grant_extra_life(uuid, uuid) to anon, authenticated;

-- gambling_roll(uuid) -> jsonb
alter function gambling_roll(uuid) rename to gambling_roll_impl;
create function gambling_roll(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return gambling_roll_impl(p_player_id);
end; $$;
revoke execute on function gambling_roll_impl(uuid) from anon, authenticated;
grant execute on function gambling_roll(uuid) to anon, authenticated;

-- gambling_pick_target(uuid, uuid) -> jsonb
alter function gambling_pick_target(uuid, uuid) rename to gambling_pick_target_impl;
create function gambling_pick_target(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return gambling_pick_target_impl(p_player_id, p_target_id);
end; $$;
revoke execute on function gambling_pick_target_impl(uuid, uuid) from anon, authenticated;
grant execute on function gambling_pick_target(uuid, uuid) to anon, authenticated;

-- pride_reveal(uuid) -> jsonb
alter function pride_reveal(uuid) rename to pride_reveal_impl;
create function pride_reveal(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return pride_reveal_impl(p_player_id);
end; $$;
revoke execute on function pride_reveal_impl(uuid) from anon, authenticated;
grant execute on function pride_reveal(uuid) to anon, authenticated;

-- diligence_count(uuid) -> jsonb
alter function diligence_count(uuid) rename to diligence_count_impl;
create function diligence_count(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return diligence_count_impl(p_player_id);
end; $$;
revoke execute on function diligence_count_impl(uuid) from anon, authenticated;
grant execute on function diligence_count(uuid) to anon, authenticated;

-- convert_player(uuid, uuid) -> jsonb  (caller = Wrath/Love = p_player_id)
alter function convert_player(uuid, uuid) rename to convert_player_impl;
create function convert_player(p_player_id uuid, p_target_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return convert_player_impl(p_player_id, p_target_id);
end; $$;
revoke execute on function convert_player_impl(uuid, uuid) from anon, authenticated;
grant execute on function convert_player(uuid, uuid) to anon, authenticated;

-- relinquish_follower(uuid) -> jsonb
alter function relinquish_follower(uuid) rename to relinquish_follower_impl;
create function relinquish_follower(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return relinquish_follower_impl(p_player_id);
end; $$;
revoke execute on function relinquish_follower_impl(uuid) from anon, authenticated;
grant execute on function relinquish_follower(uuid) to anon, authenticated;

-- arm_tiebreak(uuid) -> jsonb
alter function arm_tiebreak(uuid) rename to arm_tiebreak_impl;
create function arm_tiebreak(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return arm_tiebreak_impl(p_player_id);
end; $$;
revoke execute on function arm_tiebreak_impl(uuid) from anon, authenticated;
grant execute on function arm_tiebreak(uuid) to anon, authenticated;

-- my_follower_count(uuid) -> int
alter function my_follower_count(uuid) rename to my_follower_count_impl;
create function my_follower_count(p_player_id uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_follower_count_impl(p_player_id);
end; $$;
revoke execute on function my_follower_count_impl(uuid) from anon, authenticated;
grant execute on function my_follower_count(uuid) to anon, authenticated;

-- plant_bomb(uuid, uuid) -> jsonb  (caller = Fanatic = p_fanatic)
alter function plant_bomb(uuid, uuid) rename to plant_bomb_impl;
create function plant_bomb(p_fanatic uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return plant_bomb_impl(p_fanatic, p_target);
end; $$;
revoke execute on function plant_bomb_impl(uuid, uuid) from anon, authenticated;
grant execute on function plant_bomb(uuid, uuid) to anon, authenticated;

-- bomb_carriers(uuid) -> jsonb  (caller = Fanatic)
alter function bomb_carriers(uuid) rename to bomb_carriers_impl;
create function bomb_carriers(p_fanatic uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return bomb_carriers_impl(p_fanatic);
end; $$;
revoke execute on function bomb_carriers_impl(uuid) from anon, authenticated;
grant execute on function bomb_carriers(uuid) to anon, authenticated;

-- pass_bomb(uuid, uuid) -> jsonb  (caller = current holder = p_holder)
alter function pass_bomb(uuid, uuid) rename to pass_bomb_impl;
create function pass_bomb(p_holder uuid, p_target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_holder) then raise exception 'forbidden' using errcode='42501'; end if;
  return pass_bomb_impl(p_holder, p_target);
end; $$;
revoke execute on function pass_bomb_impl(uuid, uuid) from anon, authenticated;
grant execute on function pass_bomb(uuid, uuid) to anon, authenticated;

-- detonate_bomb(uuid, int) -> jsonb  (caller = Fanatic)
alter function detonate_bomb(uuid, int) rename to detonate_bomb_impl;
create function detonate_bomb(p_fanatic uuid, p_bomb_id int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return detonate_bomb_impl(p_fanatic, p_bomb_id);
end; $$;
revoke execute on function detonate_bomb_impl(uuid, int) from anon, authenticated;
grant execute on function detonate_bomb(uuid, int) to anon, authenticated;

-- fanatic_state(uuid) -> jsonb  (caller = Fanatic)
alter function fanatic_state(uuid) rename to fanatic_state_impl;
create function fanatic_state(p_fanatic uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return fanatic_state_impl(p_fanatic);
end; $$;
revoke execute on function fanatic_state_impl(uuid) from anon, authenticated;
grant execute on function fanatic_state(uuid) to anon, authenticated;

-- my_bombs(uuid) -> jsonb  (caller = Fanatic)
alter function my_bombs(uuid) rename to my_bombs_impl;
create function my_bombs(p_fanatic uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_fanatic) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_bombs_impl(p_fanatic);
end; $$;
revoke execute on function my_bombs_impl(uuid) from anon, authenticated;
grant execute on function my_bombs(uuid) to anon, authenticated;

-- reveal_role(uuid, uuid) -> text  (caller = Certainty = p_player_id)
alter function reveal_role(uuid, uuid) rename to reveal_role_impl;
create function reveal_role(p_player_id uuid, p_target_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return reveal_role_impl(p_player_id, p_target_id);
end; $$;
revoke execute on function reveal_role_impl(uuid, uuid) from anon, authenticated;
grant execute on function reveal_role(uuid, uuid) to anon, authenticated;

-- reveal_votes_empathy(uuid) -> jsonb
alter function reveal_votes_empathy(uuid) rename to reveal_votes_empathy_impl;
create function reveal_votes_empathy(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return reveal_votes_empathy_impl(p_player_id);
end; $$;
revoke execute on function reveal_votes_empathy_impl(uuid) from anon, authenticated;
grant execute on function reveal_votes_empathy(uuid) to anon, authenticated;

-- reveal_votes_truthfulness(uuid) -> boolean
alter function reveal_votes_truthfulness(uuid) rename to reveal_votes_truthfulness_impl;
create function reveal_votes_truthfulness(p_player_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return reveal_votes_truthfulness_impl(p_player_id);
end; $$;
revoke execute on function reveal_votes_truthfulness_impl(uuid) from anon, authenticated;
grant execute on function reveal_votes_truthfulness(uuid) to anon, authenticated;

-- vengeance_available(uuid) -> boolean
alter function vengeance_available(uuid) rename to vengeance_available_impl;
create function vengeance_available(p_player_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return vengeance_available_impl(p_player_id);
end; $$;
revoke execute on function vengeance_available_impl(uuid) from anon, authenticated;
grant execute on function vengeance_available(uuid) to anon, authenticated;

-- my_potions(uuid) -> jsonb
alter function my_potions(uuid) rename to my_potions_impl;
create function my_potions(p_player_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_potions_impl(p_player_id);
end; $$;
revoke execute on function my_potions_impl(uuid) from anon, authenticated;
grant execute on function my_potions(uuid) to anon, authenticated;

-- my_voters(uuid) -> uuid[]  (own armed vote-reveal only)
alter function my_voters(uuid) rename to my_voters_impl;
create function my_voters(p_player_id uuid) returns uuid[]
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode='42501'; end if;
  return my_voters_impl(p_player_id);
end; $$;
revoke execute on function my_voters_impl(uuid) from anon, authenticated;
grant execute on function my_voters(uuid) to anon, authenticated;

-- leave_room(uuid) -> void  (yourself, OR the host removing a player)
alter function leave_room(uuid) rename to leave_room_impl;
create function leave_room(p_player_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (vv_is_me(p_player_id)
          or vv_is_host((select room_id from players where id = p_player_id))) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  perform leave_room_impl(p_player_id);
end; $$;
revoke execute on function leave_room_impl(uuid) from anon, authenticated;
grant execute on function leave_room(uuid) to anon, authenticated;

-- report_player(uuid, uuid, uuid, text) -> void  (caller = REPORTER = 2nd arg)
alter function report_player(uuid, uuid, uuid, text) rename to report_player_impl;
create function report_player(p_room_id uuid, p_reporter_id uuid, p_reported_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not vv_is_me(p_reporter_id) then raise exception 'forbidden' using errcode='42501'; end if;
  perform report_player_impl(p_room_id, p_reporter_id, p_reported_id, p_reason);
end; $$;
revoke execute on function report_player_impl(uuid, uuid, uuid, text) from anon, authenticated;
grant execute on function report_player(uuid, uuid, uuid, text) to anon, authenticated;

commit;
