// Remembers "who am I" in the browser.
// We have no accounts yet, so when a player creates or joins a room we
// store their player id (and name) in the browser's localStorage.
// The lobby screen reads the id back to know which player you are.

const PLAYER_ID_KEY = "vv_player_id";
const PLAYER_NAME_KEY = "vv_player_name";

export function getStoredPlayerId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PLAYER_ID_KEY);
}

export function setStoredPlayerId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAYER_ID_KEY, id);
}

export function getStoredPlayerName(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PLAYER_NAME_KEY) ?? "";
}

export function setStoredPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PLAYER_NAME_KEY, name);
}
