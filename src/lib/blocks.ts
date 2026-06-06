// In-game block list (client-side, per device).
//
// Blocking is local to this browser and scoped to a room: it hides a
// player's chat messages from you and removes them from your outreach
// partner list. It does NOT touch game state (votes, readiness, player
// counts) — purely a personal display filter, so it works for guests and
// accounts alike. Player ids are per-game, so a block naturally applies to
// the current game; old ids simply never match again.
//
// Stored under `vv_blocked_<roomId>` in localStorage. Changes broadcast a
// custom event so every useBlockedIds() in the tab re-renders (and the
// native `storage` event covers other tabs).

"use client";

import { useEffect, useMemo, useState } from "react";

const EVENT = "vv-blocks-changed";
const keyFor = (roomId: string) => `vv_blocked_${roomId}`;

function read(roomId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(roomId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

function write(roomId: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(roomId), JSON.stringify(ids));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // private mode / quota — ignore
  }
}

export function blockPlayer(roomId: string, playerId: string): void {
  const ids = read(roomId);
  if (!ids.includes(playerId)) write(roomId, [...ids, playerId]);
}

export function unblockPlayer(roomId: string, playerId: string): void {
  write(
    roomId,
    read(roomId).filter((id) => id !== playerId)
  );
}

// Reactive view of the blocked-id set for a room. Re-renders on block/unblock
// in this tab (custom event) and in other tabs (storage event).
export function useBlockedIds(roomId: string) {
  const [ids, setIds] = useState<string[]>(() => read(roomId));

  useEffect(() => {
    const refresh = () => setIds(read(roomId));
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [roomId]);

  const blocked = useMemo(() => new Set(ids), [ids]);
  return {
    blocked,
    isBlocked: (playerId: string) => blocked.has(playerId),
    block: (playerId: string) => blockPlayer(roomId, playerId),
    unblock: (playerId: string) => unblockPlayer(roomId, playerId),
  };
}
