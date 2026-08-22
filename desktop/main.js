// Vice and Virtue — Electron desktop shell (Steam build, Step 2).
//
// A thin, hardened window around the LIVE web app. The game is online-only
// (Supabase realtime is required), so we load the production site directly
// rather than bundling a static export — one codebase, and the frontend
// auto-updates via Vercel without re-shipping the Steam build.
//
// Security: contextIsolation + sandbox on, nodeIntegration off, a minimal
// preload, and navigation locked to our own origin (external links open in the
// user's real browser). Steam Microtransactions + a Steamworks bridge land in
// Step 3, wired through this same preload via IPC.

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const PROD_URL = "https://viceandvirtue.io";
const DEV_URL = "http://localhost:3000";
const isDev = process.argv.includes("--dev") || process.env.VV_DEV === "1";
const APP_URL = isDev ? DEV_URL : PROD_URL;

// --- Steam config -----------------------------------------------------------
// Steam launches the .exe directly, so process.env is NOT a usable channel in a
// shipped build — the appid + backend URLs are baked into steam-config.json
// (packaged inside the asar). Env vars still override, for local dev.
function loadSteamConfig() {
  let file = {};
  try {
    file = JSON.parse(
      fs.readFileSync(path.join(__dirname, "steam-config.json"), "utf8")
    );
  } catch {
    /* no config shipped — Steam features stay off */
  }
  const purchaseApi = String(
    process.env.VV_PURCHASE_API || file.purchaseApi || ""
  );
  return {
    appId: Number(process.env.STEAM_APP_ID || file.appId || 0),
    purchaseApi,
    // The steam-auth Edge Function. Falls back to the sibling of the purchase
    // URL so a build carrying only the older config shape still signs in.
    authApi: String(
      process.env.VV_AUTH_API ||
        file.authApi ||
        purchaseApi.replace(/steam-purchase\/?$/, "steam-auth")
    ),
  };
}

const STEAM = loadSteamConfig();

// Identity the Steam auth ticket is bound to. MUST match STEAM_AUTH_IDENTITY in
// the steam-auth Edge Function, or Steam rejects every ticket.
const STEAM_IDENTITY = "viceandvirtue";

// Hosts allowed to load INSIDE the window. Anything else (Discord, external
// links, email-confirmation pages) is opened in the user's real browser.
const ALLOWED_HOSTS = new Set([
  "viceandvirtue.io",
  "www.viceandvirtue.io",
  "vice-and-virtue-delta.vercel.app",
  "localhost",
]);

function isAllowed(targetUrl) {
  try {
    return ALLOWED_HOSTS.has(new URL(targetUrl).hostname);
  } catch {
    return false;
  }
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#241710", // game brown — no white flash before load
    show: false,
    autoHideMenuBar: true,
    title: "Vice and Virtue",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const wc = win.webContents;

  win.once("ready-to-show", () => win.show());

  // Popups / target=_blank → the user's real browser, never a second Electron
  // window. This covers external links (Discord) AND our own new-tab links such
  // as the Privacy Notice: the shell is a single window with no tabs, so a
  // same-origin popup that's merely denied would be a dead click (it wouldn't
  // open anywhere). Opening it externally also preserves the game window's
  // state — e.g. the sign-up form stays put while the notice opens in a tab.
  wc.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // In-window navigation stays on our origin; everything else opens externally.
  wc.on("will-navigate", (event, url) => {
    if (!isAllowed(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // The game needs no device permissions (camera / mic / geolocation /
  // notifications) — deny every request by default.
  wc.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  );

  // If the site can't be reached, fall back to the local offline/retry page.
  wc.on("did-fail-load", (_event, errorCode, _desc, _url, isMainFrame) => {
    // -3 = ERR_ABORTED (redirects / cancelled loads) — not a real failure.
    if (isMainFrame && errorCode !== -3) {
      win.loadFile(path.join(__dirname, "error.html")).catch(() => {});
    }
  });

  win.loadURL(APP_URL);
}

// The offline page's Retry button asks the main process to re-load the app.
ipcMain.on("vv-retry", () => {
  if (win) win.loadURL(APP_URL);
});

// --- Steam Microtransactions (Step 3) ---
// Config comes from steam-config.json (baked into the build — Steam launches the
// exe directly, so env vars are dev-only). The actual charge + the Mano credit
// happen server-side (the steam-purchase Edge Function holds the publisher Web
// API key); this client only triggers the overlay and relays the authorization.
let steam = null;
let steamworks = null;
let steamError = null; // why the bridge is unavailable, surfaced to the Shop UI

// The MicroTxn callback is registered ONCE at startup, not per purchase — a
// per-purchase register leaks a handle for every attempt. Pending purchases wait
// on this map, keyed by the order id Steam echoes back.
const pendingTxn = new Map(); // orderId(string) -> resolve(authorized: boolean)

function initSteam() {
  if (!STEAM.appId) {
    steamError = "no_appid";
    return;
  }
  try {
    steamworks = require("steamworks.js"); // native module; needs Steam running
    // init() also starts steamworks.js's own runCallbacks pump (30Hz), which is
    // what delivers MicroTxnAuthorizationResponse below.
    steam = steamworks.init(STEAM.appId);

    steam.callback.register(
      steamworks.SteamCallback.MicroTxnAuthorizationResponse,
      (data) => {
        // steamworks.js 0.4 delivers snake_case: { app_id, order_id, authorized }.
        // order_id is a number|bigint, our order ids are strings — compare as text.
        const key = String(data.order_id);
        const resolve = pendingTxn.get(key);
        if (resolve) {
          pendingTxn.delete(key);
          resolve(!!data.authorized);
        }
      }
    );
  } catch (e) {
    // Not installed, Steam not running, or the appid isn't owned by this account.
    steam = null;
    steamError = "steam_unavailable";
    console.error("[steam] init failed:", e && e.message);
  }
}

// Lets the web Shop show a real state instead of a blank "coming soon".
// (Purchases also need the backend URL; sign-in doesn't, so the missing-backend
// check lives here rather than in initSteam.)
ipcMain.handle("steam-status", () => ({
  ready: !!steam && !!STEAM.purchaseApi,
  reason: !steam ? steamError : STEAM.purchaseApi ? null : "no_backend",
}));

ipcMain.handle("steam-id", () => {
  try {
    return steam ? steam.localplayer.getSteamId().steamId64.toString() : null;
  } catch {
    return null;
  }
});

// The Steam persona name — only ever a SUGGESTION for the username field. The
// account's real name is whatever the player confirms (and it must be unique).
ipcMain.handle("steam-name", () => {
  try {
    return steam ? steam.localplayer.getName() : null;
  } catch {
    return null;
  }
});

// --- Steam sign-in (Steam identity -> a V&V account) ------------------------
// Fetch an auth ticket and hand it to the steam-auth Edge Function, which
// verifies it with Steam's Web API and returns a one-shot token the renderer
// redeems for a Supabase session (src/lib/steam.ts steamSignIn).
//
// The ticket is fetched HERE, in the main process, so the renderer never holds
// it — and note that the SteamID by itself proves nothing: only the verified
// ticket does. Never let the client claim an identity.
//
// Steam answers only ONE GetAuthTicketForWebApi request at a time — a second
// concurrent call leaves the first promise's channel dropped ("channel closed").
// The web app legitimately calls ensureSession() more than once on boot, so
// share a single in-flight request between all callers.
let signInFlight = null;

ipcMain.handle("steam-signin", async () => {
  if (signInFlight) return signInFlight;
  signInFlight = runSteamSignIn().finally(() => {
    signInFlight = null;
  });
  return signInFlight;
});

async function runSteamSignIn() {
  if (!steam) return { ok: false, reason: steamError || "unavailable" };
  if (!STEAM.authApi) return { ok: false, reason: "no_backend" };

  let ticket = null;
  try {
    ticket = await steam.auth.getAuthTicketForWebApi(STEAM_IDENTITY);
    const res = await fetch(STEAM.authApi, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: ticket.getBytes().toString("hex") }),
    });
    const j = await res.json().catch(() => null);
    return j && j.ok
      ? j
      : { ok: false, reason: (j && j.reason) || "auth_failed" };
  } catch (e) {
    console.error("[steam] sign-in failed:", e && e.message);
    return { ok: false, reason: "error" };
  } finally {
    // Tickets are one-shot; cancelling releases the handle either way.
    try {
      if (ticket) ticket.cancel();
    } catch {
      /* already cancelled */
    }
  }
}

// One purchase: backend InitTxn → Steam overlay authorization → backend
// FinalizeTxn (which credits Mano via credit_steam_purchase, db/105). The access
// token identifies the V&V account to credit; the publisher key + the credit are
// server-side only — this client never grants currency.
ipcMain.handle("steam-purchase", async (_event, { packageId, accessToken }) => {
  if (!steam) return { ok: false, reason: steamError || "unavailable" };
  if (!STEAM.purchaseApi) return { ok: false, reason: "no_backend" };
  if (!accessToken) return { ok: false, reason: "signed_out" };

  let orderId = null;
  try {
    const steamId = steam.localplayer.getSteamId().steamId64.toString();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    };

    // 1) Backend starts the transaction; Steam then shows the purchase overlay.
    const initRes = await fetch(`${STEAM.purchaseApi}/init`, {
      method: "POST",
      headers,
      body: JSON.stringify({ steamId, packageId }),
    });
    const init = await initRes.json().catch(() => null);
    if (!init || !init.ok || !init.orderid) {
      return { ok: false, reason: (init && init.reason) || "init_failed" };
    }
    orderId = String(init.orderid);

    // 2) Wait for the user to confirm in the Steam overlay. Registered up front
    //    (see pendingTxn) so the response can't arrive before we're listening.
    const authorized = await new Promise((resolve) => {
      pendingTxn.set(orderId, resolve);
      setTimeout(() => {
        if (pendingTxn.delete(orderId)) resolve(false); // overlay never answered
      }, 180000);
    });
    if (!authorized) return { ok: false, reason: "cancelled" };

    // 3) Backend finalizes with Steam and credits Mano (service role).
    const finRes = await fetch(`${STEAM.purchaseApi}/finalize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orderid: orderId }),
    });
    const fin = await finRes.json().catch(() => null);
    return fin && fin.ok
      ? { ok: true }
      : { ok: false, reason: (fin && fin.reason) || "finalize_failed" };
  } catch (e) {
    console.error("[steam] purchase failed:", e && e.message);
    return { ok: false, reason: "error" };
  } finally {
    if (orderId) pendingTxn.delete(orderId);
  }
});

// The Steam overlay (which is what renders the purchase confirmation dialog)
// only composites over an Electron window if these Chromium switches are set —
// so this MUST run before app-ready, before any window exists. Without it the
// user never sees the purchase prompt and every transaction silently times out.
// --skip-steam-restart runs the REAL (production-URL) build without handing off
// to Steam. Needed to smoke-test the packaged exe before the depot is uploaded:
// until Steam can actually install the app, restartAppIfNecessary quits and
// Steam has nothing to relaunch, so a plain double-click looks like a no-op.
// Distinct from --dev, which also swings the app URL to localhost.
const skipSteamRestart =
  process.argv.includes("--skip-steam-restart") || isDev;

let steamRelaunching = false;
if (STEAM.appId) {
  try {
    const sw = require("steamworks.js");
    // Launched outside Steam? Bounce through Steam so the overlay + MTX work.
    // (A no-op when Steam already launched us.)
    if (!skipSteamRestart && sw.restartAppIfNecessary(STEAM.appId)) {
      steamRelaunching = true;
      app.quit();
    } else {
      sw.electronEnableSteamOverlay();
    }
  } catch (e) {
    console.error("[steam] overlay setup skipped:", e && e.message);
  }
}

// Single-instance: focus the existing window instead of opening a second one.
if (steamRelaunching) {
  // Steam is relaunching us — do nothing else.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    initSteam();
    createWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
