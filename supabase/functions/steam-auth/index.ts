// Supabase Edge Function: steam-auth (Deno)
//
// Turns a Steamworks auth ticket into a Supabase session, so a Steam player
// never types an email or a password.
//
//   POST /steam-auth  { ticket: <hex>, identity? } -> { ok, tokenHash, hasProfile, isNew }
//
//   1. ISteamUserAuth/AuthenticateUserTicket verifies the ticket with the
//      publisher Web API key -> the AUTHORITATIVE SteamID.
//   2. steam_accounts (db/110) maps that SteamID to an auth user, creating one
//      on first launch with NO username metadata — migration 106's
//      handle_new_user() then deliberately skips the profile/economy/ranked
//      rows, which set_username() creates once the player picks a name.
//   3. generateLink('magiclink') mints a one-shot token; the client redeems it
//      with supabase.auth.verifyOtp({ type:'magiclink', token_hash }). No email
//      is ever sent (the user is created pre-confirmed).
//
// ⚠️ The ticket is the ONLY proof of identity. A client-supplied steam id is
//    just a string — never trust one here or anywhere downstream, or anybody
//    could take over any player's account by POSTing their SteamID.
//
// Deploy:
//   supabase functions deploy steam-auth --no-verify-jwt
//   supabase secrets set STEAM_APP_ID=... STEAM_PUBLISHER_KEY=...
// (--no-verify-jwt: the whole point is that the caller has no session yet.
//  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "jsr:@supabase/supabase-js@2";

const APPID = Deno.env.get("STEAM_APP_ID")!;
const KEY = Deno.env.get("STEAM_PUBLISHER_KEY")!;
// Must match the identity string desktop/main.js passes to
// getAuthTicketForWebApi() — Steam binds the ticket to it.
const IDENTITY = Deno.env.get("STEAM_AUTH_IDENTITY") ?? "viceandvirtue";
// Family Sharing: a borrower's steamid differs from ownersteamid. Allowed by
// default (Steam permits borrowed play); set "false" to require own-ownership.
const ALLOW_SHARED =
  (Deno.env.get("STEAM_ALLOW_FAMILY_SHARING") ?? "true") !== "false";
// Synthetic address for the Steam-created auth user. It never receives mail
// (the user is created pre-confirmed) — but use a domain you control so a stray
// send can't reach a stranger's mailbox.
const EMAIL_DOMAIN =
  Deno.env.get("STEAM_EMAIL_DOMAIN") ?? "steam.viceandvirtue.io";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// The desktop shell calls this from its main process (no browser origin), but
// keep CORS open so the same call works from a renderer / a dev browser too.
// Safe: without a valid Steam ticket the endpoint hands out nothing.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

type TicketParams = {
  result?: string;
  steamid?: string;
  ownersteamid?: string;
  vacbanned?: boolean;
  publisherbanned?: boolean;
};

// Ask Steam who owns this ticket. Returns null for anything that isn't a
// clean "OK" — an invalid, expired, replayed or foreign-app ticket all land here.
async function verifyTicket(ticket: string): Promise<TicketParams | null> {
  const q = new URLSearchParams({
    key: KEY,
    appid: APPID,
    ticket,
    identity: IDENTITY,
  });
  const r = await fetch(
    `https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/?${q}`,
  );
  const j = await r.json().catch(() => null);
  const res = j?.response;
  if (!res || res.error) {
    console.error("AuthenticateUserTicket failed", JSON.stringify(res ?? j));
    return null;
  }
  const params: TicketParams = res.params ?? {};
  return params.result === "OK" ? params : null;
}

// The auth user backing a SteamID, created on first launch. Deliberately has no
// `username` metadata — see the header note about handle_new_user (db/106).
async function resolveUser(steamId: string): Promise<string | null> {
  const { data: existing } = await admin
    .from("steam_accounts")
    .select("user_id")
    .eq("steam_id", steamId)
    .maybeSingle();
  if (existing) return existing.user_id;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: `steam_${steamId}@${EMAIL_DOMAIN}`,
    email_confirm: true,
    user_metadata: { steam_id: steamId, provider: "steam" },
  });
  if (createErr || !created.user) {
    console.error("createUser failed", createErr?.message);
    return null;
  }

  const { error: mapErr } = await admin
    .from("steam_accounts")
    .insert({ steam_id: steamId, user_id: created.user.id });
  if (mapErr) {
    // Someone else created the mapping between our SELECT and this INSERT
    // (two launches racing). Drop the orphan we just made and use theirs.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    const { data: winner } = await admin
      .from("steam_accounts")
      .select("user_id")
      .eq("steam_id", steamId)
      .maybeSingle();
    return winner?.user_id ?? null;
  }
  return created.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  const body = await req.json().catch(() => ({}));
  const ticket = (body as { ticket?: string }).ticket;
  if (!ticket || !/^[0-9a-fA-F]{16,4096}$/.test(ticket)) {
    return json({ ok: false, reason: "bad_ticket" }, 400);
  }

  const params = await verifyTicket(ticket);
  if (!params?.steamid) return json({ ok: false, reason: "ticket_rejected" }, 401);
  if (params.publisherbanned) return json({ ok: false, reason: "banned" }, 403);

  const steamId = params.steamid;
  const ownerId = params.ownersteamid ?? steamId;
  if (!ALLOW_SHARED && ownerId !== steamId) {
    return json({ ok: false, reason: "not_owned" }, 403);
  }

  const uid = await resolveUser(steamId);
  if (!uid) return json({ ok: false, reason: "account" }, 500);

  // Has this account finished onboarding (picked a username)? Lets the client
  // skip straight to the hub for a returning player.
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", uid)
    .maybeSingle();

  // One-shot login token. generateLink does NOT send mail — it just mints it.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: `steam_${steamId}@${EMAIL_DOMAIN}`,
  });
  if (linkErr || !link.properties?.hashed_token) {
    console.error("generateLink failed", linkErr?.message);
    return json({ ok: false, reason: "session" }, 500);
  }

  return json({
    ok: true,
    tokenHash: link.properties.hashed_token,
    hasProfile: !!profile,
    isNew: !profile,
  });
});
