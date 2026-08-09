# Steam Microtransactions — setup

The bridge is **built and wired** (client + backend). What's left is the part
that needs your Steamworks account. Real-money purchases run **only** in the
Steam client — the website's Shop hides them (`lib/steam.ts` `isSteamClient()`),
and the desktop client never grants currency itself.

## The flow

```
Web Shop (Steam client only)
  → steamPurchase(packageId)            lib/steam.ts (sends the Supabase access token)
  → window.vvDesktop.steam.purchase     desktop/preload.js
  → main.js "steam-purchase" handler:
       POST {purchaseApi}/init          Edge Function → ISteamMicroTxn/InitTxn
                                        (Steam shows the purchase overlay)
       await MicroTxnAuthorizationResponse   (user confirms in the overlay)
       POST {purchaseApi}/finalize      Edge Function → FinalizeTxn → credit_steam_purchase()
  → Mano credited server-side (db/105), the Shop refreshes the balance
```

The publisher Web API key and the Mano credit live **only** in the Edge
Function. The client just triggers the overlay and relays the authorization.

## 1. Steamworks (your side — the only blocking part)

1. Join Steamworks (US$100 Steam Direct fee), create the app → note the **App ID**.
2. Generate a **Publisher Web API key** (Users & Permissions → Manage Groups →
   your publisher group → API key). Secret — backend only.
3. Ask Steam to enable **In-Game Purchases / MicroTxn** for the appid. New apps
   start in **sandbox**, which is what you want for review.

## 2. Bake the config into the build

Steam launches the `.exe` directly, so **environment variables are not a usable
channel in a shipped build**. Edit `desktop/steam-config.json`:

```json
{
  "appId": 480,
  "purchaseApi": "https://xqvlseduirkvikkpatcb.functions.supabase.co/steam-purchase"
}
```

Then rebuild (`npm run dist:win` in `desktop/`). While `appId` is `0` the bridge
stays off and the Shop says "coming soon" instead of failing mysteriously.

`STEAM_APP_ID` / `VV_PURCHASE_API` env vars still override, for local dev.

## 3. Deploy the backend

```bash
supabase functions deploy steam-purchase --no-verify-jwt
supabase secrets set STEAM_APP_ID=<appid> STEAM_PUBLISHER_KEY=<publisher key> STEAM_SANDBOX=true
```

`--no-verify-jwt` because the function verifies the JWT itself (it needs to read
the user id from it). `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically.

Run **migration 107** (`db/107_steam_pending.sql`) first — it adds the
`steam_pending` table the init→finalize handoff needs. (Migration 105 already
added `steam_purchases` + `credit_steam_purchase`.)

Set `STEAM_SANDBOX=false` only once Steam moves the app to production.

## 4. Test

With Steam running and logged in, launch the built exe **through Steam**:

- Shop → a Mano package → the Steam overlay appears → confirm → Mano lands.
- Cancel in the overlay → the Shop says "Purchase cancelled." (not an error).
- Finalize the same order twice → the second is a no-op (`credit_steam_purchase`
  is idempotent per order id).
- Sandbox charges are fake; check the transaction in Steamworks.

## Implementation notes (things that were wrong before, don't regress them)

- **The callback payload is snake_case.** steamworks.js 0.4 delivers
  `{ app_id, order_id, authorized }`. The old code read `data.orderId`, which is
  always `undefined` — so no purchase ever matched its order and every one
  timed out after 3 minutes. `order_id` is a `number | bigint`; our order ids are
  strings, so compare as text.
- **`electronEnableSteamOverlay()` must run before app-ready.** It appends the
  Chromium switches (`in-process-gpu`, `disable-direct-composition`) the Steam
  overlay needs to composite over an Electron window. Without it the purchase
  dialog never appears.
- **`init()` already pumps `runCallbacks`** on a 30 Hz interval, so you don't
  need your own loop — but callbacks only arrive after `init()` succeeds.
- **Register the MicroTxn callback once**, at startup, not per purchase (a
  per-purchase `register` leaks a handle every attempt). `main.js` keeps a
  `pendingTxn` map keyed by order id.
- **`steamworks.js` is a native module** — it's in `asarUnpack` so the `.node`
  binary is extracted next to the asar. It cannot be `require`d from inside one.
- **`restartAppIfNecessary`** relaunches through Steam if the exe was started
  directly (skipped with `--dev`).
