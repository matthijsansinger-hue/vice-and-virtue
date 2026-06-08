// Ranked matchmaking queue (client side). Players join as Vice or Virtue and
// poll tryMatchmake() until a match forms; on a match the server seats them in
// a ranked room and flips their queue row to 'matched' with the room code.
// See db/053_ranked_queue.sql.

import { supabase } from "./supabase";

export type QueueSide = "vice" | "virtue";

export type MyQueue = {
  status: "waiting" | "matched";
  side: QueueSide;
  room_code: string | null;
} | null;

export async function joinQueue(side: QueueSide, name: string): Promise<void> {
  const { error } = await supabase.rpc("join_ranked_queue", {
    p_side: side,
    p_name: name,
  });
  if (error) throw error;
}

export async function leaveQueue(): Promise<void> {
  await supabase.rpc("leave_ranked_queue");
}

export async function getQueueCounts(): Promise<{ vice: number; virtue: number }> {
  const { data } = await supabase.rpc("ranked_queue_counts");
  const d = data as { vice?: number; virtue?: number } | null;
  return { vice: d?.vice ?? 0, virtue: d?.virtue ?? 0 };
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
    .select("status, side, room_code")
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
