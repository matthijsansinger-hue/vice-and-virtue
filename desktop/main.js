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

const PROD_URL = "https://viceandvirtue.io";
const DEV_URL = "http://localhost:3000";
const isDev = process.argv.includes("--dev") || process.env.VV_DEV === "1";
const APP_URL = isDev ? DEV_URL : PROD_URL;

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
// Configured via env: STEAM_APP_ID (your Steam app id) + VV_PURCHASE_API (the
// deployed backend that holds the Steam publisher Web API key and calls
// ISteamMicroTxn InitTxn/FinalizeTxn — see desktop/STEAM.md). Until BOTH are set
// and `steamworks.js` is installed (`npm i steamworks.js`), the bridge stays
// unavailable: steam-purchase returns { ok:false } and the web Shop shows
// "coming soon". The actual credit happens server-side, never in this client.
let steam = null;
let steamworks = null;
const STEAM_APP_ID = Number(process.env.STEAM_APP_ID || 0);
const PURCHASE_API = process.env.VV_PURCHASE_API || "";

function initSteam() {
  if (!STEAM_APP_ID || !PURCHASE_API) return;
  try {
    steamworks = require("steamworks.js"); // native module; needs Steam running
    steam = steamworks.init(STEAM_APP_ID);
  } catch {
    steam = null; // not installed / Steam not running → bridge stays unavailable
  }
}

ipcMain.handle("steam-id", () => {
  try {
    return steam ? steam.localplayer.getSteamId().steamId64.toString() : null;
  } catch {
    return null;
  }
});

// One purchase: backend InitTxn → Steam overlay authorization → backend
// FinalizeTxn (which credits Mano via credit_steam_purchase, db/105). The access
// token identifies the V&V account to credit; the publisher key + the credit are
// server-side only — this client never grants currency.
ipcMain.handle("steam-purchase", async (_event, { packageId, accessToken }) => {
  if (!steam || !PURCHASE_API) return { ok: false, reason: "unavailable" };
  try {
    const steamId = steam.localplayer.getSteamId().steamId64.toString();
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    };

    // 1) Backend starts the transaction (Steam then shows the purchase overlay).
    const initRes = await fetch(`${PURCHASE_API}/init`, {
      method: "POST",
      headers,
      body: JSON.stringify({ steamId, packageId }),
    });
    const init = await initRes.json();
    if (!init || !init.ok || !init.orderid) {
      return { ok: false, reason: (init && init.reason) || "init_failed" };
    }

    // 2) Wait for the user to confirm in the Steam overlay. NOTE: verify the
    //    callback name/shape against your installed steamworks.js (see STEAM.md).
    const authorized = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 180000);
      try {
        steam.callback.register(
          steamworks.SteamCallback.MicroTxnAuthorizationResponse,
          (data) => {
            if (String(data.orderId) === String(init.orderid)) {
              clearTimeout(timer);
              resolve(!!data.authorized);
            }
          }
        );
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
    if (!authorized) return { ok: false, reason: "cancelled" };

    // 3) Backend finalizes with Steam and credits Mano (service role).
    const finRes = await fetch(`${PURCHASE_API}/finalize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ orderid: init.orderid }),
    });
    const fin = await finRes.json();
    return fin && fin.ok
      ? { ok: true }
      : { ok: false, reason: (fin && fin.reason) || "finalize_failed" };
  } catch {
    return { ok: false, reason: "error" };
  }
});

// Single-instance: focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
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
