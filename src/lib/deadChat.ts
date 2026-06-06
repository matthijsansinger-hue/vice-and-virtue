// Dead-only group chat. Visible only to players who have died.
// Spans the entire game (no day filter) so the conversation persists
// across phases.

import { supabase } from "./supabase";
import { cleanForSend } from "./profanity";

export async function sendDeadMessage(
  roomId: string,
  senderId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const clean = cleanForSend(trimmed);
  await supabase.from("dead_messages").insert({
    room_id: roomId,
    sender_id: senderId,
    text: clean,
  });
}
