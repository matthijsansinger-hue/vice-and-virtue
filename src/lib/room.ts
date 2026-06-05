// Room operations: creating a new room and joining an existing one.

import { supabase } from "./supabase";
import { containsProfanity } from "./profanity";
import { getStoredPlayerId } from "./player";
import type { Room, Player } from "./types";

// Guests pick any name; reject profane ones (shown to everyone in-game).
function assertCleanName(name: string): void {
  if (containsProfanity(name)) {
    throw new Error("Please choose a respectful name.");
  }
}

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
// `userId` links the player row to a registered account (null for guests).
export async function createRoom(
  playerName: string,
  userId: string | null = null
): Promise<{ room: Room; player: Player }> {
  assertCleanName(playerName);

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
      .insert({ room_id: room.id, user_id: userId, name: playerName, is_host: true })
      .select()
      .single();

    if (playerError) throw playerError;

    return { room: room as Room, player: player as Player };
  }

  throw new Error("Could not create a room right now. Please try again.");
}

// Flips a room between Public (discoverable via matchmaking) and Private
// (code-only). Host-only in the UI; rooms use open RLS so a direct update
// is enough, and realtime pushes the change to every client in the lobby.
export async function setRoomVisibility(
  roomId: string,
  isPublic: boolean
): Promise<void> {
  const { error } = await supabase
    .from("rooms")
    .update({ is_public: isPublic })
    .eq("id", roomId);
  if (error) throw error;
}

// Joins an existing room by its code.
// `userId` links the player row to a registered account (null for guests).
export async function joinRoom(
  code: string,
  playerName: string,
  userId: string | null = null
): Promise<{ room: Room; player: Player }> {
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select()
    .eq("code", code)
    .maybeSingle();

  if (roomError) throw roomError;
  if (!room) throw new Error("No room found with that code.");

  // Rejoin: if this browser already has a player row in THIS room, reuse
  // it instead of creating a duplicate. Covers a refresh, a lost
  // connection, or a desync — and works even after the game has started,
  // so a player who dropped mid-game can get back to their seat.
  const existingId = getStoredPlayerId();
  if (existingId) {
    const { data: existing } = await supabase
      .from("players")
      .select()
      .eq("id", existingId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (existing) {
      return { room: room as Room, player: existing as Player };
    }
  }

  // Otherwise this is a fresh join: the name must be clean and the room
  // must still be in the lobby (you can't newly join a game in progress).
  assertCleanName(playerName);
  if (room.status !== "lobby") {
    throw new Error("That game has already started.");
  }

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert({ room_id: room.id, user_id: userId, name: playerName, is_host: false })
    .select()
    .single();

  if (playerError) throw playerError;

  return { room: room as Room, player: player as Player };
}
