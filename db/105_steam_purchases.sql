-- Migration 105 — Steam purchase credit (Steam Microtransactions, Step 3)
--
-- The server side of the Steam purchase bridge. The trusted backend (the
-- steam-purchase Edge Function — see desktop/STEAM.md, holds the Steam publisher
-- Web API key) calls this RPC with the SERVICE ROLE, but ONLY after Steam's
-- ISteamMicroTxn/FinalizeTxn confirms the charge. The currency is credited here,
-- server-side, from a package→reward map the client can't influence — the Steam
-- desktop client never grants anything.
--
-- Idempotent per Steam order id (a replayed finalize is a no-op). Locked away
-- from anon/authenticated; only the backend's service role may call it.
--
-- ⚠️ Real money: the Edge Function MUST verify the caller's Supabase JWT (→ the
--    account to credit) and only finalize+credit after Steam confirms. Never
--    expose this RPC or the publisher key to the client.

begin;

-- One row per finalized Steam order — the idempotency ledger.
create table if not exists steam_purchases (
  order_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  package text not null,
  created_at timestamptz not null default now()
);
alter table steam_purchases enable row level security;
-- No client policies: only the SECURITY DEFINER RPC below (service role) writes it.

create or replace function credit_steam_purchase(p_user uuid, p_package text, p_order text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_mano int;
begin
  if p_user is null or p_package is null or p_order is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_args');
  end if;

  -- Idempotency: claim the order id. A second finalize of the same order no-ops.
  insert into steam_purchases (order_id, user_id, package)
  values (p_order, p_user, p_package)
  on conflict (order_id) do nothing;
  if not found then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  insert into account_economy (user_id) values (p_user) on conflict (user_id) do nothing;

  -- Server-side price→reward map (keep in sync with src/lib/monetization.ts).
  v_mano := case p_package
    when 'mano_150' then 150
    when 'mano_450' then 450
    when 'mano_1000' then 1000
    when 'mano_2200' then 2200
    when 'mano_6000' then 6000
    else -1 end;

  if v_mano >= 0 then
    update account_economy set mano = mano + v_mano where user_id = p_user;
    return jsonb_build_object('ok', true, 'mano', v_mano);
  end if;

  -- Founder / Pioneer Pack: the full bundle (no Mano spent — paid with real money).
  if p_package = 'founder' then
    update account_economy
      set life_experience = life_experience + 4000,
          mano = mano + 1000
      where user_id = p_user;
    insert into account_color_unlocks (user_id, color) values (p_user, 'pioneer') on conflict do nothing;
    insert into account_color_unlocks (user_id, color) values (p_user, 'founder') on conflict do nothing;
    return jsonb_build_object('ok', true, 'pack', 'founder');
  end if;

  -- Unknown package: undo the ledger claim so a corrected retry can credit.
  delete from steam_purchases where order_id = p_order;
  return jsonb_build_object('ok', false, 'reason', 'unknown_package');
end;
$$;

-- Backend-only. Not callable by clients.
revoke all on function credit_steam_purchase(uuid, text, text) from public, anon, authenticated;
grant execute on function credit_steam_purchase(uuid, text, text) to service_role;

commit;
