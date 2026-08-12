-- Migration 109 — Repair chat reads for guests (follow-up to 101 + 106)
--
-- Bug (HIGH, player-visible): guests could SEND chat but never READ any of it.
--   * A dead player saw "No chats yet today." in the outreach spectator view.
--   * A jailed player saw the thread open but no incoming messages — and not
--     even their own sent ones.
--
-- Root cause: migration 101 scoped the four chat SELECT policies on
-- `players.user_id = auth.uid()`. Migration 106 then repurposed that column —
-- `user_id` became ACCOUNT-only (NULL for guests, because stats.ts and friends
-- read it as "is this a real account"), and the SESSION identity moved to the
-- new `players.auth_uid`. So for every guest seat the policies matched nothing.
-- 101's own header even called this out: "a row with NULL user_id ... would be
-- unable to read or send chat." 106 fixed vv_is_me/vv_is_host for exactly this
-- reason but did not carry the same fix into 101's inline policy predicates.
--
-- Sends kept working the whole time because send_dm / send_dead_message /
-- send_consultation_message go through vv_is_me, which 106 DID repair. That
-- asymmetry is what made it look like "chat half-works".
--
-- Fix: match EITHER column, identically to how 106 redefined vv_is_me:
--     (p.auth_uid = auth.uid() or p.user_id = auth.uid())
-- Account players match on either (join sets both), guests match on auth_uid.
-- An unauthenticated caller still matches nothing: auth.uid() is NULL and
-- `NULL = NULL` is NULL, not true, so the policies stay closed.
--
-- This also repairs REALTIME, which is the half users actually notice.
-- postgres_changes honours RLS, so a guest's dm_messages INSERT subscription
-- was silently delivering zero rows — hence "they don't see incoming messages".
--
-- Idempotent: safe to re-run.

begin;

-- ── Chat read policies, re-scoped to the session identity ─────────────────────

drop policy if exists "dead chat readable by the dead" on dead_messages;
create policy "dead chat readable by the dead" on dead_messages
  for select using (
    exists (
      select 1 from players p
      where p.room_id = dead_messages.room_id
        and (p.auth_uid = auth.uid() or p.user_id = auth.uid())
        and p.dead
    )
  );

drop policy if exists "dm readable by participants or dead spectators" on dm_messages;
create policy "dm readable by participants or dead spectators" on dm_messages
  for select using (
    -- the two people in the conversation
    exists (
      select 1 from players p
      where (p.auth_uid = auth.uid() or p.user_id = auth.uid())
        and (p.id = dm_messages.sender_id or p.id = dm_messages.recipient_id)
    )
    -- or any dead player in that room (the dead are omniscient by design;
    -- DeadSpectator reads dm_messages directly to build the outreach threads)
    or exists (
      select 1 from players p
      where p.room_id = dm_messages.room_id
        and (p.auth_uid = auth.uid() or p.user_id = auth.uid())
        and p.dead
    )
  );

drop policy if exists "consultation chat readable in room" on consultation_messages;
create policy "consultation chat readable in room" on consultation_messages
  for select using (
    exists (
      select 1 from players p
      where p.room_id = consultation_messages.room_id
        and (p.auth_uid = auth.uid() or p.user_id = auth.uid())
    )
  );

drop policy if exists "camp chat readable in room" on messages;
create policy "camp chat readable in room" on messages
  for select using (
    exists (
      select 1 from players p
      where p.room_id = messages.room_id
        and (p.auth_uid = auth.uid() or p.user_id = auth.uid())
    )
  );

-- ── Same class of bug, same root cause: claim_requeue (migration 103) ─────────
-- Gated on `user_id is not null and user_id = auth.uid()`, so a guest could
-- never claim their finished room's re-queue slot ("Play again" did nothing).
-- On Steam every player is a guest until they make an account, so this would
-- have hit essentially the whole desktop audience.
create or replace function claim_requeue(p_room_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  if not exists (
    select 1 from players
    where room_id = p_room_id
      and (auth_uid = auth.uid() or user_id = auth.uid())
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update rooms set next_room_code = p_code
  where id = p_room_id and next_room_code is null;
  select next_room_code into v_code from rooms where id = p_room_id;
  return v_code;
end;
$$;
grant execute on function claim_requeue(uuid, text) to anon, authenticated;

commit;
