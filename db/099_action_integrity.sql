-- Migration 099 — Action integrity (untrusted-client / Steam hardening, phase 2c)
--
-- Builds on 098 (queue_action + submit_vote already renamed to _impl, with thin
-- caller-bound wrappers). Here we REPLACE those wrappers with versions that also
-- validate the action server-side:
--   C3 (CRITICAL): queue_action trusted the client's cost + action + target, so a
--       NON-Murder could queue 'kill' (or 'sacrifice') and the resolver — which
--       only checks the action string, not the role — would execute it; a negative
--       cost minted Soul Energy. Now the action must match the caller's REAL role,
--       cost must be >= 0 and affordable, the caller must be alive/free, and it
--       must be the role_action phase.
--   H1: submit_vote let dead / imprisoned / hospitalised players vote. Now blocked.
--
-- ⚠️ APPLY AFTER 098 (these REPLACE the 098 wrappers and call the 098 *_impl).
-- ⚠️ AFTER APPLYING, smoke-test EVERY queueing role once — Murder (kill), Justice
--    (protect AND kill), Intoxication (intox), Vengeance (intox/hospitalise), Envy
--    (envy_swap), Torment (torment), Sacrifice (queued sacrifice), Vice Worshipper
--    + Virtue Seeker (guess) — a mis-mapped action would be wrongly rejected here.
--
-- STILL OPEN (deliberately deferred, lower risk first):
--   * Exact per-role cost is NOT yet enforced — a legitimate role can still queue
--     its OWN action for cost 0 (an SE-economy abuse, not arbitrary power). Deriving
--     the canonical cost server-side (from the MURDER_COST/INTOX_COST/... values) is
--     a follow-up that needs each value verified + retested.
--   * instant_sacrifice (C4) — needs your live signature (schema.sql is drifted).
--   * resolver phase-guards (idempotency race) — fold into the 097 wrappers later.

begin;

-- C3 — queue_action: validate cost + caller state + role↔action.
create or replace function queue_action(p_player_id uuid, p_cost numeric, p_action text, p_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text; v_se numeric; v_dead boolean; v_prison boolean; v_hosp boolean; v_phase text;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'invalid cost' using errcode = '22023'; end if;

  select s.role, p.soul_energy, p.dead, p.in_prison, p.in_hospital, r.phase
    into v_role, v_se, v_dead, v_prison, v_hosp, v_phase
  from players p
    join player_secrets s on s.player_id = p.id
    join rooms r on r.id = p.room_id
  where p.id = p_player_id;

  if v_role is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_phase is distinct from 'role_action' then raise exception 'wrong phase' using errcode = '42501'; end if;
  if v_dead or v_prison or v_hosp then raise exception 'cannot act' using errcode = '42501'; end if;
  if v_se < p_cost then raise exception 'insufficient soul energy' using errcode = '42501'; end if;

  -- The action must be one the caller's REAL role legitimately queues.
  if not (
       (p_action = 'kill'      and v_role in ('murder', 'justice'))
    or (p_action = 'protect'   and v_role = 'justice')
    or (p_action = 'intox'     and v_role in ('intoxication', 'vengeance'))
    or (p_action = 'envy_swap' and v_role = 'envy')
    or (p_action = 'torment'   and v_role = 'torment')
    or (p_action = 'sacrifice' and v_role = 'sacrifice')
    or (p_action like '%guess' and v_role in ('vice_worshipper', 'virtue_seeker'))
  ) then
    raise exception 'illegal action for role' using errcode = '42501';
  end if;

  perform queue_action_impl(p_player_id, p_cost, p_action, p_target);
end;
$$;

-- H1 — submit_vote: only living, free players may vote (caller binding from 098).
create or replace function submit_vote(p_player_id uuid, p_vote text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dead boolean; v_prison boolean; v_hosp boolean;
begin
  if not vv_is_me(p_player_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select dead, in_prison, in_hospital into v_dead, v_prison, v_hosp
  from players where id = p_player_id;
  if v_dead or v_prison or v_hosp then raise exception 'cannot vote' using errcode = '42501'; end if;
  perform submit_vote_impl(p_player_id, p_vote);
end;
$$;

commit;
