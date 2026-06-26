-- ============================================
-- Migration 095 — tell a Worshipper/Seeker when their guess was correct
-- ============================================
-- worshipper_guess / seeker_guess resolve inside resolve_role_action at the end
-- of role-action, but the guesser was never told the outcome. This adds
-- notify_correct_guesses(room): the host runs it RIGHT BEFORE resolve_role_action
-- (while the pending guesses still exist) to send the guesser a success notice on
-- a correct guess. The notice both informs the player and drives the success-only
-- guess animation client-side (AbilityOutcomeWatcher keys on "Your guess was true").
-- Purely additive — a new function + a new client call; resolve_role_action is
-- left unchanged. Correctness = the target really is the counterpart; the
-- Worshipper's kill is additionally gated on the target not being protected,
-- mirroring resolve_role_action (a Seeker's imprisonment is unblockable).
-- ============================================

create or replace function notify_correct_guesses(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protected uuid[] := '{}';
  r record;
begin
  -- The same protect set resolve_role_action uses (Justice protect + the
  -- protection potion): a protected Seeker survives a correct Worshipper guess,
  -- so the kill isn't claimed.
  select coalesce(array_agg(s.pending_target::uuid), '{}') into v_protected
  from players p join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and s.pending_action = 'protect' and s.pending_target is not null;
  v_protected := v_protected || coalesce((
    select array_agg(s.player_id)
    from player_secrets s join players p on p.id = s.player_id
    where p.room_id = p_room_id and s.potion_protect and not p.dead
  ), '{}'::uuid[]);

  for r in
    select p.id as guesser, s.pending_action as act, s.pending_target as tgt
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id
      and s.pending_action in ('worshipper_guess','seeker_guess')
      and s.pending_target is not null
  loop
    if r.act = 'worshipper_guess' then
      if not (r.tgt::uuid = any(v_protected)) and exists (
        select 1 from player_secrets gs
        where gs.player_id = r.tgt::uuid and gs.role = 'virtue_seeker'
      ) then
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, r.guesser,
          'Your guess was true — you struck down the Virtue Seeker.');
      end if;
    else
      if exists (
        select 1 from player_secrets gs
        where gs.player_id = r.tgt::uuid and gs.role = 'vice_worshipper'
      ) then
        insert into player_notices (room_id, recipient_id, text)
        values (p_room_id, r.guesser,
          'Your guess was true — the Vice Worshipper is cast into prison.');
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function notify_correct_guesses(uuid) to anon, authenticated;
