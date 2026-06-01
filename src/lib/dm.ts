// Direct (1-on-1) messages used during the outreach phase.
// Each message carries the in-game day it was sent on so the client
// can filter to just "today's" chat history (the outreach chat
// resets each new day).

import { supabase } from "./supabase";

export async function sendDirectMessage(
  roomId: string,
  senderId: string,
  recipientId: string,
  text: string,
  day: number
): Promise<void> {
  await supabase.from("dm_messages").insert({
    room_id: roomId,
    sender_id: senderId,
    recipient_id: recipientId,
    day,
    text,
  });
}
