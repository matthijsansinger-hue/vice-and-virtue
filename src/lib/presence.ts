// Friend presence (migration 136): where each signed-in player is right now —
// on the home screen, in a lobby, or in a game — so the party picker can show
// who's free to invite. Each client reports every PRESENCE_PING_MS; a friend
// whose last report is older than 75 s reads as offline (server-side).
//
// Reads only ever cover your accepted friends (friends_presence).

"use client";

import { useEffect } from "react";
import { supabase } from "./supabase";

export type PresenceLocation = "home" | "lobby" | "game";
export type PresenceStatus = PresenceLocation | "offline";

export const PRESENCE_PING_MS = 30_000;

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  home: "Online",
  lobby: "In a lobby",
  game: "In a game",
  offline: "Offline",
};

// Guests (anonymous sessions) have no friends to be seen by, so they don't ping.
async function signedInAccount(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return !!user && !user.is_anonymous;
}

export async function pingPresence(location: PresenceLocation): Promise<void> {
  try {
    if (!(await signedInAccount())) return;
    await supabase.rpc("presence_ping", { p_location: location });
  } catch {
    /* best effort: a missed ping just means "offline" a little sooner */
  }
}

// Report `location` now, every PRESENCE_PING_MS, and whenever the tab comes
// back into view. Pass null to stop (e.g. before the room has loaded).
export function usePresence(location: PresenceLocation | null): void {
  useEffect(() => {
    if (!location) return;
    const ping = () => {
      void pingPresence(location);
    };
    ping();
    const id = setInterval(ping, PRESENCE_PING_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [location]);
}

// Every accepted friend's status, keyed by their account id.
export async function getFriendsPresence(): Promise<Map<string, PresenceStatus>> {
  const { data, error } = await supabase.rpc("friends_presence");
  if (error) throw error;
  const out = new Map<string, PresenceStatus>();
  for (const row of (data as { user_id: string; status: string }[] | null) ?? []) {
    const s = row.status;
    out.set(row.user_id, s === "home" || s === "lobby" || s === "game" ? s : "offline");
  }
  return out;
}
