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

  app.whenReady().then(createWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
