// Ranked matchmaking queue (client side). Players join with a mode only — no
// side pick (migration 063): when 2N players are waiting the matchmaker deals
// camps + tiers and opens the room in the role_select phase, where everyone
// picks their role live. Poll tryMatchmake() until matched; the queue row
// flips to 'matched' with the room code.

import { supabase } from "./supabase";

export type QueueMode = "3v3" | "5v5";

// Players per side for each mode (mirrors p_n in the matchmaker).
export const MODE_SIZE: Record<QueueMode, number> = { "3v3": 3, "5v5": 5 };

// Waiting players per mode (totals — sides no longer exist).
export type QueueCounts = Record<QueueMode, number>;

export type MyQueue = {
  status: "waiting" | "matched";
  mode: QueueMode;
  room_code: string | null;
} | null;

export async function joinQueue(mode: QueueMode, name: string): Promise<void> {
  const { error } = await supabase.rpc("join_ranked_queue", {
    p_mode: mode,
    p_name: name,
  });
  if (error) throw error;
}

export async function leaveQueue(): Promise<void> {
  await supabase.rpc("leave_ranked_queue");
}

export async function getQueueCounts(): Promise<QueueCounts> {
  const { data } = await supabase.rpc("ranked_queue_counts");
  const d = data as Partial<Record<QueueMode, number>> | null;
  return {
    "3v3": d?.["3v3"] ?? 0,
    "5v5": d?.["5v5"] ?? 0,
  };
}

// Ask the server to try to form a match (any waiting players, not necessarily
// the caller). Returns the new room code if a match formed this call, else null.
export async function tryMatchmake(): Promise<string | null> {
  const { data } = await supabase.rpc("ranked_matchmake");
  return (data as string | null) ?? null;
}

// The caller's own queue row (read-own RLS), or null if not queued.
export async function getMyQueue(): Promise<MyQueue> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("ranked_queue")
    .select("status, mode, room_code")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as MyQueue) ?? null;
}

// After a match, find the player row that matchmaking created for this account
// in the new room, so the client can store it as its identity before entering
// (the room page identifies you by the stored player id).
export async function resolveMySeat(roomCode: string): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: room } = await supabase
    .from("rooms")
    .select("id")
    .eq("code", roomCode)
    .maybeSingle();
  const roomId = (room as { id: string } | null)?.id;
  if (!roomId) return null;

  const { data: player } = await supabase
    .from("players")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  return (player as { id: string } | null)?.id ?? null;
}
