// Preload — the only bridge between the web app and the desktop shell. Runs in
// an isolated world; exposes a tiny, safe API on window.vvDesktop. The web app
// can feature-detect window.vvDesktop?.isDesktop to enable desktop-only
// behaviour (e.g. Steam purchases in Step 3). Keep this surface minimal.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vvDesktop", {
  isDesktop: true,
  platform: process.platform,
  // Re-load the live app (used by the offline / retry screen).
  retry: () => ipcRenderer.send("vv-retry"),
});
