"use client";

// Mounted once in the root layout: reports "home" for every page outside a
// room (hub, profile, friends, ranked…). The room page reports "lobby" /
// "game" itself, since only it knows the room's status.

import { usePathname } from "next/navigation";
import { usePresence } from "@/lib/presence";

export function PresenceHeartbeat() {
  const path = usePathname() ?? "/";
  usePresence(path.startsWith("/room/") ? null : "home");
  return null;
}
