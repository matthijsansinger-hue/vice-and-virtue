-- Migration 110 — Steam sign-in (a Steam identity becomes a V&V account)
--
-- Steam players never type an email or a password. On launch the desktop shell
-- asks Steamworks for an auth ticket, the `steam-auth` Edge Function verifies
-- that ticket against Steam's Web API (publisher key, server-side only) and
-- mints a Supabase session for a deterministic per-SteamID auth user. The only
-- thing the player sees is "Choose your username".
--
-- ⚠️ The SteamID alone is NOT identity — it's a string the client sends, and the
--    Edge Function is a public endpoint. Only the verified ticket proves who the
--    caller is. Never add an RPC that trusts a client-supplied steam id.
--
-- Why the Steam account starts profile-LESS: migration 106 made
-- handle_new_user() skip profiles/account_economy/account_ranked whenever the
-- new auth user has no `username` in its metadata. The Edge Function creates
-- the Steam user deliberately WITHOUT one, so the auth record exists the moment
-- the game boots (step 1 of the flow) and those three rows are created here, by
-- set_username, once the player picks a name (steps 2-4).

begin;

-- 1) SteamID ⇄ auth user. Written only by the steam-auth Edge Function with the
--    service role — no client policies, exactly like steam_purchases (db/105).
--    user_id is unique so one auth user can never back two Steam identities.
create table if not exists steam_accounts (
  steam_id   text primary key,
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table steam_accounts enable row level security;

-- 2) Claim a username for an account that doesn't have one yet, and create the
--    three account rows handle_new_user() would normally have made.
--
--    Uniqueness is enforced by profiles_username_lower_idx (db/020), so the
--    insert is the authority — a client-side availability check can always lose
--    a race. Guests are refused: a real account comes from sign-up or from a
--    verified Steam ticket, never from an anonymous session.
create or replace function set_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_username, ''));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'anonymous');
  end if;
  -- Same rule as validateUsername() in src/lib/auth.ts: 3-20 letters, digits or
  -- underscores (no spaces — they'd break the "1. Alex" duplicate indexing).
  if v_name !~ '^[A-Za-z0-9_]{3,20}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if exists (select 1 from profiles where id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'has_profile');
  end if;

  begin
    insert into profiles (id, username) values (v_uid, v_name);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;

  insert into account_economy (user_id) values (v_uid) on conflict (user_id) do nothing;
  insert into account_ranked  (user_id) values (v_uid) on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true, 'username', v_name);
end;
$$;
grant execute on function set_username(text) to authenticated;

commit;
