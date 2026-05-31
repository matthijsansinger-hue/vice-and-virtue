// Dead-only group chat. Visible only to players who have died.
// Spans the entire game (no day filter) so the conversation persists
// across phases.

import { supabase } from "./supabase";

export async function sendDeadMessage(
  roomId: string,
  senderId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await supabase.from("dead_messages").insert({
    room_id: roomId,
    sender_id: senderId,
    text: trimmed,
  });
}
