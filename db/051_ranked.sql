-- ============================================
-- Ranked ladder (migration 051) — batch 2 of the meta-progression layer.
-- ============================================
-- Five tiers (Earthen < Verdant < Primal < Noble < Divine), three divisions
-- each (Division 1 highest, 3 lowest), 100 points per division. Players gain/
-- lose points per ranked game; promotion needs a WIN while sitting at 100,
-- demotion a LOSS while sitting at 0 (no auto-move at the boundaries). Rank
-- state lives in account_ranked; only apply_ranked_results (host, SECURITY
-- DEFINER) mutates it.

-- A room flagged ranked applies ladder points at game end. (The dedicated
-- ranked queue, a later batch, will set this; a host lobby toggle sets it now.)
alter table rooms add column if not exists is_ranked boolean not null default false;

-- Safe re-run.
drop table if exists account_ranked_rewards cascade;
drop table if exists account_ranked cascade;

-- One row per account. tier_index 0=Earthen .. 4=Divine; division 1..3 (1
-- highest); points 0..100 within the division (numeric — point steps are
-- multiples of 2.5, so .5 values occur).
create table account_ranked (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tier_index integer not null default 0,        -- 0 Earthen .. 4 Divine
  division integer not null default 3,           -- 1 (top) .. 3 (bottom)
  points numeric not null default 0,             -- 0..100 within the division
  games integer not null default 0,
  wins integer not null default 0,
  created_at timestamptz not null default now()
);

alter table account_ranked enable row level security;

-- World-readable (rank isn't sensitive; eases friend-profile + leaderboard
-- display later). Writes go only through apply_ranked_results.
create policy "ranked readable by everyone"
  on account_ranked for select using (true);

-- Per-room ledger so a ranked result applies at most once per account per
-- game, even if game_over re-triggers.
create table account_ranked_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

alter table account_ranked_rewards enable row level security;
-- No policies: written only by apply_ranked_results (SECURITY DEFINER).

-- Give existing accounts a starting rank (Earthen, Division 3, 0 points).
insert into account_ranked (user_id)
  select id from profiles
  on conflict (user_id) do nothing;

-- New sign-ups: profile + economy (migration 050) + ranked rows.
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
  insert into public.account_ranked (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Apply a ranked game's results to each account player's ladder position.
-- Host-callable (mirrors grant_match_rewards). Idempotent per (user, room).
-- p_results = [{ "u": <user_id uuid>, "won": <bool>, "diff": <int >= 0> }, ...]
-- diff = |Vices remaining − Virtues remaining| at game end (the win margin):
--   win  -> +20 + 2.5*diff ; loss -> −(15 + 2.5*diff)
-- Promotion: a WIN while already at 100. Demotion: a LOSS while already at 0.
create or replace function apply_ranked_results(p_room_id uuid, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  v_user uuid;
  v_won boolean;
  v_diff numeric;
  v_tier int;
  v_div int;
  v_pts numeric;
  c_win_base   constant numeric := 20;
  c_loss_base  constant numeric := 15;
  c_per_diff   constant numeric := 2.5;
  c_demote_pts constant numeric := 75;   -- landing points after a demotion
begin
  for rec in select * from jsonb_array_elements(p_results)
  loop
    v_user := (rec->>'u')::uuid;
    v_won  := coalesce((rec->>'won')::boolean, false);
    v_diff := greatest(0, coalesce((rec->>'diff')::numeric, 0));
    if v_user is null then continue; end if;

    -- Claim this game's ranked update once per (user, room).
    insert into account_ranked_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;
    if not found then continue; end if;

    insert into account_ranked (user_id) values (v_user) on conflict (user_id) do nothing;
    select tier_index, division, points into v_tier, v_div, v_pts
    from account_ranked where user_id = v_user for update;

    if v_won then
      if v_pts >= 100 then
        -- promotion match won
        if v_div > 1 then
          v_div := v_div - 1; v_pts := 0;
        elsif v_tier < 4 then
          v_tier := v_tier + 1; v_div := 3; v_pts := 0;
        else
          v_pts := 100;   -- already Divine I at 100: apex, stay
        end if;
      else
        v_pts := least(100, v_pts + c_win_base + c_per_diff * v_diff);
      end if;
    else
      if v_pts <= 0 then
        -- demotion match lost
        if v_div < 3 then
          v_div := v_div + 1; v_pts := c_demote_pts;
        elsif v_tier > 0 then
          v_tier := v_tier - 1; v_div := 1; v_pts := c_demote_pts;
        else
          v_pts := 0;     -- already Earthen III at 0: floor, stay
        end if;
      else
        v_pts := greatest(0, v_pts - c_loss_base - c_per_diff * v_diff);
      end if;
    end if;

    update account_ranked set
      tier_index = v_tier,
      division = v_div,
      points = v_pts,
      games = games + 1,
      wins = wins + case when v_won then 1 else 0 end
    where user_id = v_user;
  end loop;
end;
$$;

grant execute on function apply_ranked_results(uuid, jsonb) to anon, authenticated;
