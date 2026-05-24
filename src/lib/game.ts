// Game-flow operations.

import { supabase } from "./supabase";
import { assignRoles } from "./assignRoles";
import { rankPlayers } from "./scoring";
import { checkWinner } from "./winConditions";
import type { Player, Room } from "./types";

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
// Resets each player's ready, acted_this_day, and in_hospital flags
// (hospital lasts one day and auto-recovers at the start of the next).
export async function startRoleAction(roomId: string): Promise<void> {
  const endsAt = new Date(
    Date.now() + ROLE_ACTION_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("players")
    .update({ ready: false, acted_this_day: false, in_hospital: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "role_action", phase_ends_at: endsAt })
    .eq("id", roomId);
}

// Ends the role-action phase: resolves queued actions, checks the win
// conditions, and either ends the game or starts the minigame.
//
// Resolution rules:
//   - Protect targets are collected first.
//   - "kill"  → target dies (unless protected).
//   - "intox" → target hospitalized (unless protected). Skipped if the
//               same target was just killed.
//   - "vengeance_guess" → if guessed voter actually voted for the most
//               recently imprisoned player, hospitalize them. Justice
//               protect does NOT block vengeance (per design: protect
//               only blocks Murder and Intoxication).
export async function endRoleAction(roomId: string): Promise<void> {
  const { data: roomRow } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .single();
  const room = roomRow as Room | null;

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

  const newlyHospitalIds = new Set<string>();
  for (const p of players) {
    if (p.pending_action === "intox" && p.pending_target) {
      if (!protectedIds.has(p.pending_target)) {
        newlyHospitalIds.add(p.pending_target);
      }
    }
    if (p.pending_action === "vengeance_guess" && p.pending_target) {
      const guessedVoter = players.find((v) => v.id === p.pending_target);
      const lastImprisoned = room?.last_imprisoned_player ?? null;
      if (
        guessedVoter &&
        lastImprisoned &&
        guessedVoter.vote === lastImprisoned
      ) {
        // Correct guess - hospitalize. Protect does NOT block vengeance.
        newlyHospitalIds.add(p.pending_target);
      }
    }
  }

  // Apply deaths first.
  await Promise.all(
    Array.from(newlyDeadIds).map((id) =>
      supabase.from("players").update({ dead: true }).eq("id", id)
    )
  );

  // Apply hospitalizations - skip any target that just died.
  await Promise.all(
    Array.from(newlyHospitalIds)
      .filter((id) => !newlyDeadIds.has(id))
      .map((id) =>
        supabase.from("players").update({ in_hospital: true }).eq("id", id)
      )
  );

  // Clear queued actions.
  await supabase
    .from("players")
    .update({ pending_action: null, pending_target: null })
    .eq("room_id", roomId);

  // Win check using the post-resolution state.
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
// Clears any leftover votes from a previous consultation.
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

// Ends the consultation: tallies votes, sends the loser (if any) to prison,
// records who was just imprisoned (for Vengeance to read), runs the win
// check, and either ends the game or starts the next day's role-action.
export async function endConsultation(
  roomId: string,
  players: Player[],
  currentDay: number
): Promise<void> {
  const counts: Record<string, number> = {};
  for (const p of players) {
    if (p.in_prison || p.dead || p.in_hospital) continue;
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
        last_imprisoned_player: imprisonedId,
      })
      .eq("id", roomId);
    return;
  }

  // Start the next day's role-action phase. Hospital auto-recovers.
  const endsAt = new Date(
    Date.now() + ROLE_ACTION_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("players")
    .update({
      ready: false,
      minigame_score: 0,
      acted_this_day: false,
      in_hospital: false,
    })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({
      phase: "role_action",
      phase_ends_at: endsAt,
      day: currentDay + 1,
      last_imprisoned_player: imprisonedId,
    })
    .eq("id", roomId);
}

// Deducts Soul Energy and marks the player as having used their ability.
// For abilities that take immediate effect (Empathy, Certainty).
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
// role-action phase. Used by Murder, Justice, Intoxication, Vengeance.
export async function queueAction(
  playerId: string,
  cost: number,
  currentSoulEnergy: number,
  action: "kill" | "protect" | "intox" | "vengeance_guess",
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
