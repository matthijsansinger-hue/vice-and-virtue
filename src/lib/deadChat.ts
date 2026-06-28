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
  // Routed through a caller-gated RPC (migration 101): only a player bound to
  // auth.uid() who is actually dead can post to the dead channel.
  const { error } = await supabase.rpc("send_dead_message", {
    p_room_id: roomId,
    p_sender_id: senderId,
    p_text: clean,
  });
  if (error) throw error;
}
