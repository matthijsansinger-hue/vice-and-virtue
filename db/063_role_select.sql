-- ============================================
-- Live role selection (migration 063) — ranked flow rework, batch 1.
-- ============================================
-- Ranked no longer asks for a side in the queue or a pre-game loadout. When a
-- match forms, every player is dealt a CAMP and a TIER (secretly, in
-- player_secrets); the room opens in a new `role_select` phase (30s) where each
-- player picks their role within their assigned camp+tier. Picks are tentative
-- (role_choice, visible to camp-mates anonymously by tier) until locked
-- (player_secrets.role set). When everyone locks — or the timer expires and the
-- host resolves — the room moves to a new `role_overview` phase (all roles in
-- this game, by camp), then lore_intro, then STRAIGHT to role_action: rooms
-- with role_assign_mode='choose' skip role_reveal (you picked your card).
--
-- New columns: rooms.role_assign_mode ('random' default | 'choose'),
-- rooms.role_config (host per-tier config for random mode — wired in the next
-- batch), player_secrets.assigned_camp / assigned_tier / role_choice.
-- New RPCs: select_role, team_selections (camp-gated, anonymous),
-- roles_select_ready, resolve_role_select. Reworked: join_ranked_queue (no
-- side), ranked_queue_counts, ranked_form_match (deals camps+tiers, opens in
-- role_select). The old loadout machinery (account_role_config /
-- assign_camp_roles) is no longer called — left as dead code.

alter table rooms
  add column if not exists role_assign_mode text not null default 'random',
  add column if not exists role_config jsonb;

alter table player_secrets
  add column if not exists assigned_camp text,
  add column if not exists assigned_tier text,
  add column if not exists role_choice text;

-- ---- Ranked queue: drop the side pick ------------------------------------
alter table ranked_queue alter column side drop not null;

-- Drop BOTH old signatures: the 3-arg (mode, side, name) from migration 054
-- AND the 2-arg (side, name) leftover from 053 — 054 never dropped it, and its
-- (text, text) signature clashes with the new (mode, name) one (Postgres can't
-- rename parameters via CREATE OR REPLACE).
drop function if exists join_ranked_queue(text, text, text);
drop function if exists join_ranked_queue(text, text);
create or replace function join_ranked_queue(p_mode text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  if p_mode not in ('3v3', '5v5') then return; end if;
  insert into ranked_queue (user_id, mode, side, name, status, room_code, joined_at)
  values (v_user, p_mode, null, coalesce(nullif(btrim(p_name), ''), 'Player'),
          'waiting', null, now())
  on conflict (user_id) do update
    set mode = excluded.mode, side = null, name = excluded.name,
        status = 'waiting', room_code = null, joined_at = now();
end; $$;
grant execute on function join_ranked_queue(text, text) to authenticated;

create or replace function ranked_queue_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    '3v3', count(*) filter (where mode = '3v3' and status = 'waiting'),
    '5v5', count(*) filter (where mode = '5v5' and status = 'waiting')
  ) from ranked_queue;
$$;
grant execute on function ranked_queue_counts() to authenticated;

-- ---- Match formation: deal camps + tiers, open in role_select -------------
-- Takes the 2N longest-waiting players of the mode (no sides), randomly splits
-- them into camps, and deals each camp the tier list S,A,B(,C,D) shuffled.
-- Roles stay NULL until the players pick them in the role_select phase.
create or replace function ranked_form_match(p_mode text, p_n int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_users uuid[];
  v_tiers text[] := (array['S','A','B','C','D'])[1:p_n];
  v_vice_tiers text[]; v_virtue_tiers text[];
  v_code text; v_room_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_i int; v_name text; v_player_id uuid; v_user uuid;
begin
  select array_agg(user_id order by random()) into v_users
  from (select user_id from ranked_queue
        where status = 'waiting' and mode = p_mode
        order by joined_at limit 2 * p_n) q;

  if coalesce(array_length(v_users, 1), 0) < 2 * p_n then return null; end if;

  select array_agg(t order by random()) into v_vice_tiers from unnest(v_tiers) t;
  select array_agg(t order by random()) into v_virtue_tiers from unnest(v_tiers) t;

  loop
    v_code := '';
    for v_i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into rooms (code, is_public, is_ranked, status, phase, phase_ends_at,
                         role_assign_mode, eye_uses_left, free_uses_left)
      values (v_code, false, true, 'in_game', 'role_select',
              now() + interval '30 seconds', 'choose', 1, 1)
      returning id into v_room_id;
      exit;
    exception when unique_violation then
    end;
  end loop;

  for v_i in 1..(2 * p_n) loop
    v_user := v_users[v_i];
    select name into v_name from ranked_queue where user_id = v_user;
    insert into players (room_id, user_id, name, is_host)
    values (v_room_id, v_user, v_name, v_i = 1)
    returning id into v_player_id;
    insert into player_secrets (player_id, role, assigned_camp, assigned_tier)
    values (v_player_id, null,
            case when v_i <= p_n then 'vice' else 'virtue' end,
            case when v_i <= p_n then v_vice_tiers[v_i] else v_virtue_tiers[v_i - p_n] end);
    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_users);

  return v_code;
end; $$;

-- ---- Role selection RPCs ---------------------------------------------------
-- Tentative pick (p_lock=false) or final lock (p_lock=true). Validated against
-- the caller's dealt camp+tier and the playable role set (the 8 collection-only
-- roles can't be picked until their gameplay exists). Locked picks are final.
create or replace function select_role(p_player_id uuid, p_role text, p_lock boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_tier text; v_locked boolean;
  c_playable text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker'];
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_tier, (s.role is not null)
    into v_room, v_phase, v_camp, v_tier, v_locked
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_locked then
    return false;
  end if;
  if not (p_role = any(c_playable))
     or vv_role_camp(p_role) is distinct from v_camp
     or vv_role_tier(p_role) is distinct from v_tier then
    return false;
  end if;

  update player_secrets
  set role_choice = p_role,
      role = case when p_lock then p_role else role end
  where player_id = p_player_id;
  return true;
end;
$$;
grant execute on function select_role(uuid, text, boolean) to anon, authenticated;

-- The caller's camp's selection state, ANONYMOUS by tier (no names/ids), so
-- the team can coordinate composition without learning who their camp-mates
-- are. Only returns data during the role_select phase.
create or replace function team_selections(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_tier text; v_choice text; v_locked boolean;
  v_team jsonb;
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_tier, s.role_choice, (s.role is not null)
    into v_room, v_phase, v_camp, v_tier, v_choice, v_locked
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_camp is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tier', t.assigned_tier, 'choice', t.role_choice,
           'locked', t.locked, 'me', t.me)
           order by t.rank, t.created_at), '[]'::jsonb)
    into v_team
  from (
    select s.assigned_tier, s.role_choice, (s.role is not null) as locked,
           (p.id = p_player_id) as me, p.created_at,
           case s.assigned_tier when 'S' then 0 when 'A' then 1
                when 'B' then 2 when 'C' then 3 else 4 end as rank
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = v_room and s.assigned_camp = v_camp
  ) t;

  return jsonb_build_object(
    'camp', v_camp, 'tier', v_tier, 'choice', v_choice, 'locked', v_locked,
    'team', v_team);
end;
$$;
grant execute on function team_selections(uuid) to anon, authenticated;

-- Whether every player in the room has locked a role (host early-advance).
create or replace function roles_select_ready(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from players where room_id = p_room_id)
     and not exists (
       select 1 from players p join player_secrets s on s.player_id = p.id
       where p.room_id = p_room_id and s.role is null);
$$;
grant execute on function roles_select_ready(uuid) to anon, authenticated;

-- Ends the role_select phase: stragglers get their tentative pick, else a
-- random playable role of their dealt camp+tier; publishes role_pool; moves to
-- role_overview. Idempotent (only acts while the room is in role_select).
create or replace function resolve_role_select(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase text;
  v_role text;
  r record;
  c_playable text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker'];
begin
  select phase into v_phase from rooms where id = p_room_id;
  if v_phase is distinct from 'role_select' then return; end if;

  for r in
    select p.id, s.assigned_camp, s.assigned_tier, s.role_choice
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is null
  loop
    v_role := r.role_choice;
    if v_role is null then
      select x into v_role from unnest(c_playable) x
      where vv_role_camp(x) = r.assigned_camp and vv_role_tier(x) = r.assigned_tier
      order by random() limit 1;
    end if;
    if v_role is null then
      v_role := case when r.assigned_camp = 'virtue'
                     then 'virtue_seeker' else 'vice_worshipper' end;
    end if;
    update player_secrets set role = v_role, role_choice = v_role
    where player_id = r.id;
  end loop;

  update rooms set role_pool = (
    select jsonb_agg(distinct s.role)
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is not null
  ) where id = p_room_id;

  update players set ready = false where room_id = p_room_id;
  update rooms set phase = 'role_overview', phase_ends_at = null
  where id = p_room_id;
end;
$$;
grant execute on function resolve_role_select(uuid) to anon, authenticated;
