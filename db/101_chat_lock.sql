-- Migration 101 — Lock the chat tables (untrusted-client / Steam hardening, phase 3b)
--
-- Audit finding (HIGH): all four chat tables had open `for all using(true) with
-- check(true)` policies, so any client could:
--   * READ the dead-only side channel while still alive (see the dead discussing
--     who's who), and read every other pair's private DMs;
--   * FORGE messages — insert as any sender_id, into any room, any camp
--     (messages.camp was even chosen by the client).
--
-- Fix: route the three live send paths through caller-gated SECURITY DEFINER RPCs
-- that bind the sender to auth.uid() (vv_is_me, migration 096), derive the room
-- server-side, and enforce who may speak; then replace the open policies with
-- scoped SELECT policies and remove the client write path entirely.
--
-- Read scoping:
--   * dead_messages         -> only players who are DEAD in that room
--   * dm_messages           -> only the two participants, OR a dead spectator in
--                              the room (the dead are omniscient by design;
--                              DeadSpectator reads dm_messages directly)
--   * consultation_messages -> anyone in the room (it's the public meeting chat)
--   * messages (camp chat)  -> anyone in the room. This table is DEAD (nothing
--                              writes it since the 056 Worshipper/Seeker rework;
--                              sendCampMessage has no callers), so we only lock
--                              its write path; the read policy is a formality.
--
-- ⚠️ APPLY AFTER 096 + anonymous auth live + player rows carry user_id. The
--    policies key on `players.user_id = auth.uid()`; a row with NULL user_id
--    (auth not yet live, or a pre-auth in-progress game) would be unable to read
--    or send chat. Finish/restart any in-progress game after applying.
-- ⚠️ This also tightens REALTIME: postgres_changes honours RLS, so dead-chat now
--    only pushes to the dead, DMs only to participants, etc. Smoke-test each chat
--    surface (camp panel, outreach DMs, consultation chat, dead chat + the dead
--    spectator's DM view) on two clients after applying.

begin;

-- ── Send RPCs (caller-bound; room derived from the sender) ────────────────────

-- 1-on-1 outreach DM. Sender must own the row and not be dead; recipient must be
-- in the same room. p_room_id is validated against the sender's real room.
create or replace function send_dm(
  p_room_id uuid, p_sender_id uuid, p_recipient_id uuid, p_day int, p_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_dead boolean; v_rec_room uuid;
begin
  if not vv_is_me(p_sender_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_text is null or length(btrim(p_text)) = 0 then return; end if;
  select room_id, dead into v_room, v_dead from players where id = p_sender_id;
  if v_room is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_room is distinct from p_room_id then raise exception 'wrong room' using errcode = '42501'; end if;
  if v_dead then raise exception 'cannot chat' using errcode = '42501'; end if;
  select room_id into v_rec_room from players where id = p_recipient_id;
  if v_rec_room is distinct from v_room then raise exception 'recipient not in room' using errcode = '42501'; end if;
  insert into dm_messages (room_id, sender_id, recipient_id, day, text)
  values (v_room, p_sender_id, p_recipient_id, p_day, p_text);
end;
$$;
grant execute on function send_dm(uuid, uuid, uuid, int, text) to anon, authenticated;

-- Dead-only side channel. Sender must own the row AND be dead.
create or replace function send_dead_message(p_room_id uuid, p_sender_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_dead boolean;
begin
  if not vv_is_me(p_sender_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_text is null or length(btrim(p_text)) = 0 then return; end if;
  select room_id, dead into v_room, v_dead from players where id = p_sender_id;
  if v_room is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_room is distinct from p_room_id then raise exception 'wrong room' using errcode = '42501'; end if;
  if not v_dead then raise exception 'dead chat is for the dead' using errcode = '42501'; end if;
  insert into dead_messages (room_id, sender_id, text)
  values (v_room, p_sender_id, p_text);
end;
$$;
grant execute on function send_dead_message(uuid, uuid, text) to anon, authenticated;

-- Public consultation chat. Sender must own the row and not be dead (the dead
-- have their own channel; hospital/prison may still speak here).
create or replace function send_consultation_message(p_room_id uuid, p_sender_id uuid, p_day int, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_room uuid; v_dead boolean;
begin
  if not vv_is_me(p_sender_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_text is null or length(btrim(p_text)) = 0 then return; end if;
  select room_id, dead into v_room, v_dead from players where id = p_sender_id;
  if v_room is null then raise exception 'no such player' using errcode = '42501'; end if;
  if v_room is distinct from p_room_id then raise exception 'wrong room' using errcode = '42501'; end if;
  if v_dead then raise exception 'cannot chat' using errcode = '42501'; end if;
  insert into consultation_messages (room_id, sender_id, day, text)
  values (v_room, p_sender_id, p_day, p_text);
end;
$$;
grant execute on function send_consultation_message(uuid, uuid, int, text) to anon, authenticated;

-- ── Scoped read policies (writes now only via the RPCs above) ─────────────────

drop policy if exists "open access to dead_messages" on dead_messages;
create policy "dead chat readable by the dead" on dead_messages
  for select using (
    exists (
      select 1 from players p
      where p.room_id = dead_messages.room_id
        and p.user_id = auth.uid()
        and p.dead
    )
  );

drop policy if exists "open access to dm_messages" on dm_messages;
create policy "dm readable by participants or dead spectators" on dm_messages
  for select using (
    exists (
      select 1 from players p
      where p.user_id = auth.uid()
        and (p.id = dm_messages.sender_id or p.id = dm_messages.recipient_id)
    )
    or exists (
      select 1 from players p
      where p.room_id = dm_messages.room_id
        and p.user_id = auth.uid()
        and p.dead
    )
  );

drop policy if exists "open access to consultation_messages" on consultation_messages;
create policy "consultation chat readable in room" on consultation_messages
  for select using (
    exists (
      select 1 from players p
      where p.room_id = consultation_messages.room_id
        and p.user_id = auth.uid()
    )
  );

-- Dead camp-chat table: lock writes (nothing writes it anymore), keep a scoped read.
drop policy if exists "open access to messages" on messages;
create policy "camp chat readable in room" on messages
  for select using (
    exists (
      select 1 from players p
      where p.room_id = messages.room_id
        and p.user_id = auth.uid()
    )
  );

commit;
