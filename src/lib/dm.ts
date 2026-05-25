// Direct (1-on-1) messages used during the outreach phase.

import { supabase } from "./supabase";

export async function sendDirectMessage(
  roomId: string,
  senderId: string,
  recipientId: string,
  text: string
): Promise<void> {
  await supabase.from("dm_messages").insert({
    room_id: roomId,
    sender_id: senderId,
    recipient_id: recipientId,
    text,
  });
}
