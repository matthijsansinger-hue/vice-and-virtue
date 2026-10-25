// Bots (migration 124): server-played players that fill empty seats in PUBLIC
// queue games. They act the instant a phase starts (run_bots, called by the
// host), so they must never set the pace — otherwise one human with seven bots
// would see a "most are ready" countdown the moment every phase opened.

import { supabase } from "./supabase";

// The players whose readiness gates a phase: the humans in `list`. Falls back to
// everyone in `list` (bots included — run_bots marks them ready) when no human
// is in it, e.g. every human is dead or jailed, so the game can never stall
// waiting on nobody.
export function pacers<T extends { is_bot?: boolean }>(list: T[]): T[] {
  const humans = list.filter((p) => !p.is_bot);
  return humans.length > 0 ? humans : list;
}

// Server-hosted rooms (migration 126): tell the server "I'm still here" and
// nudge its phase machine. The server decides whether anything is due, so any
// player calling this as often as they like can't change the game — it only
// keeps the room from being closed as abandoned and steps it promptly.
export async function tickRoom(roomId: string, playerId: string): Promise<boolean> {
  const { error } = await supabase.rpc("tick_room", {
    p_room_id: roomId,
    p_player_id: playerId,
  });
  return !error;
}

// Host only: have the server act for every bot in the current phase. Idempotent
// server-side (once per phase/day/re-vote), so calling it again is harmless.
export async function runBots(roomId: string): Promise<boolean> {
  const { error } = await supabase.rpc("run_bots", { p_room_id: roomId });
  return !error;
}
