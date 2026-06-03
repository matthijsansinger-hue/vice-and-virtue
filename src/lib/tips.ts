// Remembers which one-time "first-time tips" a player has dismissed, in
// the browser (per device). No account needed — tips are a teaching aid.

const PREFIX = "vv_tip_";

export function hasSeenTip(id: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PREFIX + id) === "1";
}

export function markTipSeen(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFIX + id, "1");
}
