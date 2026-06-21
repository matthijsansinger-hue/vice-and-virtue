-- ============================================
-- Migration 086 — Founder Pack also grants 1000 Mano
-- ============================================
-- The Founder Pack now returns 1000 Mano on top of the 4000 LP + cosmetics.
-- It still costs 1000 Mano to buy, so the net Mano change is 0 (you get your
-- Mano back) — only `buy_founder_pack` changes. schema.sql mirrors this.

create or replace function buy_founder_pack()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_mano int;
  v_le int;
  c_price constant int := 1000;
  c_lp constant int := 4000;
  c_mano constant int := 1000; -- Mano granted by the pack
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  insert into account_economy (user_id) values (v_user) on conflict (user_id) do nothing;

  -- One-time: the 'pioneer' unlock marks pack ownership.
  if exists (select 1 from account_color_unlocks where user_id = v_user and color = 'pioneer') then
    return jsonb_build_object('ok', false, 'reason', 'owned');
  end if;

  select mano into v_mano from account_economy where user_id = v_user for update;
  if coalesce(v_mano, 0) < c_price then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'mano', coalesce(v_mano, 0));
  end if;

  update account_economy
    set mano = mano - c_price + c_mano, life_experience = life_experience + c_lp
  where user_id = v_user
  returning mano, life_experience into v_mano, v_le;

  insert into account_color_unlocks (user_id, color)
  values (v_user, 'pioneer'), (v_user, 'founder')
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'mano', v_mano, 'le', v_le, 'lp_granted', c_lp, 'mano_granted', c_mano);
end; $$;
grant execute on function buy_founder_pack() to authenticated;
