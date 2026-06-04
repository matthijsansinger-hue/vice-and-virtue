-- ============================================
-- Migration 037: hide the room "tells" from clients
-- ============================================
-- The rooms table still holds a few secret per-round fields the server
-- needs (envy_swap_a/b, torment_target, pending_murder_death,
-- recent_successor_id). They stay server-side; the client stops reading
-- them and instead gets only what it's allowed to see, per viewer:
--   - get_my_secrets now also returns is_dying_murder / is_recent_successor
--     / is_tormented (booleans about YOU only).
--   - get_display_names returns the name to show for each player, with
--     Envy's swap already applied for third parties (and NOT applied for
--     the swap participants), so the raw envy_swap_a/b never reach a browser.
--
-- Run this whole file once in the Supabase SQL editor.
-- ============================================

-- Your own secrets + per-viewer room flags.
create or replace function get_my_secrets(p_player_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_room_id uuid;
  v_dying boolean := false;
  v_succ boolean := false;
  v_torment boolean := false;
begin
  select room_id into v_room_id from players where id = p_player_id;
  if v_room_id is not null then
    select
      coalesce(pending_murder_death = p_player_id::text, false),
      coalesce(recent_successor_id = p_player_id::text, false),
      coalesce(torment_target = p_player_id::text, false)
    into v_dying, v_succ, v_torment
    from rooms where id = v_room_id;
  end if;

  select jsonb_build_object(
    'role', ps.role, 'vote', ps.vote,
    'pending_action', ps.pending_action, 'pending_target', ps.pending_target,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment)
  into v
  from player_secrets ps where ps.player_id = p_player_id;

  return coalesce(v, jsonb_build_object(
    'role', null, 'vote', null, 'pending_action', null, 'pending_target', null,
    'is_dying_murder', v_dying,
    'is_recent_successor', v_succ,
    'is_tormented', v_torment));
end;
$$;

grant execute on function get_my_secrets(uuid) to anon, authenticated;

-- Per-viewer display names: duplicate-name indexing ("1. Alex") plus
-- Envy's swap applied only for non-participant viewers. Returns
-- { player_id: display_name }. Ports displayedName from swaps.ts so the
-- raw envy_swap_a/b are never sent to a client.
create or replace function get_display_names(p_room_id uuid, p_viewer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_a text;
  v_b text;
  v_participant boolean;
  v_result jsonb;
begin
  select envy_swap_a, envy_swap_b into v_a, v_b from rooms where id = p_room_id;
  v_participant := v_a is not null and v_b is not null
    and (p_viewer_id::text = v_a or p_viewer_id::text = v_b);

  with dedup as (
    select p.id,
      case when count(*) over (partition by p.name) > 1
           then (row_number() over (partition by p.name order by p.created_at))::text
                || '. ' || p.name
           else p.name end as dname
    from players p where p.room_id = p_room_id
  ),
  swapped as (
    select d.id,
      case
        when v_a is not null and v_b is not null and not v_participant and d.id::text = v_a
          then (select dname from dedup where id = v_b::uuid)
        when v_a is not null and v_b is not null and not v_participant and d.id::text = v_b
          then (select dname from dedup where id = v_a::uuid)
        else d.dname
      end as final_name
    from dedup d
  )
  select coalesce(jsonb_object_agg(id::text, final_name), '{}'::jsonb)
  into v_result from swapped;

  return v_result;
end;
$$;

grant execute on function get_display_names(uuid, uuid) to anon, authenticated;
