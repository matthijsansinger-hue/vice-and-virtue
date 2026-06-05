-- 039_requeue.sql
-- "Play again" / re-queue from the end screen. When the first player re-queues,
-- a fresh lobby is created and its code is recorded here on the finished room,
-- so everyone else who taps re-queue joins the same new lobby. Nullable; set
-- once and read by the other end-screen clients via realtime.
alter table rooms
  add column if not exists next_room_code text;
