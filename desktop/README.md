# Vice and Virtue — Desktop (Steam) shell

A thin, hardened [Electron](https://electronjs.org) window around the **live web
app** (`https://viceandvirtue.io`). The game is online-only (Supabase realtime),
so the desktop build loads the production site directly instead of bundling a
copy — one codebase, and the frontend keeps updating via Vercel without
re-shipping to Steam.

This folder is its own npm package, separate from the Next.js app, so Electron's
dependencies never touch the web build.

## Run it

```bash
cd desktop
npm install        # first time only (downloads Electron, ~100 MB)
npm start          # opens a window on the live site
npm run dev        # opens a window on http://localhost:3000 (run the web app's
                   # `npm run dev` in the parent folder first)
```

## Build a distributable

```bash
npm run dist:win   # Windows: produces dist/win-unpacked/ + an NSIS installer
```

- **For Steam:** point your depot at `dist/win-unpacked/` (Steam handles
  install/update, so the NSIS installer is only for standalone testing).
- Requires `build/icon.ico` (Windows) — see "Icon" below.

## How it's wired

- **`main.js`** — creates the window, loads `APP_URL` (prod, or
  `http://localhost:3000` with `--dev` / `VV_DEV=1`), and hardens it:
  - `contextIsolation` + `sandbox` on, `nodeIntegration` off, minimal preload.
  - Navigation is locked to our own hosts (`ALLOWED_HOSTS`); external links and
    popups open in the user's real browser.
  - All device-permission requests (camera/mic/geo/notifications) are denied.
  - On a failed load it shows `error.html` (Retry re-loads the app).
  - Single-instance lock.
- **`preload.js`** — exposes a minimal `window.vvDesktop` (`isDesktop`,
  `platform`, `retry()`). The web app can feature-detect `window.vvDesktop` to
  light up desktop-only behaviour. **Steam Microtransactions** (Step 3) plug in
  here: load the Steamworks SDK in the main process and expose
  `window.vvDesktop.steam.*` via IPC.
- **`error.html`** — offline/retry screen.

## Icon

Put a Windows icon at `build/icon.ico` (256×256 multi-res) and a `build/icon.png`
(512×512) for the window + Linux. They can be generated from the app's existing
`public/icon.png`. Until then, `npm start` runs fine with the default Electron
icon; only `npm run dist` needs the `.ico`.

## Steam notes

- In-app purchases on Steam **must** use Steam Microtransactions (MTX), not an
  external processor — that's Step 3 (the `window.vvDesktop.steam` bridge + a
  Supabase RPC to credit Mano after Steam confirms the order).
- The desktop client renders the app's existing **desktop layout** (the
  responsive `lg:` breakpoints), so the in-person "everyone on their phone"
  model becomes "everyone on their own PC" — same Supabase rooms, just desktop
  clients.
