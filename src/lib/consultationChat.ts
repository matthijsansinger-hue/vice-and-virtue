// Public group chat shown during the consultation phase.
// Distinct from `messages` (anonymous camp chat) and `dm_messages`
// (1-on-1 outreach). Senders are displayed to everyone.

import { supabase } from "./supabase";
import { cleanForSend } from "./profanity";

// Sends a message to the public consultation chat. Caller is
// responsible for ensuring the sender is allowed to chat (i.e. not
// dead, not in prison, not in hospital).
export async function sendConsultationMessage(
  roomId: string,
  senderId: string,
  day: number,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const clean = cleanForSend(trimmed);
  // Routed through a caller-gated RPC (migration 101): the sender is bound to
  // auth.uid() and the room is derived server-side.
  const { error } = await supabase.rpc("send_consultation_message", {
    p_room_id: roomId,
    p_sender_id: senderId,
    p_day: day,
    p_text: clean,
  });
  if (error) throw error;
}
