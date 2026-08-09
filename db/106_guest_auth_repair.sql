-- Migration 106 — Guest auth repair (+ live-db drift fixes)
--
-- ROOT CAUSE of "voting on someone in the imprisonment phase doesn't always
-- work" (and of guests seeing nothing happen when they act):
--
--   Anonymous sign-in has NEVER worked. handle_new_user() fires for EVERY new
--   auth user — anonymous included — and inserts profiles(id, username) with
--   username = raw_user_meta_data->>'username', which is NULL for anonymous
--   users. profiles.username is NOT NULL, so the trigger raises and auth
--   returns "Database error creating anonymous user". ensureSession() (auth.ts)
--   swallows that by design, so every GUEST browser silently plays with NO
--   session at all.
--
--   With the 096-099 caller gates live, a session-less browser is rejected
--   ('forbidden') by get_my_secrets / queue_action / submit_vote / etc. The
--   client ignores those rpc errors, so a guest's vote just vanishes. Logged-in
--   players are unaffected — which is exactly why it looked intermittent
--   ("doesn't ALWAYS work"): the account players' votes counted, the guests'
--   silently did not.
--
--   Verified against the live db 2026-08-09:
--     * signInAnonymously()                  -> "Database error creating anonymous user"
--     * signInAnonymously({username in meta}) -> succeeds  (so the trigger is the fault,
--                                                and the Anonymous provider IS enabled)
--     * session-less get_my_secrets / submit_vote / queue_action -> "forbidden"
--
-- THE user_id TRAP (why this migration adds a column):
--   Migration 096 set players.user_id DEFAULT auth.uid() so the gates could key
--   on it. But the whole codebase treats "players.user_id is not null" as
--   "this is a logged-in ACCOUNT" — stats.ts only writes game_results/ranked/
--   economy rewards for those players, Lobby shows the invite button + level
--   star + featured badges for them, GameOver lets them create the re-queue
--   lobby. Once anonymous sign-in starts working, a plain auth.uid() default
--   would stamp every GUEST with a uid and hand them all of that.
--
--   So: user_id goes back to meaning ACCOUNT ONLY, and a new players.auth_uid
--   carries the session identity (account or anonymous) that the gates check.

begin;

-- 1) Anonymous users get no profile / economy / ranked rows (account features).
--    Real sign-ups always pass a username (auth.ts signUp metadata).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ->> 'username' is null then
    return new;
  end if;
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  insert into public.account_economy (user_id) values (new.id)
  on conflict (user_id) do nothing;
  insert into public.account_ranked (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 2) Session identity, separate from account identity.
alter table players add column if not exists auth_uid uuid;
alter table players alter column auth_uid set default auth.uid();

-- Existing rows were stamped by 096's default: their user_id already holds the
-- session uid, and the gates below fall back to it, so games in progress keep
-- working across this migration.

-- 3) user_id means ACCOUNT again — stop auto-stamping it with the session uid.
alter table players alter column user_id drop default;

-- 4) The gates accept EITHER column.
--    * guest            -> auth_uid = their anon uid, user_id null
--    * account          -> both set
--    * ranked seat      -> inserted by ranked_form_match on behalf of OTHER
--                          users, so auth_uid holds the matchmaker's uid and is
--                          useless; user_id (their real account) is what matches
--    * pre-106 row      -> auth_uid null, user_id holds the session uid
--    auth.uid() is guarded non-null so a session-less caller can't match a
--    null column (NULL = NULL is NULL, not true, but be explicit).
create or replace function vv_is_me(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from players
    where id = p_player_id
      and auth.uid() is not null
      and (auth_uid = auth.uid() or user_id = auth.uid())
  );
$$;
grant execute on function vv_is_me(uuid) to anon, authenticated;

create or replace function vv_is_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from players
    where room_id = p_room_id
      and is_host
      and auth.uid() is not null
      and (auth_uid = auth.uid() or user_id = auth.uid())
  );
$$;
grant execute on function vv_is_host(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) DRIFT FIX: migration 069 was never applied to the live db. Verified live:
--    vv_config_slot('{"vice":{"S":"wrath"}}','vice','S','murder') returns
--    'murder' — i.e. the live copy is still 064's hardcoded 12-role allowlist,
--    so a host who configures any of the 8 unlockable roles into a random-mode
--    deal is silently ignored. Re-assert 069 (any role whose camp + tier match
--    the slot is valid; vv_role_camp/vv_role_tier know all 20 — verified live).
create or replace function vv_config_slot(
  p_config jsonb, p_camp text, p_tier text, p_default text
)
returns text
language sql
stable
as $$
  select case
    when (p_config #>> array[p_camp, p_tier]) is not null
     and vv_role_camp(p_config #>> array[p_camp, p_tier]) = p_camp
     and vv_role_tier(p_config #>> array[p_camp, p_tier]) = p_tier
    then p_config #>> array[p_camp, p_tier]
    else p_default
  end;
$$;

-- ---------------------------------------------------------------------------
-- 6) 099 REGRESSION: the hardened queue_action wrapper rejects any queueing
--    outside role_action — but Sacrifice legitimately queues from the STORE too
--    (migration 072: role-action + shop). Since 099 a shop sacrifice has been
--    silently rejected ('wrong phase'). Allow exactly that one action in that
--    one extra phase; everything else is unchanged from 099.
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
  if not (
       v_phase = 'role_action'
    or (v_phase = 'store' and p_action = 'sacrifice')
  ) then
    raise exception 'wrong phase' using errcode = '42501';
  end if;
  if v_dead or v_prison or v_hosp then raise exception 'cannot act' using errcode = '42501'; end if;
  if v_se < p_cost then raise exception 'insufficient soul energy' using errcode = '42501'; end if;

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
grant execute on function queue_action(uuid, numeric, text, text) to anon, authenticated;

commit;
