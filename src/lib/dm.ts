// Direct (1-on-1) messages used during the outreach phase.
// Each message carries the in-game day it was sent on so the client
// can filter to just "today's" chat history (the outreach chat
// resets each new day).

import { supabase } from "./supabase";
import { cleanForSend } from "./profanity";

export async function sendDirectMessage(
  roomId: string,
  senderId: string,
  recipientId: string,
  text: string,
  day: number
): Promise<void> {
  const clean = cleanForSend(text);
  // Routed through a caller-gated RPC (migration 101): the sender is bound to
  // auth.uid() and the room is derived server-side, so DMs can't be forged.
  const { error } = await supabase.rpc("send_dm", {
    p_room_id: roomId,
    p_sender_id: senderId,
    p_recipient_id: recipientId,
    p_day: day,
    p_text: clean,
  });
  if (error) throw error;
}
