-- ============================================
-- Soul Fragment rarity rework (migration 084)
-- ============================================
-- Replaces the old flat roll (0.1% role / 9% Mano / ~90.9% LP) with a five-tier
-- RARITY roll that reuses the badge/ranked/cosmetic tier names. Each rarity has
-- a Mano and an LP reward; the server picks one at random (50/50). Divine adds a
-- third option (instant role unlock) when a still-locked role exists — when the
-- account owns everything, Divine just rolls Mano vs LP like the others.
--
--   Rarity    Prob   Mano   LP     (Divine also: instant role unlock)
--   Earthen   50%     1      10
--   Verdant   28%     3      30
--   Primal    15%     8      80
--   Noble      6%    19     190
--   Divine     1%    50    1000
--
-- The guaranteed +50 account XP per fragment is unchanged. Mutations stay in
-- this SECURITY DEFINER RPC (keyed on auth.uid()) so balances can't be edited
-- client-side. Only open_soul_shard() changes; schema.sql mirrors this.

create or replace function open_soul_shard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  v_roll numeric;
  v_pick numeric;
  v_rarity text;
  v_kind text;
  v_amount int := 0;
  v_mano_amt int;
  v_le_amt int;
  v_role text := null;
  v_locked text[];
  v_has_locked boolean;
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker',
    'wrath','love','gambling','determination',
    'fanaticism','generosity','pride','diligence'];
  c_default text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_xp constant int := 50;
begin
  if v_user is null then
    return jsonb_build_object('kind', 'none');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.unopened_shards <= 0 then
    return jsonb_build_object('kind', 'none');
  end if;

  -- Roll the rarity tier (Earthen 50 / Verdant 28 / Primal 15 / Noble 6 / Divine 1).
  v_roll := random();
  if v_roll < 0.50 then
    v_rarity := 'earthen'; v_mano_amt := 1;  v_le_amt := 10;
  elsif v_roll < 0.78 then
    v_rarity := 'verdant'; v_mano_amt := 3;  v_le_amt := 30;
  elsif v_roll < 0.93 then
    v_rarity := 'primal';  v_mano_amt := 8;  v_le_amt := 80;
  elsif v_roll < 0.99 then
    v_rarity := 'noble';   v_mano_amt := 19; v_le_amt := 190;
  else
    v_rarity := 'divine';  v_mano_amt := 50; v_le_amt := 1000;
  end if;

  -- Still-locked roles a role-unlock could grant (Divine's third option only).
  select array_agg(r) into v_locked
  from unnest(c_all_roles) r
  where not (r = any(c_default))
    and not exists (
      select 1 from account_role_unlocks u
      where u.user_id = v_user and u.role = r
    );
  v_has_locked := v_locked is not null and array_length(v_locked, 1) is not null;

  -- Server picks the reward at random from the rarity's options. Divine offers a
  -- third option (role unlock) at equal weight, but only when something's locked.
  v_pick := random();
  if v_rarity = 'divine' and v_has_locked then
    if v_pick < 1.0/3.0 then
      v_kind := 'role';
    elsif v_pick < 2.0/3.0 then
      v_kind := 'mano'; v_amount := v_mano_amt;
    else
      v_kind := 'le'; v_amount := v_le_amt;
    end if;
  elsif v_pick < 0.5 then
    v_kind := 'mano'; v_amount := v_mano_amt;
  else
    v_kind := 'le'; v_amount := v_le_amt;
  end if;

  if v_kind = 'role' then
    v_role := v_locked[1 + floor(random() * array_length(v_locked, 1))::int];
    insert into account_role_unlocks (user_id, role) values (v_user, v_role)
      on conflict do nothing;
  end if;

  update account_economy set
    unopened_shards = unopened_shards - 1,
    xp = xp + c_xp,
    life_experience = life_experience + case when v_kind = 'le' then v_amount else 0 end,
    mano = mano + case when v_kind = 'mano' then v_amount else 0 end
  where user_id = v_user
  returning * into v_row;

  return jsonb_build_object(
    'kind', v_kind, 'amount', v_amount, 'role', v_role, 'rarity', v_rarity,
    'xp_gained', c_xp, 'le', v_row.life_experience, 'mano', v_row.mano,
    'xp', v_row.xp, 'unopened_shards', v_row.unopened_shards
  );
end;
$$;

grant execute on function open_soul_shard() to authenticated;
