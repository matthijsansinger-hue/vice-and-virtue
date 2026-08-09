// Supabase Edge Function: steam-purchase (Deno)
//
// The trusted half of the Steam Microtransactions flow. Holds the Steam
// publisher Web API key; the desktop client never sees it and never grants
// currency itself.
//
//   POST /steam-purchase/init      { steamId, packageId } -> { ok, orderid }
//        -> ISteamMicroTxn/InitTxn (Steam shows the purchase overlay)
//   POST /steam-purchase/finalize  { orderid }            -> { ok }
//        -> ISteamMicroTxn/FinalizeTxn, then credit_steam_purchase() (db/105)
//
// Both routes require the caller's Supabase JWT — that identifies the account to
// credit. The amount charged is taken from the server-side PKG map here (and the
// reward from credit_steam_purchase's own map), never from the client.
//
// Deploy:
//   supabase functions deploy steam-purchase --no-verify-jwt
//   supabase secrets set STEAM_APP_ID=... STEAM_PUBLISHER_KEY=... STEAM_SANDBOX=true
// (--no-verify-jwt because we verify the JWT ourselves and also need to accept
// Steam's server-to-server shape; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// injected automatically.)

import { createClient } from "jsr:@supabase/supabase-js@2";

const APPID = Deno.env.get("STEAM_APP_ID")!;
const KEY = Deno.env.get("STEAM_PUBLISHER_KEY")!;
// Steam's sandbox behaves identically but never charges real money. New apps
// start in sandbox — flip this to "false" only once Steam moves you to prod.
const SANDBOX = (Deno.env.get("STEAM_SANDBOX") ?? "true") !== "false";
const PARTNER = SANDBOX
  ? "https://partner.steam-api.com/ISteamMicroTxnSandbox"
  : "https://partner.steam-api.com/ISteamMicroTxn";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// packageId -> { amount in EUR cents, description }.
// Keep in sync with src/lib/monetization.ts (prices) and credit_steam_purchase
// (db/105 + db/107) which owns the reward side.
const PKG: Record<string, { amount: number; desc: string }> = {
  mano_150: { amount: 199, desc: "150 Mano" },
  mano_450: { amount: 499, desc: "450 Mano" },
  mano_1000: { amount: 999, desc: "1000 Mano" },
  mano_2200: { amount: 1999, desc: "2200 Mano" },
  mano_6000: { amount: 4999, desc: "6000 Mano" },
  // Pioneer Pack — launch sale price (monetization.ts FOUNDER_PACK_EUR).
  founder: { amount: 999, desc: "Pioneer Pack" },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function callerId(req: Request): Promise<string | null> {
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  return data.user?.id ?? null;
}

// Steam returns its errors inside response.error; surface them for the logs.
async function steamPost(path: string, params: URLSearchParams) {
  const r = await fetch(`${PARTNER}/${path}`, { method: "POST", body: params });
  const j = await r.json().catch(() => null);
  return j?.response ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);

  const uid = await callerId(req);
  if (!uid) return json({ ok: false, reason: "auth" }, 401);

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  // ---- init ---------------------------------------------------------------
  if (url.pathname.endsWith("/init")) {
    const { steamId, packageId } = body as {
      steamId?: string;
      packageId?: string;
    };
    const pkg = packageId ? PKG[packageId] : undefined;
    if (!pkg) return json({ ok: false, reason: "bad_package" });
    if (!steamId || !/^\d{17}$/.test(steamId)) {
      return json({ ok: false, reason: "bad_steamid" });
    }

    // Steam requires a unique uint64 order id per transaction.
    const orderid = String(
      BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
    );

    // Record the intent BEFORE calling Steam, so a finalize can always resolve
    // which account + package an order belongs to (the client never says).
    const { error: pendErr } = await admin.from("steam_pending").insert({
      order_id: orderid,
      user_id: uid,
      package: packageId,
      steam_id: steamId,
    });
    if (pendErr) return json({ ok: false, reason: "pending_insert" });

    const p = new URLSearchParams({
      key: KEY,
      appid: APPID,
      orderid,
      steamid: steamId,
      itemcount: "1",
      language: "en",
      currency: "EUR",
      "itemid[0]": "1",
      "qty[0]": "1",
      "amount[0]": String(pkg.amount),
      "description[0]": pkg.desc,
    });
    const res = await steamPost("InitTxn/v3/", p);
    if (res?.result !== "OK") {
      console.error("InitTxn failed", JSON.stringify(res));
      return json({ ok: false, reason: "init", steam: res?.error ?? null });
    }
    return json({ ok: true, orderid });
  }

  // ---- finalize -----------------------------------------------------------
  if (url.pathname.endsWith("/finalize")) {
    const { orderid } = body as { orderid?: string };
    if (!orderid) return json({ ok: false, reason: "no_order" });

    // The order must belong to THIS caller — otherwise anyone with an order id
    // could redirect someone else's purchase to their own account.
    const { data: pend } = await admin
      .from("steam_pending")
      .select("user_id, package")
      .eq("order_id", orderid)
      .eq("user_id", uid)
      .maybeSingle();
    if (!pend) return json({ ok: false, reason: "no_order" });

    const p = new URLSearchParams({ key: KEY, appid: APPID, orderid });
    const res = await steamPost("FinalizeTxn/v2/", p);
    if (res?.result !== "OK") {
      console.error("FinalizeTxn failed", JSON.stringify(res));
      return json({ ok: false, reason: "finalize", steam: res?.error ?? null });
    }

    // Credit server-side from the package map. Idempotent per order id, so a
    // replayed finalize (retry, double-click) can't double-credit.
    const { data: credit, error } = await admin.rpc("credit_steam_purchase", {
      p_user: pend.user_id,
      p_package: pend.package,
      p_order: orderid,
    });
    if (error) {
      console.error("credit_steam_purchase failed", error.message);
      return json({ ok: false, reason: "credit" });
    }
    await admin.from("steam_pending").delete().eq("order_id", orderid);
    return json(credit ?? { ok: false, reason: "credit" });
  }

  return json({ ok: false, reason: "not_found" }, 404);
});
