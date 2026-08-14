# Steam — setup

Two bridges share the same Steamworks app and publisher key:

1. **Steam sign-in** — a Steam player gets an account without typing an email or
   a password. See "Steam sign-in" below.
2. **Microtransactions** — real-money Mano purchases. The rest of this document.

---

# Steam sign-in

The player launches the game, lands on **"Choose your username"**, types a name,
and is in. No email, no password, no confirmation link.

## The flow

```
ensureSession()                       src/lib/auth.ts — runs on every boot
  → isSteamClient() && no real session
  → steamSignIn()                     src/lib/steam.ts
  → window.vvDesktop.steam.signIn()   desktop/preload.js
  → main.js "steam-signin" handler:
       auth.getAuthTicketForWebApi("viceandvirtue")
       POST {authApi}  { ticket }     Edge Function steam-auth
                                        → ISteamUserAuth/AuthenticateUserTicket
                                        → steam_accounts lookup / createUser
                                        → generateLink → one-shot token
  → supabase.auth.verifyOtp({ token_hash })   a real Supabase session
  → SteamUsernameGate                 shown only when the account has no profile
  → set_username(name)                db/110 — creates profiles + economy + ranked
```

**The auth ticket is the only proof of identity.** A SteamID is just a string
the client sends, and the Edge Function is a public endpoint — if anything ever
trusts a client-supplied steam id, anyone can take over any player's account by
POSTing their SteamID. Don't add such a path.

## Setup (your side)

1. Run **migration 110** (`db/110_steam_auth.sql`) in the SQL Editor.
2. Deploy the function and give it the same key the purchase bridge uses:

```bash
supabase functions deploy steam-auth --no-verify-jwt
```

```bash
supabase secrets set STEAM_APP_ID=5077460 STEAM_PUBLISHER_KEY=<publisher key>
```

`--no-verify-jwt` because the whole point is that the caller has *no* session
yet. Optional secrets: `STEAM_AUTH_IDENTITY` (default `viceandvirtue` — must
match `STEAM_IDENTITY` in `main.js`), `STEAM_ALLOW_FAMILY_SHARING` (default
`true`), `STEAM_EMAIL_DOMAIN` (default `steam.viceandvirtue.io` — the synthetic
address the auth user is created with; it never receives mail).

3. Rebuild the shell (`npm run dist:win` in `desktop/`) — the sign-in IPC lives
   in `main.js`/`preload.js`, which are inside the asar. The web half (the
   username screen, `ensureSession`) ships via Vercel like any other UI change.

## Notes

- **Returning players see nothing.** The gate only renders when the account has
  no `profiles` row; after the first launch it's straight to the hub.
- **A Steam account has no password**, so it can't log in at viceandvirtue.io on
  a phone — which matters, since V&V is played on phones. Adding "link an email
  + password" to Settings (`supabase.auth.updateUser`) is the fix; until then a
  Steam account is desktop-only.
- **Steam not running / function not deployed** → `steamSignIn()` returns false
  and `ensureSession()` falls back to the normal anonymous guest session, so the
  game still works. The player just isn't signed into an account.
- **Guests can't mint accounts**: `set_username` rejects anonymous JWTs.

---

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

## 2. Bake the config into the build — DONE

Steam launches the `.exe` directly, so **environment variables are not a usable
channel in a shipped build**. `desktop/steam-config.json` carries it:

```json
{
  "appId": 5077460,
  "purchaseApi": "https://xqvlseduirkvikkpatcb.functions.supabase.co/steam-purchase"
}
```

Changing either value requires a rebuild (`npm run dist:win` in `desktop/`) —
the file is packaged inside the asar. While `appId` is `0` the bridge stays off
and the Shop says "coming soon" instead of failing mysteriously.

`STEAM_APP_ID` / `VV_PURCHASE_API` env vars still override, for local dev.

### Testing the packaged exe before the depot exists

With a real appid, `restartAppIfNecessary` hands off to Steam on launch — and
until the build is uploaded and installed *through* Steam, Steam has nothing to
relaunch, so double-clicking the exe looks like it does nothing. That's correct
Steam behaviour, not a bug. To smoke-test the production build locally:

```
"dist\win-unpacked\Vice and Virtue.exe" --skip-steam-restart
```

(Use that flag, not `--dev` — `--dev` also points the window at localhost:3000.)
Once the app is installed via Steam, launch it normally from your library.

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
