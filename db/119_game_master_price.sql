-- Migration 119 — the Game Master costs 1500 LP
--
-- The anomaly seat becomes the first place where what you can pick depends on
-- what you've bought. Two rules keep that fair:
--
--   * The Wandering Soul stays FREE, so the seat always has a legal pick. An
--     account that owns no anomaly can still play one.
--   * Everything else is checked against account_role_unlocks, including when
--     the server auto-resolves a player who ran out the clock — otherwise a
--     straggler would be handed a 1500 LP role for nothing.
--
-- Price is the flat 1500 every role costs (migration 115); all this adds is
-- game_master to the buyable list and the ownership checks around the seat.

begin;

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
  -- The anomaly seat (camp 'neutral') has no class: it picks among the anomaly
  -- roles instead. Anomalies are outside the unlock economy, so no ownership
  -- check applies to them.
  if v_camp = 'neutral' then
    if vv_role_camp(p_role) is distinct from 'neutral' then
      return false;
    end if;
    -- The Wandering Soul stays FREE so the anomaly seat always has something it
    -- can legally pick; every other anomaly must be unlocked on the account.
    -- Without that guarantee a free player dealt this seat would face an empty
    -- picker — the same trap the Protectors class had before Generosity was
    -- made free.
    if p_role <> 'wandering_soul' then
      if v_user is null or not exists (
        select 1 from account_role_unlocks u
        where u.user_id = v_user and u.role = p_role
      ) then
        return false;
      end if;
    end if;
    update player_secrets
    set role_choice = p_role,
        role = case when p_lock then p_role else role end,
        -- The Game Master's three lives are part of the role, so they're granted
        -- the moment it's locked in rather than at some later phase hook.
        extra_lives = case when p_lock and p_role = 'game_master'
                           then 3 else extra_lives end
    where player_id = p_player_id;
    return true;
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
    if v_role is null and r.assigned_camp = 'neutral' then
      -- An anomaly who never picked gets a random one they can actually USE:
      -- the free Soul always, plus any anomaly their account has unlocked.
      -- Handing someone a role they don't own would quietly give away a 1500 LP
      -- purchase.
      select x into v_role
      from unnest(array['wandering_soul','game_master']) x
      where x = 'wandering_soul'
         or exists (
           select 1 from players p2
           join account_role_unlocks u on u.user_id = p2.user_id and u.role = x
           where p2.id = r.id
         )
      order by random() limit 1;
    end if;
    if v_role is null then
      select x into v_role from unnest(c_playable) x
      where vv_role_camp(x) = r.assigned_camp and vv_role_class(x) = r.assigned_class
      order by random() limit 1;
    end if;
    if v_role is null then
      v_role := case when r.assigned_camp = 'virtue'
                     then 'virtue_seeker' else 'vice_worshipper' end;
    end if;
    update player_secrets
    set role = v_role, role_choice = v_role,
        extra_lives = case when v_role = 'game_master' then 3 else extra_lives end
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
    'diligence','greed','sociability','game_master'];
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

commit;
