-- 144: Pride's broadcast is anonymous (Matthijs, 2026-11-05).
--
-- outreach_state no longer returns WHO is broadcasting: everyone sees the
-- global chat as "Pride", and only Pride himself is told it is his
-- ('mine': true) so his screen shows the composer. Messages never carried a
-- name. Requires 143. Safe to re-run.

begin;

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
      'free_start', coalesce(v_free, false)));
end;
$$;
grant execute on function outreach_state(uuid, uuid) to anon, authenticated;

commit;
