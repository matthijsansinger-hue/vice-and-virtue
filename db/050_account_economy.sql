-- ============================================
-- Account economy: currencies, account XP, Soul Shards, role unlocks
-- (migration 050) — batch 1a of the meta-progression layer.
-- ============================================
-- New account-level progression, kept in tables SEPARATE from `profiles`
-- so the client can't edit it directly: profiles has a "users update their
-- own profile" policy (fine for username/avatar/featured_badges), but
-- spendable currencies must only ever change through the SECURITY DEFINER
-- RPCs below. account_economy/account_role_unlocks therefore have NO client
-- insert/update policy — only the RPCs (which run as definer) write them.
--
-- Naming note: the in-MATCH ability resource is called "Soul Energy"
-- (players.soul_energy, reset every game). THIS account currency is "Souls"
-- — earned from Soul Shards, spent to unlock roles. Different thing,
-- different lifecycle, different name.

-- One row per account: balances + progression + daily-reward bookkeeping.
create table account_economy (
  user_id uuid primary key references auth.users(id) on delete cascade,
  souls integer not null default 0,            -- spent to unlock roles
  mano integer not null default 0,             -- spent on cosmetics (later batch)
  xp integer not null default 0,               -- account XP (level derived in TS)
  unopened_shards integer not null default 0,  -- Soul Shards earned, not yet opened
  last_daily_shard_date date,                  -- last day a daily-login shard was granted
  last_first_win_date date,                    -- last day a first-win shard was granted
  created_at timestamptz not null default now()
);

alter table account_economy enable row level security;

-- Read your own economy; all writes go through the SECURITY DEFINER RPCs.
create policy "read own economy"
  on account_economy for select
  using (auth.uid() = user_id);

-- Which roles an account has unlocked beyond the default starter set. The
-- default set (economy.ts DEFAULT_UNLOCKED_ROLES) is NOT stored here; only
-- roles unlocked beyond it get a row.
create table account_role_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,                          -- role id from roles.ts
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table account_role_unlocks enable row level security;

create policy "read own role unlocks"
  on account_role_unlocks for select
  using (auth.uid() = user_id);

-- Per-room match-reward ledger so match XP / first-win shards are granted at
-- most once per account per game, even if game_over re-triggers.
create table account_match_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

alter table account_match_rewards enable row level security;
-- No policies: written only by grant_match_rewards (SECURITY DEFINER).

-- Give every existing account an economy row.
insert into account_economy (user_id)
  select id from profiles
  on conflict (user_id) do nothing;

-- New sign-ups get a profile (existing trigger) AND an economy row.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  insert into public.account_economy (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
-- (trigger on_auth_user_created already calls handle_new_user on auth.users)

-- ---- Soul Shard: open one and roll its reward (server-side RNG) ----------
-- Always: consume one unopened shard + grant guaranteed XP. Then roll one
-- currency/role outcome:
--   0.1%  -> instantly unlock a random still-locked role (else Souls)
--   9%    -> Mano
--   ~90.9% -> Souls   (the stated 91/9/0.1 sums to 100.1%; Souls absorbs
--                      the 0.1% rounding so the total is exactly 100%)
-- Keyed on auth.uid() so a client can only open ITS OWN shards.
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
  v_kind text;
  v_amount int := 0;
  v_role text := null;
  v_locked text[];
  -- mirror roles.ts (ROLES) + economy.ts DEFAULT_UNLOCKED_ROLES
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_default text[] := array['truthfulness','torment','vengeance',
    'sacrifice','vice_worshipper','virtue_seeker'];
  c_xp constant int := 50;
  c_souls constant int := 25;
  c_mano constant int := 10;
  c_odds_role constant numeric := 0.001;
  c_odds_mano constant numeric := 0.09;
begin
  if v_user is null then
    return jsonb_build_object('kind', 'none');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.unopened_shards <= 0 then
    return jsonb_build_object('kind', 'none');
  end if;

  v_roll := random();

  if v_roll < c_odds_role then
    select array_agg(r) into v_locked
    from unnest(c_all_roles) r
    where not (r = any(c_default))
      and not exists (
        select 1 from account_role_unlocks u
        where u.user_id = v_user and u.role = r
      );
    if v_locked is null or array_length(v_locked, 1) is null then
      v_kind := 'souls'; v_amount := c_souls;            -- nothing left to unlock
    else
      v_role := v_locked[1 + floor(random() * array_length(v_locked, 1))::int];
      insert into account_role_unlocks (user_id, role) values (v_user, v_role)
        on conflict do nothing;
      v_kind := 'role';
    end if;
  elsif v_roll < c_odds_role + c_odds_mano then
    v_kind := 'mano'; v_amount := c_mano;
  else
    v_kind := 'souls'; v_amount := c_souls;
  end if;

  update account_economy set
    unopened_shards = unopened_shards - 1,
    xp = xp + c_xp,
    souls = souls + case when v_kind = 'souls' then v_amount else 0 end,
    mano = mano + case when v_kind = 'mano' then v_amount else 0 end
  where user_id = v_user
  returning * into v_row;

  return jsonb_build_object(
    'kind', v_kind,
    'amount', v_amount,
    'role', v_role,
    'xp_gained', c_xp,
    'souls', v_row.souls,
    'mano', v_row.mano,
    'xp', v_row.xp,
    'unopened_shards', v_row.unopened_shards
  );
end;
$$;

grant execute on function open_soul_shard() to authenticated;

-- ---- Daily-login shard (date-gated, idempotent per UTC day) ---------------
create or replace function claim_daily_login()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  v_granted boolean := false;
begin
  if v_user is null then
    return jsonb_build_object('granted', false, 'unopened_shards', 0);
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.last_daily_shard_date is null or v_row.last_daily_shard_date < current_date then
    update account_economy set
      unopened_shards = unopened_shards + 1,
      last_daily_shard_date = current_date
    where user_id = v_user
    returning * into v_row;
    v_granted := true;
  end if;

  return jsonb_build_object('granted', v_granted, 'unopened_shards', v_row.unopened_shards);
end;
$$;

grant execute on function claim_daily_login() to authenticated;

-- ---- Spend Souls to unlock a role (batch 1b shop) -------------------------
create or replace function unlock_role(p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row account_economy;
  c_all_roles text[] := array['murder','empathy','intoxication','justice','envy',
    'truthfulness','torment','vengeance','certainty','sacrifice',
    'vice_worshipper','virtue_seeker'];
  c_default text[] := array['truthfulness','torment','vengeance',
    'sacrifice','vice_worshipper','virtue_seeker'];
  c_cost constant int := 500;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if not (p_role = any(c_all_roles)) or (p_role = any(c_default)) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from account_role_unlocks where user_id = v_user and role = p_role) then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
  select * into v_row from account_economy where user_id = v_user for update;

  if v_row.souls < c_cost then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'souls', v_row.souls);
  end if;

  update account_economy set souls = souls - c_cost where user_id = v_user
  returning * into v_row;
  insert into account_role_unlocks (user_id, role) values (v_user, p_role)
    on conflict do nothing;

  return jsonb_build_object('ok', true, 'role', p_role, 'souls', v_row.souls);
end;
$$;

grant execute on function unlock_role(text) to authenticated;

-- ---- Host-side: per-match XP + first-win shard for account players --------
-- Mirrors grant_achievements: a SECURITY DEFINER RPC the host calls on
-- game-over to reward EVERY account player (RLS otherwise only lets a user
-- write their own row). Idempotent per (user, room) via the ledger insert.
-- p_awards = [{ "u": <user_id uuid>, "won": <bool> }, ...]
create or replace function grant_match_rewards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_user uuid;
  v_won boolean;
  c_match_xp constant int := 30;
  c_win_bonus constant int := 20;
begin
  for rec in select * from jsonb_array_elements(p_awards)
  loop
    v_user := (rec->>'u')::uuid;
    v_won := coalesce((rec->>'won')::boolean, false);
    if v_user is null then continue; end if;

    -- The ledger insert "claims" this game's reward; FOUND is true only when
    -- the row is new (a re-trigger conflicts -> 0 rows -> FOUND false).
    insert into account_match_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;

    if found then
      insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
      update account_economy set
        xp = xp + c_match_xp + case when v_won then c_win_bonus else 0 end,
        unopened_shards = unopened_shards + case
          when v_won and (last_first_win_date is null or last_first_win_date < current_date)
          then 1 else 0 end,
        last_first_win_date = case
          when v_won and (last_first_win_date is null or last_first_win_date < current_date)
          then current_date else last_first_win_date end
      where user_id = v_user;
    end if;
  end loop;
end;
$$;

grant execute on function grant_match_rewards(uuid, jsonb) to anon, authenticated;
