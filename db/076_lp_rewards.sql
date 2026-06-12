-- ============================================
-- Migration 076 — per-match LP rewards: 9 win / 3 loss
-- ============================================
-- Lowers the Life Proficiency granted per finished game: +9 LP on a win, +3 LP
-- on a loss (were +20 / +10). XP rewards + the first-win-of-day shard are
-- unchanged. Only the two constants in grant_match_rewards change.
-- ============================================

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
      update account_economy set
        xp = xp + c_match_xp + case when v_won then c_win_bonus else 0 end,
        life_experience = life_experience + case when v_won then c_le_win else c_le_loss end,
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
