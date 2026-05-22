// Room operations: creating a new room and joining an existing one.

import { supabase } from "./supabase";
import type { Room, Player } from "./types";

// Characters allowed in a room code. Ambiguous ones (0/O, 1/I/L) are left out
// so codes are easy to read aloud and type.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// Creates a new room and adds the creator as the host player.
export async function createRoom(
  playerName: string
): Promise<{ room: Room; player: Player }> {
  // Try a few times in case the random code is already taken.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({ code })
      .select()
      .single();

    if (roomError) {
      // 23505 = "unique violation" -> code already exists, try another.
      if (roomError.code === "23505") continue;
      throw roomError;
    }

    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert({ room_id: room.id, name: playerName, is_host: true })
      .select()
      .single();

    if (playerError) throw playerError;

    return { room: room as Room, player: player as Player };
  }

  throw new Error("Could not create a room right now. Please try again.");
}

// Joins an existing room by its code.
export async function joinRoom(
  code: string,
  playerName: string
): Promise<{ room: Room; player: Player }> {
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select()
    .eq("code", code)
    .maybeSingle();

  if (roomError) throw roomError;
  if (!room) throw new Error("No room found with that code.");
  if (room.status !== "lobby") {
    throw new Error("That game has already started.");
  }

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert({ room_id: room.id, name: playerName, is_host: false })
    .select()
    .single();

  if (playerError) throw playerError;

  return { room: room as Room, player: player as Player };
}
