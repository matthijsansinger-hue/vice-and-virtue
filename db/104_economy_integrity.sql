-- Migration 104 — Economy integrity (untrusted-client / Steam hardening, phase 4)
--
-- Two audit findings on the account economy:
--
-- (1) grant_match_rewards(p_room_id, p_awards) trusted the CLIENT's award list:
--     each {u, won} came from the browser, so a client could pass won=true to
--     claim win rewards (XP / LP / Soul Fragments / level-up shards) for a game
--     it lost, or list non-participants. (Bounded to once per (user,room) by the
--     ledger, but still free currency.) Fix: ignore p_awards and derive winners
--     from the server-written game_results (migration 100's record_game_results,
--     which runs first in recordGameResults). The client signature is unchanged,
--     so no client edit is needed.
--
-- (2) grant_achievements(p_awards) was granted to anon/authenticated, so ANY
--     client could grant ANY badge key to ANY user. Its only client caller was
--     the now-dead endRoleAction; resolution badges, if granted, come from
--     SECURITY DEFINER resolvers (which keep access as the owner), and
--     self-detectable badges use awardAchievement's direct insert-your-own path.
--     So we simply revoke it from clients.
--
-- ⚠️ APPLY AFTER 100 (record_game_results must be writing game_results) +
--    anonymous auth. SQL-only; no client changes ship with this.
--
-- STILL OPEN (flagged, deliberately deferred — lower severity / need more care):
--   * user_achievements still has an insert-your-own policy, so a client can
--     self-grant any cosmetic badge KEY. Closing it needs a whitelist of the
--     self-claimable keys on the insert policy (vanity-only, no economy impact).
--   * apply_ranked_results still trusts client-supplied won/diff (ranked points).
--     Same server-derivation fix, but it needs its live rank-math body.

begin;

-- (1) Winners derived from game_results, not from the client's p_awards.
-- p_awards is now ignored (kept in the signature so the client call is unchanged).
create or replace function grant_match_rewards(p_room_id uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_user uuid;
  v_won boolean;
  c_match_xp constant int := 30;
  c_win_bonus constant int := 20;
  c_le_win constant int := 9;
  c_le_loss constant int := 3;
begin
  for rec in
    select user_id, bool_or(won) as won
    from game_results
    where room_id = p_room_id
    group by user_id
  loop
    v_user := rec.user_id;
    v_won := rec.won;

    insert into account_match_rewards (user_id, room_id)
    values (v_user, p_room_id)
    on conflict do nothing;

    if found then
      insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;
      -- All CASEs read the OLD row values, so they stay consistent within the
      -- one UPDATE. Shards = first-three-wins-of-day (077) + one per level
      -- crossed by this match's XP gain (080).
      update account_economy set
        xp = xp + c_match_xp + case when v_won then c_win_bonus else 0 end,
        life_experience = life_experience + case when v_won then c_le_win else c_le_loss end,
        unopened_shards = unopened_shards
          + case
              when v_won and (last_first_win_date is null or last_first_win_date < current_date
                              or daily_win_count < 3)
              then 1 else 0 end
          + greatest(0, vv_level_from_xp(xp + c_match_xp + case when v_won then c_win_bonus else 0 end)
                        - vv_level_from_xp(xp)),
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

-- (2) Lock the host-grant RPC away from clients (no live client caller; resolvers
-- run as owner and are unaffected).
revoke execute on function grant_achievements(jsonb) from anon, authenticated;

commit;
