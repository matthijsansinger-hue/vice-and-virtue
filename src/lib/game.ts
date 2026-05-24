// Game-flow operations.

import { supabase } from "./supabase";
import { assignRoles } from "./assignRoles";
import { rankPlayers } from "./scoring";
import { checkWinner } from "./winConditions";
import type { Player } from "./types";

// How long the guessing minigame runs.
export const MINIGAME_SECONDS = 95;

// How long the role-action window runs at the start of each day.
export const ROLE_ACTION_SECONDS = 30;

// Starts the game: assigns a role to every player, then moves the room
// into the role-reveal phase.
export async function startGame(
  roomId: string,
  playerIds: string[]
): Promise<void> {
  const assignments = assignRoles(playerIds);

  await Promise.all(
    assignments.map(({ playerId, roleId }) =>
      supabase
        .from("players")
        .update({ role: roleId, ready: false })
        .eq("id", playerId)
    )
  );

  await supabase
    .from("rooms")
    .update({ status: "in_game", phase: "role_reveal" })
    .eq("id", roomId);
}

// Sets a single player's ready flag.
export async function setReady(
  playerId: string,
  ready: boolean
): Promise<void> {
  await supabase.from("players").update({ ready }).eq("id", playerId);
}

// Moves the room into the role-action phase (30s window for abilities).
// Resets each player's ready and acted_this_day flags.
export async function startRoleAction(roomId: string): Promise<void> {
  const endsAt = new Date(
    Date.now() + ROLE_ACTION_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("players")
    .update({ ready: false, acted_this_day: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "role_action", phase_ends_at: endsAt })
    .eq("id", roomId);
}

// Ends the role-action phase: resolves any queued kill/protect actions,
// checks the win conditions, and either ends the game or starts the
// minigame.
//
// Resolution rule (design template, section 10.2):
//   - First, collect everyone who has been protected.
//   - Then, any "kill" whose target is NOT protected applies; the target
//     dies.
//   - Pending actions and protect flags are cleared at the end.
export async function endRoleAction(roomId: string): Promise<void> {
  const { data: rows } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId);
  const players = (rows ?? []) as Player[];

  const protectedIds = new Set(
    players
      .filter((p) => p.pending_action === "protect" && p.pending_target)
      .map((p) => p.pending_target as string)
  );

  const newlyDeadIds = new Set<string>();
  for (const p of players) {
    if (p.pending_action === "kill" && p.pending_target) {
      if (!protectedIds.has(p.pending_target)) {
        newlyDeadIds.add(p.pending_target);
      }
    }
  }

  // Apply deaths.
  await Promise.all(
    Array.from(newlyDeadIds).map((id) =>
      supabase.from("players").update({ dead: true }).eq("id", id)
    )
  );

  // Clear queued actions for everyone.
  await supabase
    .from("players")
    .update({ pending_action: null, pending_target: null })
    .eq("room_id", roomId);

  // Check win conditions using the post-resolution state.
  const playersAfter = players.map((p) =>
    newlyDeadIds.has(p.id) ? { ...p, dead: true } : p
  );
  const winner = checkWinner(playersAfter);

  if (winner) {
    await supabase
      .from("rooms")
      .update({
        phase: "game_over",
        status: "ended",
        phase_ends_at: null,
      })
      .eq("id", roomId);
    return;
  }

  // Otherwise, proceed to the minigame.
  await startMinigame(roomId);
}

// Moves the room into the minigame: clears everyone's ready flag and
// last-round minigame score, and sets the shared countdown deadline.
export async function startMinigame(roomId: string): Promise<void> {
  const endsAt = new Date(Date.now() + MINIGAME_SECONDS * 1000).toISOString();
  await supabase
    .from("players")
    .update({ ready: false, minigame_score: 0 })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "minigame", phase_ends_at: endsAt })
    .eq("id", roomId);
}

// Ends the minigame: ranks all players, awards Soul Energy, and moves
// the room into the result phase.
export async function endMinigame(roomId: string): Promise<void> {
  const { data: rows } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId);
  const players = (rows ?? []) as Player[];

  const ranked = rankPlayers(players);
  await Promise.all(
    ranked.map(({ player, soulEnergy }) =>
      supabase
        .from("players")
        .update({ soul_energy: player.soul_energy + soulEnergy })
        .eq("id", player.id)
    )
  );

  await supabase
    .from("rooms")
    .update({ phase: "result", phase_ends_at: null })
    .eq("id", roomId);
}

// Moves the room from the scoreboard into the consultation (voting) phase.
// Clears any leftover votes from a previous consultation. (We DON'T clear
// votes when consultation ends, because Empathy needs them to survive
// into the next day's role-action phase.)
export async function startConsultation(roomId: string): Promise<void> {
  await supabase
    .from("players")
    .update({ vote: null })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "consultation" })
    .eq("id", roomId);
}

// Records a player's vote: another player's id, the string "skip", or null
// to clear.
export async function setVote(
  playerId: string,
  vote: string | null
): Promise<void> {
  await supabase.from("players").update({ vote }).eq("id", playerId);
}

// Ends the consultation: tallies the votes, sends the loser (if any) to
// prison, checks the win conditions, and either ends the game or starts
// the next day's role-action phase.
export async function endConsultation(
  roomId: string,
  players: Player[],
  currentDay: number
): Promise<void> {
  const counts: Record<string, number> = {};
  for (const p of players) {
    if (p.in_prison || p.dead) continue;
    if (!p.vote) continue;
    counts[p.vote] = (counts[p.vote] ?? 0) + 1;
  }
  const skipCount = counts["skip"] ?? 0;
  delete counts["skip"];

  let imprisonedId: string | null = null;
  const entries = Object.entries(counts);
  if (entries.length > 0) {
    const maxCount = Math.max(...entries.map(([, c]) => c));
    if (maxCount > skipCount) {
      const top = entries.filter(([, c]) => c === maxCount);
      if (top.length === 1) imprisonedId = top[0][0];
    }
  }

  if (imprisonedId) {
    await supabase
      .from("players")
      .update({ in_prison: true })
      .eq("id", imprisonedId);
  }

  const playersAfter = players.map((p) =>
    p.id === imprisonedId ? { ...p, in_prison: true } : p
  );
  const winner = checkWinner(playersAfter);

  if (winner) {
    await supabase
      .from("rooms")
      .update({
        phase: "game_over",
        status: "ended",
        phase_ends_at: null,
      })
      .eq("id", roomId);
    return;
  }

  const endsAt = new Date(
    Date.now() + ROLE_ACTION_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("players")
    .update({ ready: false, minigame_score: 0, acted_this_day: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({
      phase: "role_action",
      phase_ends_at: endsAt,
      day: currentDay + 1,
    })
    .eq("id", roomId);
}

// Deducts Soul Energy and marks the player as having used their ability.
// Used by abilities that take immediate effect (Empathy, Certainty).
export async function spendSoulEnergy(
  playerId: string,
  cost: number,
  currentSoulEnergy: number
): Promise<void> {
  await supabase
    .from("players")
    .update({
      soul_energy: currentSoulEnergy - cost,
      acted_this_day: true,
    })
    .eq("id", playerId);
}

// Deducts Soul Energy AND queues an action to resolve at the end of the
// role-action phase. Used by Murder, Justice, etc.
export async function queueAction(
  playerId: string,
  cost: number,
  currentSoulEnergy: number,
  action: "kill" | "protect",
  targetId: string
): Promise<void> {
  await supabase
    .from("players")
    .update({
      soul_energy: currentSoulEnergy - cost,
      acted_this_day: true,
      pending_action: action,
      pending_target: targetId,
    })
    .eq("id", playerId);
}
