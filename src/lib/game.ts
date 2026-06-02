// Game-flow operations.

import { supabase } from "./supabase";
import { assignRoles } from "./assignRoles";
import { rankPlayers } from "./scoring";
import { checkWinner } from "./winConditions";
import { recordGameResults } from "./stats";
import { grantAchievements } from "./achievements";
import { ROLES } from "./roles";
import type { EventSummaryEntry, Player, Room } from "./types";

// How long the guessing minigame runs.
export const MINIGAME_SECONDS = 95;

// How long the role-action window runs at the start of each day.
export const ROLE_ACTION_SECONDS = 30;

// How long the outreach (1-on-1 chat) window runs.
export const OUTREACH_SECONDS = 120;

// How long each consultation voting round runs (first + any re-vote).
// On expiry each active voter auto-skips.
export const CONSULTATION_SECONDS = 95;

// Pre-consultation group-action vote (Eye / Free / Skip).
export const GROUP_ACTION_SECONDS = 60;

// How long the "new day" splash sits between consultation and the next
// day's role-action. It's a transition screen with no real content, so
// a short auto-advance is enough.
export const NEW_DAY_SECONDS = 4;

// Starting Soul Energy granted to every player when the game begins, so
// abilities are usable from day 1 instead of waiting for the first
// minigame to earn anything.
const STARTING_SOUL_ENERGY = 100;

// Starts the game: assigns a role to every player, gives everyone a
// starting Soul Energy, then moves the room into the pre-game Game
// Overview screen (phase list + clickable role list). From there the
// flow is: game_overview -> lore_intro -> role_reveal -> role_action.
export async function startGame(
  roomId: string,
  playerIds: string[]
): Promise<void> {
  const assignments = assignRoles(playerIds);

  await Promise.all(
    assignments.map(({ playerId, roleId }) =>
      supabase
        .from("players")
        .update({
          role: roleId,
          ready: false,
          soul_energy: STARTING_SOUL_ENERGY,
        })
        .eq("id", playerId)
    )
  );

  await supabase
    .from("rooms")
    .update({
      status: "in_game",
      phase: "game_overview",
      // Reset per-game caps in case the row has stale values.
      // Eye gets 1 use per game; Free a prisoner gets 2.
      eye_uses_left: 1,
      free_uses_left: 1,
    })
    .eq("id", roomId);
}

// All players have clicked Proceed on the Game Overview screen.
// Advance everyone to the lore intro card.
export async function endGameOverview(roomId: string): Promise<void> {
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "lore_intro" })
    .eq("id", roomId);
}

// Host clicks Continue on the lore card. Sets a 4-second timer on
// the room (still in lore_intro phase). Every client sees the timer
// via realtime and runs the same staggered animation in sync:
//   0.0s – 0.5s : the lore card fades out
//   0.5s – 1.0s : castle visible, no movement (half-second pause)
//   1.0s – 3.5s : zoom into the castle entrance (2.5-second easeInExpo)
//   3.5s – 4.0s : screen fades to black ("entered the castle")
// The host's client schedules endLoreIntro() for when the timer
// expires (=4s), at which point everyone lands on role_reveal.
export const LORE_ENTRY_SECONDS = 4;

export async function beginLoreEntry(roomId: string): Promise<void> {
  const endsAt = new Date(
    Date.now() + LORE_ENTRY_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("rooms")
    .update({ phase_ends_at: endsAt })
    .eq("id", roomId);
}

// Advance everyone to the role-reveal screen. Called by the host's
// client when the lore-entry timer expires.
export async function endLoreIntro(roomId: string): Promise<void> {
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "role_reveal", phase_ends_at: null })
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
    // Sacrifice: kill both the sacrificer and the target. Justice protect
    // can be applied to either side independently (the sacrificer can
    // survive if THEY are protected, target can survive if THEY are).
    if (p.pending_action === "sacrifice" && p.pending_target) {
      if (!protectedIds.has(p.id)) newlyDeadIds.add(p.id);
      if (!protectedIds.has(p.pending_target)) {
        newlyDeadIds.add(p.pending_target);
      }
    }
  }

  // Envy + Torment: write the day-long effects to the room, but only if
  // the source player survived the resolution (no point in a swap if
  // Envy is dead). We collect updates and write once at the end.
  const roomUpdates: {
    envy_swap_a?: string;
    envy_swap_b?: string;
    torment_target?: string;
  } = {};
  for (const p of players) {
    const sourceSurvived = !newlyDeadIds.has(p.id) && !p.dead;
    if (!sourceSurvived || !p.pending_target) continue;
    if (p.pending_action === "envy_swap") {
      roomUpdates.envy_swap_a = p.id;
      roomUpdates.envy_swap_b = p.pending_target;
    }
    if (p.pending_action === "torment") {
      roomUpdates.torment_target = p.pending_target;
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

  // Murder succession check. If Murder is in newlyDeadIds AND there's
  // at least one surviving non-imprisoned non-hospital Vice they can
  // hand the role to, defer Murder's death and enter the succession
  // sub-phase. If no successor candidate exists, Murder dies normally.
  const dyingMurder = players.find(
    (p) => p.role === "murder" && newlyDeadIds.has(p.id)
  );
  let successionPending = false;
  if (dyingMurder) {
    const candidates = players.filter(
      (p) =>
        p.id !== dyingMurder.id &&
        p.role &&
        ROLES[p.role]?.camp === "vice" &&
        !p.dead &&
        !p.in_prison &&
        !p.in_hospital &&
        !newlyDeadIds.has(p.id)
    );
    if (candidates.length > 0) {
      successionPending = true;
      newlyDeadIds.delete(dyingMurder.id); // defer Murder's death
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

  // Apply Envy / Torment day-long room effects (if any).
  if (Object.keys(roomUpdates).length > 0) {
    await supabase.from("rooms").update(roomUpdates).eq("id", roomId);
  }

  // Capture events for the Event Summary screen. Deaths and
  // hospitalizations only — other effects (protect, envy, torment)
  // are intentionally not surfaced (protect would leak Justice's
  // existence; envy/torment are felt through the minigame itself).
  // Note: deferred-Murder is NOT counted as killed yet (their death
  // is finalised in chooseMurderSuccessor).
  const events: EventSummaryEntry[] = [];
  for (const id of newlyDeadIds) {
    events.push({ type: "killed", target_id: id });
  }
  for (const id of newlyHospitalIds) {
    if (newlyDeadIds.has(id)) continue;
    events.push({ type: "hospitalized", target_id: id });
  }

  // ---- Achievement events (logged-in players only) ----
  // Computed from the pre-resolution snapshot + the resolution sets, so
  // this must run before pending fields are reused next round. Runs in
  // every exit path (succession / win / normal) below.
  const awards: { userId: string; key: string }[] = [];
  const campOf = (pl: Player) => (pl.role ? ROLES[pl.role]?.camp : undefined);
  const byId = new Map(players.map((pl) => [pl.id, pl]));

  for (const p of players) {
    // Kills that actually landed (target not protected).
    if (
      p.pending_action === "kill" &&
      p.pending_target &&
      newlyDeadIds.has(p.pending_target)
    ) {
      const victim = byId.get(p.pending_target);
      if (victim && p.user_id && campOf(p) && campOf(p) === campOf(victim)) {
        awards.push({ userId: p.user_id, key: "kill_teammate" });
      }
      if (p.role === "murder") {
        const newTotal = (p.murder_kills ?? 0) + 1;
        await supabase
          .from("players")
          .update({ murder_kills: newTotal })
          .eq("id", p.id);
        if (p.user_id) {
          if (newTotal >= 3) awards.push({ userId: p.user_id, key: "murder_3" });
          if (newTotal >= 5) awards.push({ userId: p.user_id, key: "murder_5" });
        }
      }
    }
    // Sacrifice taking a same-camp player counts as killing a teammate.
    if (
      p.pending_action === "sacrifice" &&
      p.pending_target &&
      newlyDeadIds.has(p.pending_target)
    ) {
      const victim = byId.get(p.pending_target);
      if (victim && p.user_id && campOf(p) && campOf(p) === campOf(victim)) {
        awards.push({ userId: p.user_id, key: "kill_teammate" });
      }
    }
  }

  // Murdered while hospitalised: any death of a player who was in hospital.
  for (const id of newlyDeadIds) {
    const victim = byId.get(id);
    if (victim?.in_hospital && victim.user_id) {
      awards.push({ userId: victim.user_id, key: "murdered_hospital" });
    }
  }

  // Justice protect that actually blocked a kill/sacrifice on its target.
  for (const prot of players) {
    if (prot.pending_action !== "protect" || !prot.pending_target || !prot.user_id)
      continue;
    const t = prot.pending_target;
    const blockedAKill = players.some(
      (k) =>
        (k.pending_action === "kill" && k.pending_target === t) ||
        (k.pending_action === "sacrifice" &&
          (k.pending_target === t || k.id === t))
    );
    if (blockedAKill) awards.push({ userId: prot.user_id, key: "justice_protect" });
  }

  // Envy escape: Envy swapped (and survived) and the swap victim died.
  if (
    roomUpdates.envy_swap_a &&
    roomUpdates.envy_swap_b &&
    newlyDeadIds.has(roomUpdates.envy_swap_b)
  ) {
    const envyPlayer = byId.get(roomUpdates.envy_swap_a);
    if (envyPlayer?.user_id) {
      awards.push({ userId: envyPlayer.user_id, key: "envy_escape" });
    }
  }

  await grantAchievements(awards);

  // If Murder is dying and has an eligible successor, transition to the
  // succession sub-phase. Win check and minigame are deferred until the
  // successor is chosen. Stash the partial event list on the room — the
  // successor flow will append Murder's death and then continue to the
  // event summary screen.
  if (successionPending && dyingMurder) {
    await supabase
      .from("rooms")
      .update({
        phase: "murder_succession",
        phase_ends_at: null,
        pending_murder_death: dyingMurder.id,
        last_events: events,
      })
      .eq("id", roomId);
    return;
  }

  // Win check using the post-resolution state.
  const playersAfter = players.map((p) =>
    newlyDeadIds.has(p.id) ? { ...p, dead: true } : p
  );
  const winner = checkWinner(playersAfter);

  if (winner) {
    await supabase
      .from("rooms")
      .update({
        // Both camps get a dramatic intro screen before the scoreboard.
        phase:
          winner === "vice" ? "vice_victory_intro" : "virtue_victory_intro",
        status: "ended",
        phase_ends_at: null,
        last_events: events,
      })
      .eq("id", roomId);
    return;
  }

  // Transition to the Event Summary screen. The minigame starts when
  // every player has clicked Proceed on the summary.
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({
      phase: "event_summary",
      phase_ends_at: null,
      last_events: events,
    })
    .eq("id", roomId);
}

// All players have clicked Proceed on the Event Summary screen.
// Continues to the minigame.
export async function endEventSummary(roomId: string): Promise<void> {
  await startMinigame(roomId);
}

// Called by the dying Murder to pick their Vice successor. The death
// is applied, the successor's role becomes "murder", and the game
// continues with a fresh win check + minigame.
export async function chooseMurderSuccessor(
  roomId: string,
  successorId: string
): Promise<void> {
  const { data: roomRow } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .single();
  const room = roomRow as Room | null;
  const dyingId = room?.pending_murder_death;
  if (!dyingId) return;

  await Promise.all([
    supabase.from("players").update({ dead: true }).eq("id", dyingId),
    supabase.from("players").update({ role: "murder" }).eq("id", successorId),
  ]);

  // Append Murder's now-finalised death to the event list (it was
  // stashed by endRoleAction without the Murder kill, since the death
  // was deferred until succession resolved).
  const events: EventSummaryEntry[] = [
    ...(room?.last_events ?? []),
    { type: "killed", target_id: dyingId },
  ];

  await supabase
    .from("rooms")
    .update({
      pending_murder_death: null,
      // Flag the successor so the minigame can show them a "role
      // changed" notification banner. Cleared at the start of the
      // next day in endConsultation.
      recent_successor_id: successorId,
      last_events: events,
    })
    .eq("id", roomId);

  // Win check using the freshly updated players state.
  const { data: rows } = await supabase
    .from("players")
    .select("*")
    .eq("room_id", roomId);
  const players = (rows ?? []) as Player[];
  const winner = checkWinner(players);
  if (winner) {
    await supabase
      .from("rooms")
      .update({
        // Both camps get a dramatic intro screen before the scoreboard.
        phase:
          winner === "vice" ? "vice_victory_intro" : "virtue_victory_intro",
        status: "ended",
        phase_ends_at: null,
      })
      .eq("id", roomId);
    return;
  }

  // Continue through the Event Summary screen so the surviving players
  // see Murder's death (and any other queued events) before the minigame.
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({
      phase: "event_summary",
      phase_ends_at: null,
    })
    .eq("id", roomId);
}

// Moves the room into the minigame: clears everyone's ready flag,
// last-round minigame score, and last-round submission time, and sets
// the shared countdown deadline.
export async function startMinigame(roomId: string): Promise<void> {
  const endsAt = new Date(Date.now() + MINIGAME_SECONDS * 1000).toISOString();
  await supabase
    .from("players")
    .update({
      ready: false,
      minigame_score: 0,
      minigame_submitted_at: null,
    })
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

// Triggers a tie-breaker re-vote in consultation. Clears all current
// votes, stores the list of tied candidates on the room, and resets
// the 95s timer.
export async function startRevote(
  roomId: string,
  candidateIds: string[]
): Promise<void> {
  const endsAt = new Date(
    Date.now() + CONSULTATION_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("players")
    .update({ vote: null })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ revote_candidates: candidateIds, phase_ends_at: endsAt })
    .eq("id", roomId);
}

// Moves the room from the scoreboard into the outreach phase. Resets
// every player's ready flag and sets the shared 95s timer. Called from
// the Result screen when the host's `outreach_enabled` toggle is on.
export async function startOutreach(roomId: string): Promise<void> {
  const endsAt = new Date(Date.now() + OUTREACH_SECONDS * 1000).toISOString();
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "outreach", phase_ends_at: endsAt })
    .eq("id", roomId);
}

// Ends the outreach phase and moves into the group-action phase (the
// simultaneous Vice Revealing Eye + Virtue free-a-prisoner decision)
// that precedes the main consultation.
export async function endOutreach(roomId: string): Promise<void> {
  await startGroupAction(roomId);
}

// Starts the group-action phase. Clears every player's vote so the
// pre-existing vote field is reused for the action choice, and resets
// this round's outcome flags. Sets the 60-second timer.
export async function startGroupAction(roomId: string): Promise<void> {
  const endsAt = new Date(
    Date.now() + GROUP_ACTION_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("players")
    .update({ vote: null })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({
      phase: "group_action",
      phase_ends_at: endsAt,
      group_action_result: null,
      group_action_freed_id: null,
      eye_revealed: false,
    })
    .eq("id", roomId);
}

// Tally the two simultaneous camp actions, apply whichever fired, then
// move straight to consultation.
//   - Vices: more "eye_yes" than "eye_no" among active Vices (and a use
//     left) → the Revealing Eye fires (eye_revealed=true, decrement).
//   - Virtues: among active Virtues' votes, the option with the most
//     votes wins; if that's a prisoner (unique max, and a use left) they
//     are freed. A tie, a "no_free" lead, or no votes frees no one.
// Both can happen in the same round.
export async function endGroupAction(
  roomId: string,
  players: Player[]
): Promise<void> {
  const { data: roomRow } = await supabase
    .from("rooms")
    .select("eye_uses_left, free_uses_left")
    .eq("id", roomId)
    .single();
  const eyeLeft = (roomRow?.eye_uses_left as number | undefined) ?? 0;
  const freeLeft = (roomRow?.free_uses_left as number | undefined) ?? 0;

  const isActive = (p: Player) => !p.dead && !p.in_prison && !p.in_hospital;
  const campOf = (p: Player) => (p.role ? ROLES[p.role]?.camp : undefined);

  // --- Vice Revealing Eye: yes vs no among active Vices ---
  let eyeYes = 0;
  let eyeNo = 0;
  for (const p of players) {
    if (!isActive(p) || campOf(p) !== "vice") continue;
    if (p.vote === "eye_yes") eyeYes += 1;
    else if (p.vote === "eye_no") eyeNo += 1;
  }
  const eyeFires = eyeLeft > 0 && eyeYes > eyeNo;

  // --- Virtue free-a-prisoner: most votes wins among active Virtues ---
  const freeCounts: Record<string, number> = {};
  for (const p of players) {
    if (!isActive(p) || campOf(p) !== "virtue") continue;
    if (!p.vote) continue;
    freeCounts[p.vote] = (freeCounts[p.vote] ?? 0) + 1;
  }
  const freeEntries = Object.entries(freeCounts);
  let freedId: string | null = null;
  if (freeLeft > 0 && freeEntries.length > 0) {
    const max = Math.max(...freeEntries.map(([, c]) => c));
    const top = freeEntries.filter(([, c]) => c === max);
    // Unique winner that isn't "no_free", and is still an imprisoned player.
    if (top.length === 1 && top[0][0] !== "no_free") {
      const candidateId = top[0][0];
      const stillImprisoned = players.some(
        (p) => p.id === candidateId && p.in_prison && !p.dead
      );
      if (stillImprisoned) freedId = candidateId;
    }
  }

  // Apply the freeing (player row) first, then write all room flags.
  if (freedId) {
    await supabase
      .from("players")
      .update({ in_prison: false })
      .eq("id", freedId);
    const freedPlayer = players.find((p) => p.id === freedId);
    if (freedPlayer?.user_id) {
      await grantAchievements([
        { userId: freedPlayer.user_id, key: "freed_prison" },
      ]);
    }
  }

  await supabase
    .from("rooms")
    .update({
      eye_revealed: eyeFires,
      eye_uses_left: eyeFires ? Math.max(0, eyeLeft - 1) : eyeLeft,
      group_action_freed_id: freedId,
      free_uses_left: freedId ? Math.max(0, freeLeft - 1) : freeLeft,
    })
    .eq("id", roomId);

  await startConsultation(roomId);
}

// Moves the room from the scoreboard into the consultation (voting) phase.
// Clears any leftover votes and the vote-reveal flag from a previous round,
// and sets the 95s voting timer.
export async function startConsultation(roomId: string): Promise<void> {
  const endsAt = new Date(
    Date.now() + CONSULTATION_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("players")
    .update({ vote: null })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({
      phase: "consultation",
      vote_reveal: false,
      phase_ends_at: endsAt,
    })
    .eq("id", roomId);
}

// Truthfulness: spend Soul Energy to broadcast who voted for the player
// imprisoned in this consultation. Everyone sees the reveal.
export async function revealVotes(
  playerId: string,
  cost: number,
  currentSoulEnergy: number,
  roomId: string
): Promise<void> {
  await supabase
    .from("players")
    .update({
      soul_energy: currentSoulEnergy - cost,
      acted_this_day: true,
    })
    .eq("id", playerId);
  await supabase.from("rooms").update({ vote_reveal: true }).eq("id", roomId);
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
        // Both camps get a dramatic intro screen before the scoreboard.
        phase:
          winner === "vice" ? "vice_victory_intro" : "virtue_victory_intro",
        status: "ended",
        phase_ends_at: null,
        last_imprisoned_player: imprisonedId,
      })
      .eq("id", roomId);
    return;
  }

  // Move into the "new day" splash screen. A short timer
  // (NEW_DAY_SECONDS) auto-advances to the next day's role-action.
  // The actual day increment + hospital-recovery + envy/torment
  // clearing happens in startNextDay() when the timer expires.
  const endsAt = new Date(
    Date.now() + NEW_DAY_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("rooms")
    .update({
      phase: "new_day",
      phase_ends_at: endsAt,
      last_imprisoned_player: imprisonedId,
    })
    .eq("id", roomId);
}

// Called by the host's client when the "new day" splash timer expires.
// Increments the day, clears day-scoped flags, and opens the next
// day's role-action window.
export async function startNextDay(
  roomId: string,
  currentDay: number
): Promise<void> {
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
      // Envy swap and Torment ink only last one day.
      envy_swap_a: null,
      envy_swap_b: null,
      torment_target: null,
      // Clear any in-progress re-vote state.
      revote_candidates: null,
      // The "role changed" banner is only for the day of the succession.
      recent_successor_id: null,
      // The event list belongs to the previous day; clear it so the
      // next role-action starts fresh.
      last_events: null,
      // Same for the group-action banner — it belonged to yesterday's
      // consultation.
      group_action_result: null,
      group_action_freed_id: null,
      eye_revealed: false,
    })
    .eq("id", roomId);
}

// Lobby-only: removes a player row from the room. Used for both host
// kicks and self-leaves.
export async function kickPlayer(playerId: string): Promise<void> {
  await supabase.from("players").delete().eq("id", playerId);
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

// Sacrifice (instant variant): used outside the role-action phase, this
// kills both the sacrificer and the target immediately, with no protect
// check (protect is a queued action that only resolves at end of
// role-action; if Sacrifice happens outside that window there's nothing
// to compete with).
export async function instantSacrifice(
  roomId: string,
  playerId: string,
  targetId: string,
  players: Player[]
): Promise<void> {
  await Promise.all([
    supabase
      .from("players")
      .update({ dead: true, acted_this_day: true })
      .eq("id", playerId),
    supabase.from("players").update({ dead: true }).eq("id", targetId),
  ]);

  // Two players just died -- check the win condition.
  const playersAfter = players.map((p) =>
    p.id === playerId || p.id === targetId ? { ...p, dead: true } : p
  );
  const winner = checkWinner(playersAfter);
  if (winner) {
    await supabase
      .from("rooms")
      .update({
        // Both camps get a dramatic intro screen before the scoreboard.
        phase:
          winner === "vice" ? "vice_victory_intro" : "virtue_victory_intro",
        status: "ended",
        phase_ends_at: null,
      })
      .eq("id", roomId);
  }
}

// Host clicks Continue on either victory-intro screen.
// Advances to the regular game_over scoreboard and records each
// account's result (best-effort — a stats failure must not block the
// game reaching game_over).
export async function endViceVictoryIntro(roomId: string): Promise<void> {
  await supabase
    .from("rooms")
    .update({ phase: "game_over" })
    .eq("id", roomId);
  await recordGameResults(roomId, "vice").catch((e) =>
    console.error("Failed to record game results", e)
  );
}

export async function endVirtueVictoryIntro(roomId: string): Promise<void> {
  await supabase
    .from("rooms")
    .update({ phase: "game_over" })
    .eq("id", roomId);
  await recordGameResults(roomId, "virtue").catch((e) =>
    console.error("Failed to record game results", e)
  );
}

// Deducts Soul Energy AND queues an action to resolve at the end of the
// role-action phase. Used by Murder, Justice, Intoxication, Vengeance,
// Sacrifice.
export async function queueAction(
  playerId: string,
  cost: number,
  currentSoulEnergy: number,
  action:
    | "kill"
    | "protect"
    | "intox"
    | "vengeance_guess"
    | "sacrifice"
    | "envy_swap"
    | "torment",
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
