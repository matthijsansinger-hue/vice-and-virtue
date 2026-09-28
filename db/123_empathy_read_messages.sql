-- Migration 123 — Empathy reads a conversation (replaces "reveal one camp")
--
-- Design (Matthijs, 2026-09-28): Empathy's 100-SE camp reveal is replaced by
-- reading the private Outreach messages between TWO chosen players, for 150 SE.
-- Empathy acts in the role-action phase, which comes BEFORE that day's
-- Outreach, so the conversation shown is the PREVIOUS day's (last night's).
-- Available from day 2 (there is no conversation before day 1's Outreach).
-- Still one Empathy ability per day (acted_this_day); the voter reveal
-- (reveal_votes_empathy, 150) is unchanged.
--
-- Also removes reveal_camp. It was created in migration 056 and never given a
-- caller gate (it isn't in 098's list): any client that knew a player id could
-- call it — spending that Empathy's Soul Energy, learning a camp, and, from
-- which id returned non-null, learning who Empathy is. It has no other caller.
--
-- (Torment's rework — ink over the names in the target's Outreach — is
-- client-only: get_my_secrets already tells the target they're tormented for
-- the whole day, and torment_target is still cleared at the next new day.)
--
-- Safe to re-run.

begin;

drop function if exists reveal_camp(uuid, uuid);

create or replace function empathy_read_messages(
  p_player_id uuid,
  p_a uuid,
  p_b uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_se numeric;
  v_acted boolean;
  v_role text;
  v_dead boolean; v_prison boolean; v_hosp boolean;
  v_phase text;
  v_day integer;
  v_msgs jsonb;
begin
  if not vv_is_me(p_player_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock my row: two quick taps can't both pass the once-a-day check.
  select p.room_id, p.soul_energy, p.acted_this_day, s.role,
         p.dead, p.in_prison, p.in_hospital
    into v_room, v_se, v_acted, v_role, v_dead, v_prison, v_hosp
    from players p join player_secrets s on s.player_id = p.id
   where p.id = p_player_id
   for update of p;

  if v_room is null or v_role is distinct from 'empathy' then
    return jsonb_build_object('ok', false, 'reason', 'not_empathy');
  end if;
  if v_dead or v_prison or v_hosp then
    return jsonb_build_object('ok', false, 'reason', 'cannot_act');
  end if;

  select phase, day into v_phase, v_day from rooms where id = v_room;
  if v_phase is distinct from 'role_action' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_phase');
  end if;
  if v_day < 2 then
    return jsonb_build_object('ok', false, 'reason', 'too_early');
  end if;
  if v_acted then
    return jsonb_build_object('ok', false, 'reason', 'already_acted');
  end if;
  if v_se < 150 then
    return jsonb_build_object('ok', false, 'reason', 'not_enough');
  end if;

  if p_a is null or p_b is null or p_a = p_b
     or p_a = p_player_id or p_b = p_player_id
     or (select count(*) from players where id in (p_a, p_b) and room_id = v_room) <> 2 then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;

  update players
     set soul_energy = soul_energy - 150, acted_this_day = true
   where id = p_player_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sender_id', m.sender_id,
           'text', m.text,
           'created_at', m.created_at
         ) order by m.created_at), '[]'::jsonb)
    into v_msgs
    from dm_messages m
   where m.room_id = v_room
     and m.day = v_day - 1
     and ((m.sender_id = p_a and m.recipient_id = p_b)
       or (m.sender_id = p_b and m.recipient_id = p_a));

  return jsonb_build_object('ok', true, 'day', v_day - 1, 'messages', v_msgs);
end;
$$;
grant execute on function empathy_read_messages(uuid, uuid, uuid) to anon, authenticated;

commit;
