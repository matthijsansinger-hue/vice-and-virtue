-- Migration 100 — Lock game_results writes (untrusted-client / Steam hardening, phase 3a)
--
-- Audit finding (HIGH): game_results had an open `for all using(true) with
-- check(true)` policy, and the host's client wrote it directly (stats.ts:
-- delete-by-room then insert client-computed rows). So ANY client could:
--   * insert arbitrary winning rows for itself in any room  -> fake leaderboard
--     standing, fake per-role win badges, inflated profile stats;
--   * delete any room's rows                                -> wipe history.
--
-- Fix: route the write through a host-gated SECURITY DEFINER RPC that re-derives
-- every row from the locked player_secrets (server-side roles), and drop the
-- table's write policy so the client can no longer touch it. SELECT stays open:
-- finished-game role/camp/won is already shown publicly (profiles + leaderboard),
-- and friends "games together" reads other accounts' rows by user_id.
--
-- ⚠️ APPLY AFTER 096 (needs vv_is_host) and after anonymous auth is live + player
--    rows carry user_id (so vv_is_host matches the host). Same prerequisite as 097.
--
-- RESIDUAL (closed later by the server-authority phase): the winning camp is still
-- asserted by the host (p_winner) and `status='ended'` is still host-set (rooms is
-- writable until the rooms lock), so a host could mislabel the winner of THEIR OWN
-- finished game. The unbounded-fabrication vector (any client, any rows, any room)
-- is closed here; trustless winner derivation arrives with the rooms lock.

begin;

-- Host-gated, server-deriving writer. Rows come from player_secrets (the roles a
-- client never sees), not from the caller, so wins can't be invented.
create or replace function record_game_results(p_room_id uuid, p_winner text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not vv_is_host(p_room_id) then
    raise exception 'not host' using errcode = '42501';
  end if;
  if p_winner is null or p_winner not in ('vice', 'virtue', 'neutral') then
    raise exception 'invalid winner' using errcode = '22023';
  end if;
  -- Only record for a genuinely finished game.
  if not exists (select 1 from rooms where id = p_room_id and status = 'ended') then
    raise exception 'game not ended' using errcode = '42501';
  end if;

  -- Idempotent: clear any prior rows for this room first (a re-trigger of
  -- game-over must not double-count).
  delete from game_results where room_id = p_room_id;

  -- One row per account-linked player; camp + won derived server-side.
  insert into game_results (user_id, room_id, role, camp, won)
  select p.user_id,
         p_room_id,
         s.role,
         vv_role_camp(s.role),
         coalesce(vv_role_camp(s.role) = p_winner, false)
  from players p
  join player_secrets s on s.player_id = p.id
  where p.room_id = p_room_id
    and p.user_id is not null
    and s.role is not null;
end;
$$;

grant execute on function record_game_results(uuid, text) to anon, authenticated;

-- Lock the table: keep it world-readable (public profiles / leaderboard /
-- friends games-together), but remove the write path — only the RPC writes now
-- (SECURITY DEFINER bypasses RLS for the table owner, like the economy RPCs).
drop policy if exists "open access to game_results" on game_results;
create policy "game_results are world-readable" on game_results
  for select using (true);

commit;
