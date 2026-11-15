-- 147_envy_outreach_only_no_quiz_x2.sql — 2026-11-15, from Matthijs's playtest:
--
-- (1) Envy's swap only fools people during OUTREACH. It used to show from the
--     end of the role action until the new day (event summary, Quiz, Outreach,
--     Market, the court) — which "doesn't make sense" in the Quiz or the court.
--     The swap itself is unchanged (still set by resolve_role_action, cleared
--     by the new day); only the names the clients get from get_display_names
--     swap, and only while rooms.phase = 'outreach'. The dead always see real
--     names (they see all).
--
-- (2) The Quiz ×2 potion ("minigame_mult") is no longer sold. buy_potion_impl
--     is renamed to buy_potion_core (body untouched) and a thin new
--     buy_potion_impl refuses 'minigame_mult' before handing on — so players
--     (buy_potion) and bots (vv_bot_store calls buy_potion_impl) both stop
--     buying it. Gambling's roll of 3 still doubles the next Quiz: it sets
--     player_secrets.potion_minigame_mult directly, and the award still reads
--     it, so that flag and everything that reads it stay.
--     NOTE for later migrations: change the potion rules in buy_potion_core;
--     redefining buy_potion_impl would bring the potion back.
--
-- Safe to run more than once. Client: Store.tsx / market/* drop the bottle;
-- the room page already refetches display names on every phase change.

begin;

-- ---------------------------------------------------------------------------
-- (1) Display names: Envy's swap during Outreach only.
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
  v_phase text;
  v_dead boolean;
  v_participant boolean;
  v_result jsonb;
begin
  select envy_swap_a, envy_swap_b, phase into v_a, v_b, v_phase
    from rooms where id = p_room_id;
  select dead into v_dead from players where id = p_viewer_id and room_id = p_room_id;

  -- Outside Outreach, and for the dead, nobody is swapped.
  if v_phase is distinct from 'outreach' or coalesce(v_dead, false) then
    v_a := null;
    v_b := null;
  end if;

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

-- ---------------------------------------------------------------------------
-- (2) No more Quiz ×2 potion.
do $$
begin
  if to_regprocedure('public.buy_potion_core(uuid, text, uuid)') is null then
    alter function public.buy_potion_impl(uuid, text, uuid) rename to buy_potion_core;
  end if;
end $$;
revoke all on function buy_potion_core(uuid, text, uuid) from public, anon, authenticated;

create or replace function buy_potion_impl(
  p_player_id uuid,
  p_potion text,
  p_target uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The Quiz ×2 potion was removed from the Market (2026-11-15).
  if p_potion = 'minigame_mult' then
    return jsonb_build_object('ok', false, 'error', 'unknown_potion');
  end if;
  return buy_potion_core(p_player_id, p_potion, p_target);
end;
$$;
revoke all on function buy_potion_impl(uuid, text, uuid) from public, anon, authenticated;

commit;
