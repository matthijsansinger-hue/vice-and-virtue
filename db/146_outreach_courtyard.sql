-- 146: the Outreach courtyard map.
--
-- Outreach now shows the courtyard as a map: every living player stands in it
-- (avatar + this game's name bar), and the people who are talking to each
-- other gather together so EVERYONE can see who is talking (Matthijs,
-- 2026-11-11). Messages stay private — dm_messages is still readable only by
-- its two players and the dead (migration 101) — so outreach_state, which
-- every Outreach screen already polls every 3 s, now also returns `talks`:
-- one entry per pair of players who exchanged a message today, with who wrote
-- first (`a`, to `b`) and when (`at`), never the text. Only during the
-- outreach phase.
--
-- Note: this makes today's who-talked-to-whom public during Outreach, where
-- the court record (136) only showed it once court was in session.
--
-- Same function as 144 otherwise. Mirrored into db/schema.sql.

create or replace function outreach_state(p_room_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r rooms%rowtype; v_by uuid; v_used integer; v_to jsonb; v_started uuid; v_free boolean;
begin
  if not vv_is_me(p_viewer_id)
     or not exists (select 1 from players where id = p_viewer_id and room_id = p_room_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from rooms where id = p_room_id;

  if r.phase in ('outreach', 'store', 'store_summary', 'consultation', 'new_day') then
    select player_id into v_by from day_powers
     where room_id = p_room_id and day = r.day and power = 'pride_broadcast'
     limit 1;
  end if;

  select coalesce(sum(length(text)), 0)::integer into v_used
    from dm_messages where room_id = p_room_id and day = r.day and sender_id = p_viewer_id;
  select coalesce(jsonb_object_agg(recipient_id, n), '{}'::jsonb) into v_to
    from (select recipient_id, sum(length(text))::integer as n
            from dm_messages
           where room_id = p_room_id and day = r.day and sender_id = p_viewer_id
           group by recipient_id) x;
  -- The chat the viewer started (wrote first, before any word from them).
  select m.recipient_id into v_started
    from dm_messages m
   where m.room_id = p_room_id and m.day = r.day and m.sender_id = p_viewer_id
     and not exists (select 1 from dm_messages x
                      where x.room_id = p_room_id and x.day = r.day
                        and x.sender_id = m.recipient_id and x.recipient_id = p_viewer_id
                        and x.created_at < m.created_at)
   order by m.created_at
   limit 1;

  -- Sociability and a Communication-potion buyer may start chats with everyone.
  select coalesce(s.potion_comms, false) or s.role = 'sociability' into v_free
    from player_secrets s where s.player_id = p_viewer_id;

  return jsonb_build_object(
    'day', r.day,
    -- Never who: the screen says "Pride", and only Pride is told it's him.
    'broadcast', case when v_by is null then null else jsonb_build_object(
      'mine', v_by = p_viewer_id,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'text', b.text, 'at', b.created_at)
                         order by b.created_at)
          from outreach_broadcast b
         where b.room_id = p_room_id and b.day = r.day), '[]'::jsonb),
      'used', (select coalesce(sum(length(text)), 0)::integer from outreach_broadcast b
                where b.room_id = p_room_id and b.day = r.day)) end,
    'limits', jsonb_build_object(
      'total', vv_outreach_n('total'), 'per_person', vv_outreach_n('per_person'),
      'used', v_used, 'used_to', v_to, 'started_with', v_started,
      'free_start', coalesce(v_free, false)),
    -- Migration 146: who is talking to whom, for the courtyard map — every
    -- pair that exchanged a message today, with who wrote first and when.
    -- Never the text. Only while Outreach is on.
    'talks', case when r.phase = 'outreach' then coalesce((
      select jsonb_agg(jsonb_build_object('a', t.sender_id, 'b', t.recipient_id, 'at', t.created_at)
                       order by t.created_at)
        from (select distinct on (least(m.sender_id, m.recipient_id), greatest(m.sender_id, m.recipient_id))
                     m.sender_id, m.recipient_id, m.created_at
                from dm_messages m
               where m.room_id = p_room_id and m.day = r.day
               order by least(m.sender_id, m.recipient_id), greatest(m.sender_id, m.recipient_id),
                        m.created_at) t), '[]'::jsonb)
    else '[]'::jsonb end);
end;
$$;

grant execute on function outreach_state(uuid, uuid) to anon, authenticated;
