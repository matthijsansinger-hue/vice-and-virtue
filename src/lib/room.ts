// Room operations: creating a new room and joining an existing one.

import { supabase } from "./supabase";
import { containsProfanity } from "./profanity";
import { getStoredPlayerId } from "./player";
import { trackInviteAccepted } from "./analytics";
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

// Hard ceiling on players in any single room (the game's design max).
// Matchmaking stops filling a public lobby at 12, but friends with the
// code can keep joining up to this cap.
const MAX_PLAYERS = 20;

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

// "Find Public Session": atomically join the fullest open public lobby
// (under 12 players) or create + host a fresh one if none exist. Runs in a
// SECURITY DEFINER function so concurrent matchmakers can't overshoot 12 or
// spawn duplicate empty rooms. Open to guests (userId null).
export async function findOrCreatePublicRoom(
  playerName: string,
  userId: string | null = null
): Promise<{ code: string; playerId: string }> {
  assertCleanName(playerName);

  const { data, error } = await supabase.rpc("find_or_create_public_room", {
    p_name: playerName,
    p_user_id: userId,
    // Rejoin guard: if this browser already holds a seat in an open public
    // lobby, the function returns that seat instead of inserting a duplicate.
    p_existing_player_id: getStoredPlayerId(),
  });
  if (error) throw error;

  const result = data as { code: string; player_id: string } | null;
  if (!result?.code || !result.player_id) {
    throw new Error("Could not find a public game right now. Please try again.");
  }
  return { code: result.code, playerId: result.player_id };
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

  // Hard 20-player cap. Rejoins (handled above) bypass this — they already
  // hold a seat. There's a tiny race if two people grab the last slot at
  // once; acceptable for in-person play, and the design max is a soft
  // target anyway.
  const { count } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("room_id", room.id);
  if ((count ?? 0) >= MAX_PLAYERS) {
    throw new Error("That room is full (20 players max).");
  }

  const { data: player, error: playerError } = await supabase
    .from("players")
    .insert({ room_id: room.id, user_id: userId, name: playerName, is_host: false })
    .select()
    .single();

  if (playerError) throw playerError;

  // A fresh code-join = a room invite accepted. (Rejoins returned above;
  // public matchmaking uses a different path, so it isn't counted here.)
  trackInviteAccepted("room", (room as Room).id);

  return { room: room as Room, player: player as Player };
}
