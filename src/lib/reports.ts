// Player reports (moderation).
//
// reportPlayer() logs a report via the report_player RPC, which auto-mutes a
// player once enough DISTINCT players report them in a game. Reports are
// deduped server-side (one per reporter/target/game), so re-tapping is a
// no-op. We also remember locally which players you've reported (per room)
// so the UI can show a "Reported" state — mirrors lib/blocks.ts.

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const EVENT = "vv-reports-changed";
const keyFor = (roomId: string) => `vv_reported_${roomId}`;

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

function markReported(roomId: string, reportedId: string): void {
  if (typeof window === "undefined") return;
  const ids = read(roomId);
  if (ids.includes(reportedId)) return;
  try {
    window.localStorage.setItem(keyFor(roomId), JSON.stringify([...ids, reportedId]));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // ignore
  }
}

export async function reportPlayer(
  roomId: string,
  reporterId: string,
  reportedId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc("report_player", {
    p_room_id: roomId,
    p_reporter_id: reporterId,
    p_reported_id: reportedId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  markReported(roomId, reportedId);
}

// Reactive set of players you've already reported in this room.
export function useReportedIds(roomId: string) {
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

  const reported = useMemo(() => new Set(ids), [ids]);
  return {
    reported,
    isReported: (playerId: string) => reported.has(playerId),
    report: (reporterId: string, reportedId: string, reason?: string) =>
      reportPlayer(roomId, reporterId, reportedId, reason),
  };
}
