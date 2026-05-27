// Public group chat shown during the consultation phase.
// Distinct from `messages` (anonymous camp chat) and `dm_messages`
// (1-on-1 outreach). Senders are displayed to everyone.

import { supabase } from "./supabase";

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
  await supabase.from("consultation_messages").insert({
    room_id: roomId,
    sender_id: senderId,
    day,
    text: trimmed,
  });
}
