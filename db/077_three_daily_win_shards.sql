-- ============================================
-- Migration 077 — a Soul Fragment for each of your first 3 wins of the day
-- ============================================
-- Was: 1 shard on the first win of the day. Now: the first THREE wins of the
-- day each mint a shard. `daily_win_count` tracks today's wins on
-- last_first_win_date (reset when the date rolls over). Other rewards (LP/XP)
-- are unchanged.
-- ============================================

alter table account_economy add column if not exists daily_win_count integer not null default 0;

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
  c_le_win constant int := 9;
  c_le_loss constant int := 3;
begin
  for rec in select * from jsonb_array_elements(p_awards)
  loop
    v_user := (rec->>'u')::uuid;
    v_won := coalesce((rec->>'won')::boolean, false);
    if v_user is null then continue; end if;

    insert into account_match_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;

    if found then
      insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
      -- Win shard: the first THREE wins of the day each mint a Soul Fragment.
      -- daily_win_count tracks today's wins (reset when last_first_win_date
      -- rolls to a new day). All CASEs read the OLD row values, so they stay
      -- consistent within the one UPDATE.
      update account_economy set
        xp = xp + c_match_xp + case when v_won then c_win_bonus else 0 end,
        life_experience = life_experience + case when v_won then c_le_win else c_le_loss end,
        unopened_shards = unopened_shards + case
          when v_won and (last_first_win_date is null or last_first_win_date < current_date
                          or daily_win_count < 3)
          then 1 else 0 end,
        daily_win_count = case
          when not v_won then daily_win_count
          when last_first_win_date is null or last_first_win_date < current_date then 1
          when daily_win_count < 3 then daily_win_count + 1
          else daily_win_count end,
        last_first_win_date = case when v_won then current_date else last_first_win_date end
      where user_id = v_user;
    end if;
  end loop;
end;
$$;

grant execute on function grant_match_rewards(uuid, jsonb) to anon, authenticated;
