// Camp messages: secret broadcasts from Vice Worshipper / Virtue Seeker
// to all members of their camp.

import { supabase } from "./supabase";
import { cleanForSend } from "./profanity";

// Sends a message to the sender's camp and deducts the cost from their
// Soul Energy. Marks them as having used their ability this day.
export async function sendCampMessage(
  roomId: string,
  camp: "vice" | "virtue",
  senderId: string,
  text: string,
  cost: number,
  currentSoulEnergy: number
): Promise<void> {
  // Hard-blocks slurs (throws) before any DB write; censors the rest.
  const clean = cleanForSend(text);
  await supabase.from("messages").insert({
    room_id: roomId,
    camp,
    sender_id: senderId,
    text: clean,
  });
  await supabase
    .from("players")
    .update({
      soul_energy: currentSoulEnergy - cost,
      acted_this_day: true,
    })
    .eq("id", senderId);
}
