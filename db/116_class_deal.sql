-- Migration 116 — the deal moves from tiers to classes (batch 3)
--
-- Roles are now dealt ONE PER CLASS PER CAMP instead of one per S-D tier:
--
--   Vice   : Exterminators, Troublemakers, Obstructors, Manipulators
--   Virtue : Protectors,    Communicators, Seekers,     Catalysts
--
-- Exterminator/Protector are always dealt FIRST and the other three shuffled,
-- so every game has something that can kill and something that can save. A
-- camp of 2-3 players (small games) gets the guaranteed pair plus random
-- extras rather than risking a game that nothing can end.
--
-- SEATS BEYOND THE FOUR CLASSES are dealt the filler role (Vice Worshipper /
-- Virtue Seeker) outright and locked, exactly like the Wandering Soul. That is
-- deliberate: a filler seat has no class, so dropping it into role_select would
-- show the player an empty picker with nothing they could legally choose.
--
-- GENEROSITY BECOMES FREE. Protectors was the only class whose every member was
-- purchasable, so a free account dealt that class had nothing it could pick and
-- the entire class was unreachable without buying. Adding Generosity to the
-- starter set gives all eight classes at least one free role.
--
-- ⚠️ assign_roles_and_start_impl / select_role_impl / resolve_role_select_impl
-- below are the LIVE bodies (dumped from pg_proc) with only the class edits
-- applied. ranked_form_match and vv_role_tier had drifted from the repo, which
-- is why they were dumped rather than copied from db/.
--
-- ⚠️ vv_role_tier SURVIVES, deprecated, for exactly one reason: the Wrath/Love
-- conversion check in resolve_role_action_impl still reads "is the target
-- S-tier?" to decide immunity. Rewriting a 16 KB resolver to change one
-- comparison isn't worth the risk in the same migration as the deal, so that
-- moves to an explicit vv_role_immune() next. Behaviour is unaffected: the
-- immune four (Murder, Wrath, Empathy, Love) still return 'S', and Greed and
-- Sociability return null, so they are convertible as intended.
--
-- assigned_tier is left in place, unused, for the same "one risky change at a
-- time" reason; it can be dropped once a game cycle has run on classes.

begin;

-- The dealt class. Replaces assigned_tier as the thing role_select validates.
alter table player_secrets add column if not exists assigned_class text;

-- Role -> class. Null for the fillers and the anomaly, which sit outside the
-- one-per-class deal.
create or replace function vv_role_class(p_role text)
returns text
language sql
immutable
as $$
  select case p_role
    when 'murder' then 'exterminator'
    when 'fanaticism' then 'exterminator'
    when 'vengeance' then 'exterminator'
    when 'torment' then 'troublemaker'
    when 'gambling' then 'troublemaker'
    when 'intoxication' then 'obstructor'
    when 'pride' then 'obstructor'
    when 'greed' then 'obstructor'
    when 'wrath' then 'manipulator'
    when 'envy' then 'manipulator'
    when 'generosity' then 'protector'
    when 'determination' then 'protector'
    when 'truthfulness' then 'communicator'
    when 'sociability' then 'communicator'
    when 'empathy' then 'seeker'
    when 'certainty' then 'seeker'
    when 'diligence' then 'seeker'
    when 'love' then 'catalyst'
    when 'sacrifice' then 'catalyst'
    when 'justice' then 'catalyst'
    else null   -- vice_worshipper / virtue_seeker (fillers), wandering_soul
  end;
$$;

-- The host's random-mode config slot, now keyed on class. Parameter renamed,
-- which create-or-replace can't do, hence the drop.
drop function if exists vv_config_slot(jsonb, text, text, text);
create function vv_config_slot(
  p_config jsonb, p_camp text, p_class text, p_default text
)
returns text
language sql
stable
as $$
  select case
    when (p_config #>> array[p_camp, p_class]) is not null
     and vv_role_camp(p_config #>> array[p_camp, p_class]) = p_camp
     and vv_role_class(p_config #>> array[p_camp, p_class]) = p_class
    then p_config #>> array[p_camp, p_class]
    else p_default
  end;
$$;

-- The deal itself.
create or replace function assign_roles_and_start_impl(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_config jsonb;
  v_total int;
  v_soul int;     -- 1 on odd counts (the Wandering Soul), else 0
  v_rest int;
  v_vice int;
  v_virtue int;
  v_roles text[] := '{}';
  v_ids uuid[];
  v_vice_classes text[];
  v_virtue_classes text[];
  v_player record;
  v_i int := 1;
  v_j int;
  v_camp text;
  v_class text;
  v_filler text;
  -- Exterminator/Protector are dealt FIRST so every game has something that
  -- can kill and something that can save; the other three are shuffled for
  -- variety. A camp of 2-3 (small games) therefore always gets the guaranteed
  -- pair plus random extras, rather than risking a game nothing can end.
  c_vice_classes text[] := array['exterminator']
    || (select array_agg(c order by random())
        from unnest(array['troublemaker','obstructor','manipulator']) c);
  c_virtue_classes text[] := array['protector']
    || (select array_agg(c order by random())
        from unnest(array['communicator','seeker','catalyst']) c);
  -- Per-class defaults for the random deal, used when the host configured
  -- nothing for that slot. Every one is in the free starter set.
  c_vice_default jsonb := jsonb_build_object(
    'exterminator', 'murder', 'troublemaker', 'torment',
    'obstructor', 'intoxication', 'manipulator', 'envy');
  c_virtue_default jsonb := jsonb_build_object(
    'protector', 'generosity', 'communicator', 'truthfulness',
    'seeker', 'empathy', 'catalyst', 'justice');
begin
  select role_assign_mode, role_config into v_mode, v_config
  from rooms where id = p_room_id;

  select count(*) into v_total from players where room_id = p_room_id;
  -- Odd counts get one neutral Wandering Soul so the remainder splits evenly.
  v_soul := v_total % 2;
  v_rest := v_total - v_soul;
  v_vice := floor(v_rest / 2.0);
  v_virtue := v_rest - v_vice;

  if v_mode = 'choose' then
    -- Deal camps + tiers only; roles are picked live in role_select. The Soul
    -- (when present) is the first shuffled player: role auto-locked, no pick.
    select array_agg(id order by random()) into v_ids
    from players where room_id = p_room_id;

    -- One class per seat, in order, so the guaranteed pair lands first. Seats
    -- past the four classes get NULL and are dealt the filler role below.
    select array_agg(c_vice_classes[i] order by i) into v_vice_classes
    from generate_series(1, v_vice) i;
    select array_agg(c_virtue_classes[i] order by i) into v_virtue_classes
    from generate_series(1, v_virtue) i;

    for v_i in 1..v_total loop
      if v_soul = 1 and v_i = 1 then
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_class,
                                    role_choice)
        values (v_ids[1], 'wandering_soul', null, null, null, 'neutral', null,
                'wandering_soul')
        on conflict (player_id) do update
          set role = 'wandering_soul', vote = null, pending_action = null,
              pending_target = null, role_choice = 'wandering_soul',
              assigned_camp = 'neutral', assigned_class = null;
      else
        v_j := v_i - v_soul;  -- 1..v_rest
        v_camp := case when v_j <= v_vice then 'vice' else 'virtue' end;
        v_class := case when v_j <= v_vice then v_vice_classes[v_j]
                        else v_virtue_classes[v_j - v_vice] end;
        -- No class left for this seat: it's a filler. Deal the filler role
        -- outright and lock it (same shape as the Soul) instead of dropping the
        -- player into role_select with nothing they could possibly pick.
        v_filler := case when v_class is null then
          case when v_camp = 'virtue' then 'virtue_seeker' else 'vice_worshipper' end
        end;
        insert into player_secrets (player_id, role, vote, pending_action,
                                    pending_target, assigned_camp, assigned_class,
                                    role_choice)
        values (v_ids[v_i], v_filler, null, null, null, v_camp, v_class, v_filler)
        on conflict (player_id) do update
          set role = excluded.role, vote = null, pending_action = null,
              pending_target = null, role_choice = excluded.role_choice,
              assigned_camp = excluded.assigned_camp,
              assigned_class = excluded.assigned_class;
      end if;
      update players set soul_energy = 100, ready = false, has_voted = false
      where id = v_ids[v_i];
    end loop;

    update rooms set
      status = 'in_game', phase = 'role_select',
      phase_ends_at = now() + interval '30 seconds',
      role_pool = null, eye_uses_left = 1, free_uses_left = 1, winner = null
    where id = p_room_id;
    return;
  end if;

  -- 'random': secret deal. CLASS slots come from the host's config when valid.
  for i in 1..v_vice loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'vice', c_vice_classes[1],
                       c_vice_default #>> array[c_vice_classes[1]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[2],
                       c_vice_default #>> array[c_vice_classes[2]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[3],
                       c_vice_default #>> array[c_vice_classes[3]]),
        vv_config_slot(v_config, 'vice', c_vice_classes[4],
                       c_vice_default #>> array[c_vice_classes[4]])
      ])[i],
      'vice_worshipper'));
  end loop;
  for i in 1..v_virtue loop
    v_roles := array_append(v_roles, coalesce(
      (array[
        vv_config_slot(v_config, 'virtue', c_virtue_classes[1],
                       c_virtue_default #>> array[c_virtue_classes[1]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[2],
                       c_virtue_default #>> array[c_virtue_classes[2]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[3],
                       c_virtue_default #>> array[c_virtue_classes[3]]),
        vv_config_slot(v_config, 'virtue', c_virtue_classes[4],
                       c_virtue_default #>> array[c_virtue_classes[4]])
      ])[i],
      'virtue_seeker'));
  end loop;
  -- Odd count: add the neutral Wandering Soul to the deal.
  if v_soul = 1 then
    v_roles := array_append(v_roles, 'wandering_soul');
  end if;

  select array_agg(r order by random()) into v_roles from unnest(v_roles) r;

  v_i := 1;
  for v_player in select id from players where room_id = p_room_id loop
    insert into player_secrets (player_id, role, vote, pending_action,
                                pending_target, assigned_camp, assigned_class,
                                role_choice)
    values (v_player.id, v_roles[v_i], null, null, null, null, null, null)
    on conflict (player_id) do update
      set role = excluded.role, vote = null,
          pending_action = null, pending_target = null,
          assigned_camp = null, assigned_class = null, role_choice = null;
    update players set soul_energy = 100, ready = false, has_voted = false
    where id = v_player.id;
    v_i := v_i + 1;
  end loop;

  update rooms set
    status = 'in_game', phase = 'role_overview', phase_ends_at = null,
    role_pool = (select jsonb_agg(distinct r) from unnest(v_roles) r),
    eye_uses_left = 1, free_uses_left = 1, winner = null
  where id = p_room_id;
end;
$$;
revoke all on function assign_roles_and_start_impl(uuid) from public, anon, authenticated;
-- Role select: validate against the dealt class.
create or replace function select_role_impl(p_player_id uuid, p_role text, p_lock boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_class text; v_locked boolean;
  v_user uuid;
  c_default text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker','generosity'];  -- generosity is free so Protectors has a
                                    -- free option like every other class
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_class,
         (s.role is not null), p.user_id
    into v_room, v_phase, v_camp, v_class, v_locked, v_user
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_locked then
    return false;
  end if;
  -- Must be a real role matching the dealt camp + CLASS (an unknown id yields
  -- null from both lookups and fails either comparison). A filler seat has a
  -- null class and its role is already locked, so it never reaches here.
  if vv_role_camp(p_role) is distinct from v_camp
     or vv_role_class(p_role) is distinct from v_class then
    return false;
  end if;
  -- Beyond the default set, the player's account must have unlocked the role.
  if not (p_role = any(c_default)) then
    if v_user is null or not exists (
      select 1 from account_role_unlocks u
      where u.user_id = v_user and u.role = p_role
    ) then
      return false;
    end if;
  end if;

  update player_secrets
  set role_choice = p_role,
      role = case when p_lock then p_role else role end
  where player_id = p_player_id;
  return true;
end;
$$;
revoke all on function select_role_impl(uuid, text, boolean) from public, anon, authenticated;
-- Stragglers: a random free role of their class.
create or replace function resolve_role_select_impl(p_room_id uuid)
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
    'virtue_seeker','generosity'];
begin
  select phase into v_phase from rooms where id = p_room_id;
  if v_phase is distinct from 'role_select' then return; end if;

  for r in
    select p.id, s.assigned_camp, s.assigned_class, s.role_choice
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = p_room_id and s.role is null
  loop
    v_role := r.role_choice;
    if v_role is null then
      select x into v_role from unnest(c_playable) x
      where vv_role_camp(x) = r.assigned_camp and vv_role_class(x) = r.assigned_class
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
revoke all on function resolve_role_select_impl(uuid) from public, anon, authenticated;
-- Ranked deals classes too.
create or replace function ranked_form_match(p_mode text, p_n integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users uuid[];
  -- Same guaranteed-pair-then-shuffle rule as the casual deal, sliced to the
  -- mode's seat count. p_n = 5 (5v5) leaves one filler seat per camp.
  v_vice_classes text[] := (array['exterminator']
    || (select array_agg(c order by random())
        from unnest(array['troublemaker','obstructor','manipulator']) c))[1:p_n];
  v_virtue_classes text[] := (array['protector']
    || (select array_agg(c order by random())
        from unnest(array['communicator','seeker','catalyst']) c))[1:p_n];
  v_class text; v_camp text; v_filler text;
  v_code text; v_room_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_i int; v_name text; v_player_id uuid; v_user uuid;
begin
  select array_agg(user_id order by random()) into v_users
  from (select user_id from ranked_queue
        where status = 'waiting' and mode = p_mode
        order by joined_at limit 2 * p_n) q;

  if coalesce(array_length(v_users, 1), 0) < 2 * p_n then return null; end if;

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
    v_camp := case when v_i <= p_n then 'vice' else 'virtue' end;
    v_class := case when v_i <= p_n then v_vice_classes[v_i]
                    else v_virtue_classes[v_i - p_n] end;
    -- A seat past the four classes is a filler: deal the role outright so the
    -- player isn't sent to role_select with nothing to pick (mirrors casual).
    v_filler := case when v_class is null then
      case when v_camp = 'virtue' then 'virtue_seeker' else 'vice_worshipper' end
    end;
    insert into player_secrets (player_id, role, role_choice, assigned_camp, assigned_class)
    values (v_player_id, v_filler, v_filler, v_camp, v_class);
    update players set soul_energy = 100 where id = v_player_id;
  end loop;

  update ranked_queue set status = 'matched', room_code = v_code
  where user_id = any(v_users);

  return v_code;
end; 
$$;
grant execute on function ranked_form_match(text, integer) to anon, authenticated;
-- Generosity joins the free starter set, so every class has a free role. Also
-- stop unlock_role charging for a role that is now free.
create or replace function unlock_role(p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cost int := 1500;
  v_row account_economy;
  c_default text[] := array['murder','intoxication','envy','torment','vengeance',
    'vice_worshipper','empathy','justice','certainty','truthfulness','sacrifice',
    'virtue_seeker','generosity'];
  c_all_roles text[] := array[
    'murder','intoxication','envy','torment','vengeance','vice_worshipper',
    'empathy','justice','certainty','truthfulness','sacrifice','virtue_seeker',
    'wrath','love','gambling','determination','fanaticism','generosity','pride',
    'diligence','greed','sociability'];
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_role is null or not (p_role = any(c_all_roles)) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_role');
  end if;
  -- Free by default: nothing to buy (previously this would happily take 1500 LP
  -- for a role the account already had).
  if p_role = any(c_default) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;
  if exists (select 1 from account_role_unlocks where user_id = v_user and role = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;
  if v_row.life_experience < v_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'cost', v_cost);
  end if;

  update account_economy set life_experience = life_experience - v_cost
  where user_id = v_user;
  insert into account_role_unlocks (user_id, role) values (v_user, p_role)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'role', p_role, 'cost', v_cost);
end;
$$;
grant execute on function unlock_role(text) to authenticated;

-- The camp-gated, anonymous team panel: own dealt slot + team-mates' picks
-- by CLASS. Still no names or ids, so it can't out anyone.
create or replace function team_selections(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room uuid; v_phase text; v_camp text; v_class text; v_choice text; v_locked boolean;
  v_team jsonb;
begin
  select p.room_id, r.phase, s.assigned_camp, s.assigned_class, s.role_choice, (s.role is not null)
    into v_room, v_phase, v_camp, v_class, v_choice, v_locked
  from players p
    join rooms r on r.id = p.room_id
    join player_secrets s on s.player_id = p.id
  where p.id = p_player_id;

  if v_room is null or v_phase is distinct from 'role_select' or v_camp is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'class', t.assigned_class, 'choice', t.role_choice,
           'locked', t.locked, 'me', t.me)
           order by t.rank, t.created_at), '[]'::jsonb)
    into v_team
  from (
    select s.assigned_class, s.role_choice, (s.role is not null) as locked,
           (p.id = p_player_id) as me, p.created_at,
           -- Display order = the canonical class-pair order (the same top-to-
           -- bottom order as the Roles tab), NOT the shuffled deal order, so the
           -- team panel doesn't reshuffle between games. Filler seats sort last.
           case s.assigned_class
                when 'exterminator' then 0 when 'protector' then 0
                when 'troublemaker' then 1 when 'communicator' then 1
                when 'obstructor' then 2 when 'seeker' then 2
                when 'manipulator' then 3 when 'catalyst' then 3
                else 4 end as rank
    from players p join player_secrets s on s.player_id = p.id
    where p.room_id = v_room and s.assigned_camp = v_camp
  ) t;

  return jsonb_build_object(
    'camp', v_camp, 'class', v_class, 'choice', v_choice, 'locked', v_locked,
    'team', v_team);
end;
$$;
grant execute on function team_selections(uuid) to anon, authenticated;

commit;
