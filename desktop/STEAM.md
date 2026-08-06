# Steam Microtransactions — setup (Step 3)

The **bridge** is built; this is the remaining wiring that needs your Steam
account + a deployed backend. Real-money purchases run **only** in the Steam
client — the website's Shop hides them (`lib/steam.ts` `isSteamClient()`), and
the desktop client never grants currency itself.

## The flow

```
Web Shop (Steam client only)
  → steamPurchase(packageId)            lib/steam.ts (sends Supabase access token)
  → window.vvDesktop.steam.purchase     desktop/preload.js
  → main.js "steam-purchase" handler:
       POST {PURCHASE_API}/init         backend → ISteamMicroTxn/InitTxn  (Steam shows the overlay)
       await MicroTxnAuthorizationResponse   (user confirms in the overlay)
       POST {PURCHASE_API}/finalize     backend → ISteamMicroTxn/FinalizeTxn → credit_steam_purchase()
  → Mano credited server-side (db/105), balance refreshes
```

The Steam **publisher Web API key** and the Mano credit live **only** in the
backend. The client just triggers the overlay and relays the authorization.

## 1. Steamworks (your side)

1. Join Steamworks (US$100 Steam Direct fee) and create the app → note the
   **App ID**.
2. Generate a **Publisher Web API key** (Users & Permissions → Manage Groups →
   your publisher group → API key). Keep it secret — backend only.
3. Enable microtransactions for the app (Steamworks → ask Steam to turn on
   In-Game Purchases / MicroTxn for the appid; new apps start in **sandbox**).
4. Pricing: MicroTxn sends the price **per transaction** (no catalog needed) —
   amounts are in the currency's minor units (EUR cents). Keep them matched to
   `src/lib/monetization.ts` and the `credit_steam_purchase` map (db/105).

## 2. The desktop client

```bash
cd desktop
npm i steamworks.js          # native Steam SDK bindings
```

Run it with the env set (and the Steam client running, logged in):

```
STEAM_APP_ID=<your appid>
VV_PURCHASE_API=https://<your-project>.functions.supabase.co/steam-purchase
```

A `steam_appid.txt` containing the appid in the working dir helps during dev.
Until both env vars are set and `steamworks.js` is installed, `steam-purchase`
returns `{ ok:false }` and the Shop shows "coming soon".

> Verify the callback in `main.js` (`steamworks.SteamCallback.MicroTxnAuthorizationResponse`
> and `data.orderId` / `data.authorized`) against your installed `steamworks.js`
> version — the exact enum/shape can differ by release.

## 3. The backend (Supabase Edge Function `steam-purchase`)

Two routes, both verifying the caller's Supabase JWT (→ the account to credit).
Secrets (set with `supabase secrets set`): `STEAM_APP_ID`, `STEAM_PUBLISHER_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`.

```ts
// supabase/functions/steam-purchase/index.ts  (Deno) — sketch; test in sandbox.
import { createClient } from "jsr:@supabase/supabase-js@2";

const PARTNER = "https://partner.steam-api.com";
const APPID = Deno.env.get("STEAM_APP_ID")!;
const KEY = Deno.env.get("STEAM_PUBLISHER_KEY")!;
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// packageId → { amount in EUR cents, description }. Must match monetization.ts.
const PKG: Record<string, { amount: number; desc: string }> = {
  mano_150:  { amount: 199,  desc: "150 Mano" },
  mano_450:  { amount: 499,  desc: "450 Mano" },
  mano_1000: { amount: 999,  desc: "1000 Mano" },
  mano_2200: { amount: 1999, desc: "2200 Mano" },
  mano_6000: { amount: 4999, desc: "6000 Mano" },
  founder:   { amount: 999,  desc: "Pioneer Pack" },
};

async function userId(req: Request): Promise<string | null> {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  return data.user?.id ?? null;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const uid = await userId(req);
  if (!uid) return Response.json({ ok: false, reason: "auth" }, { status: 401 });

  if (url.pathname.endsWith("/init")) {
    const { steamId, packageId } = await req.json();
    const pkg = PKG[packageId];
    if (!pkg) return Response.json({ ok: false, reason: "bad_package" });
    // Encode the account + package in the orderid so /finalize can credit it.
    const orderid = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const p = new URLSearchParams({
      key: KEY, appid: APPID, orderid, steamid: steamId,
      itemcount: "1", language: "en", currency: "EUR",
      "itemid[0]": "1", "qty[0]": "1",
      "amount[0]": String(pkg.amount), "description[0]": pkg.desc,
    });
    const r = await fetch(`${PARTNER}/ISteamMicroTxn/InitTxn/v3/`, { method: "POST", body: p });
    const j = await r.json();
    if (j?.response?.result !== "OK") return Response.json({ ok: false, reason: "init" });
    // Persist {orderid → uid, packageId} (a table or KV) so /finalize can read it.
    await admin.from("steam_pending").insert({ order_id: orderid, user_id: uid, package: packageId });
    return Response.json({ ok: true, orderid });
  }

  if (url.pathname.endsWith("/finalize")) {
    const { orderid } = await req.json();
    const { data: pend } = await admin.from("steam_pending")
      .select("user_id, package").eq("order_id", orderid).eq("user_id", uid).maybeSingle();
    if (!pend) return Response.json({ ok: false, reason: "no_order" });
    const p = new URLSearchParams({ key: KEY, appid: APPID, orderid });
    const r = await fetch(`${PARTNER}/ISteamMicroTxn/FinalizeTxn/v2/`, { method: "POST", body: p });
    const j = await r.json();
    if (j?.response?.result !== "OK") return Response.json({ ok: false, reason: "finalize" });
    const { data: credit } = await admin.rpc("credit_steam_purchase", {
      p_user: pend.user_id, p_package: pend.package, p_order: orderid,
    });
    return Response.json(credit ?? { ok: false, reason: "credit" });
  }

  return new Response("not found", { status: 404 });
});
```

Add a small `steam_pending` table (order_id pk, user_id, package, created_at;
RLS locked) for the init→finalize handoff, or fold it into `steam_purchases`.

`credit_steam_purchase` (db/105) holds the authoritative package→reward map and
is idempotent per order id, so a replayed finalize can't double-credit.

## Testing

Use Steam's **sandbox** (`InitTxn`/`FinalizeTxn` behave the same; charges are
fake) with a sandbox account until the flow is solid, then ask Steam to move the
app to production. Confirm: overlay appears → confirm → Mano lands → a second
finalize of the same orderid is a no-op.
