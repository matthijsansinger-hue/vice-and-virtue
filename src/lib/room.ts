// Room operations: creating a new room and joining an existing one.

import { supabase } from "./supabase";
import { ensureSession } from "./auth";
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
  // Bind this player row to a real identity (account or anonymous) so the
  // server can later enforce "only you can act as you".
  await ensureSession();
  const uid = (await supabase.auth.getUser()).data.user?.id ?? userId ?? null;

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
      .insert({ room_id: room.id, user_id: uid, name: playerName, is_host: true })
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
  await ensureSession();
  const uid = (await supabase.auth.getUser()).data.user?.id ?? userId ?? null;

  const { data, error } = await supabase.rpc("find_or_create_public_room", {
    p_name: playerName,
    p_user_id: uid,
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

// A lobby that never starts is removed this many minutes after it was created,
// and everyone in it is sent back to the start screen. Kept in sync with the
// '10 minutes' interval in migration 055 (db/055_lobby_expiry.sql) — change
// both together.
export const LOBBY_EXPIRY_MINUTES = 10;

// Deletes every lobby that was created but never started within
// LOBBY_EXPIRY_MINUTES. Safe to call from any client: the SECURITY DEFINER RPC
// only removes rooms still in the 'lobby' status past the cutoff (never a live
// game), re-checked against server time. The lobby countdown calls this the
// instant it hits zero, so an AFK host's room closes immediately instead of
// waiting for the periodic cron janitor. Cleanup also cascades to the room's
// players + chat rows; durable account history is untouched.
export async function expireStaleLobbies(): Promise<void> {
  const { error } = await supabase.rpc("expire_stale_lobbies");
  if (error) throw error;
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

// Flips a lobby between the two role-assignment modes (migration 064):
// 'choose' = players pick their role live at game start (ranked-style);
// 'random' = roles are dealt secretly per the host's configuration.
// Host-only in the UI; open RLS + realtime, like the visibility toggle.
export async function setRoleAssignMode(
  roomId: string,
  mode: "choose" | "random"
): Promise<void> {
  const { error } = await supabase
    .from("rooms")
    .update({ role_assign_mode: mode })
    .eq("id", roomId);
  if (error) throw error;
}

// Saves the host's random-mode role configuration: per camp, per tier, which
// role fills that slot ({"vice": {"C": "torment"}, ...}). Unset/invalid slots
// fall back to the server defaults (validated by vv_config_slot at start).
export async function setRoleConfig(
  roomId: string,
  config: Record<string, Partial<Record<string, string>>>
): Promise<void> {
  const { error } = await supabase
    .from("rooms")
    .update({ role_config: config })
    .eq("id", roomId);
  if (error) throw error;
}

// Flips a room between Casual and Ranked. In a ranked game, account players'
// ladder points move at game end (guests are unaffected). Host-only in the UI;
// open RLS + realtime push the change to every client in the lobby.
export async function setRoomRanked(
  roomId: string,
  isRanked: boolean
): Promise<void> {
  const { error } = await supabase
    .from("rooms")
    .update({ is_ranked: isRanked })
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
  await ensureSession();
  const uid = (await supabase.auth.getUser()).data.user?.id ?? userId ?? null;

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
    .insert({ room_id: room.id, user_id: uid, name: playerName, is_host: false })
    .select()
    .single();

  if (playerError) throw playerError;

  // A fresh code-join = a room invite accepted. (Rejoins returned above;
  // public matchmaking uses a different path, so it isn't counted here.)
  trackInviteAccepted("room", (room as Room).id);

  return { room: room as Room, player: player as Player };
}

// End-screen re-queue: atomically claim a finished room's `next_room_code` slot
// (only if still empty) and return the winning code — whoever's tap landed first.
// Routed through a SECURITY DEFINER RPC because `rooms` is host-write-locked
// (migration 103): any participant may set the re-queue target, but not via a
// direct table write. Returns null only if the room vanished.
export async function claimRequeue(
  roomId: string,
  code: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("claim_requeue", {
    p_room_id: roomId,
    p_code: code,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}
