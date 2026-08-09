// Game-flow operations.

import { supabase } from "./supabase";
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

// How long the pre-game role-selection window runs in 'choose' rooms.
export const ROLE_SELECT_SECONDS = 30;

// How long the outreach (1-on-1 chat) window runs.
export const OUTREACH_SECONDS = 120;

// How long the store (individual potion shopping) window runs. Sits between
// outreach and the consultation group action.
export const STORE_SECONDS = 60;

// How long each consultation voting round runs (first + any re-vote).
// On expiry each active voter auto-skips.
export const CONSULTATION_SECONDS = 95;

// How long the "new day" splash sits between consultation and the next
// day's role-action. It's a transition screen with no real content, so
// a short auto-advance is enough.
export const NEW_DAY_SECONDS = 4;

// --- Server-side resolution (Batch 3a) ---
// The heavy role-action resolution now runs in Postgres
// (resolve_role_action / choose_murder_successor) so the host's browser no
// longer needs to read every player's secret. These thin wrappers just
// trigger it. The old client-side endRoleAction / chooseMurderSuccessor
// below are no longer called and will be removed in the lockdown batch.
export async function resolveRoleAction(roomId: string): Promise<void> {
  // Notify correct Worshipper/Seeker guessers BEFORE resolution clears their
  // pending guess (powers the success-only guess animation; migration 095).
  await supabase.rpc("notify_correct_guesses", { p_room_id: roomId });
  await supabase.rpc("resolve_role_action", { p_room_id: roomId });
  // The Wandering Soul's escape is checked AFTER the normal resolution (its
  // guess lives in soul_escape_guess, untouched by resolve_role_action). If he
  // named every active player's camp, this overrides the phase to soul_victory.
  await supabase.rpc("resolve_soul_escape", { p_room_id: roomId });
}

export async function resolveMurderSuccession(
  roomId: string,
  successorId: string
): Promise<void> {
  await supabase.rpc("choose_murder_successor", {
    p_room_id: roomId,
    p_successor_id: successorId,
  });
}

// Consultation resolution (Batch 3b-i) — the tally/imprison/revote and the
// instant Sacrifice now run in Postgres. The old endConsultation /
// startRevote / instantSacrifice below are no longer called.
export async function resolveConsultation(roomId: string): Promise<void> {
  await supabase.rpc("resolve_consultation", { p_room_id: roomId });
}

export async function startRevoteServer(
  roomId: string,
  candidateIds: string[]
): Promise<void> {
  await supabase.rpc("start_revote", {
    p_room_id: roomId,
    p_candidate_ids: candidateIds,
  });
}

export async function instantSacrificeServer(
  roomId: string,
  playerId: string,
  targetIds: string[]
): Promise<void> {
  // Multi-target: first kill free, each extra 200 SE (charged server-side).
  await supabase.rpc("instant_sacrifice", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_targets: targetIds,
  });
}

// Starts the game: assigns a role to every player, gives everyone a
// starting Soul Energy, then moves the room into the pre-game Game
// Overview screen (phase list + clickable role list). From there the
// flow is: game_overview -> lore_intro -> role_reveal -> role_action.
export async function startGame(
  roomId: string,
  playerIds: string[]
): Promise<void> {
  // Roles are assigned entirely server-side (assign_roles_and_start) so
  // even the host never receives the role list. playerIds is unused now —
  // the function reads the room's players itself.
  void playerIds;
  await supabase.rpc("assign_roles_and_start", { p_room_id: roomId });
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

// --- Live role selection ('choose' rooms, migration 063) ---
// The room opens in role_select: every player was dealt a camp + tier and
// picks their role within it. Picks are tentative until locked; camp-mates
// see each other's picks anonymously (by tier) via team_selections.

// One anonymous slot in my camp's selection panel.
export type TeamSlot = {
  tier: string;
  choice: string | null;
  locked: boolean;
  me: boolean;
};

// My own assignment + my camp's current picks (null outside role_select).
export type TeamSelections = {
  camp: "vice" | "virtue" | "neutral"; // neutral = the auto-assigned Wandering Soul
  tier: string;
  choice: string | null;
  locked: boolean;
  team: TeamSlot[];
} | null;

// Tentatively pick (lock=false) or lock in (lock=true) a role within my
// dealt camp + tier. Returns false when the pick is invalid or already locked.
export async function selectRole(
  playerId: string,
  roleId: string,
  lock: boolean
): Promise<boolean> {
  const { data } = await supabase.rpc("select_role", {
    p_player_id: playerId,
    p_role: roleId,
    p_lock: lock,
  });
  return data === true;
}

// My camp's selection state (anonymous by tier). Polled during role_select.
export async function getTeamSelections(
  playerId: string
): Promise<TeamSelections> {
  const { data } = await supabase.rpc("team_selections", {
    p_player_id: playerId,
  });
  return (data as TeamSelections) ?? null;
}

// Whether every player in the room has locked a role (host early-advance).
export async function rolesSelectReady(roomId: string): Promise<boolean> {
  const { data } = await supabase.rpc("roles_select_ready", {
    p_room_id: roomId,
  });
  return data === true;
}

// Ends role_select: stragglers get their tentative pick (else a random role of
// their tier), role_pool is published, and the room moves to role_overview.
export async function resolveRoleSelect(roomId: string): Promise<void> {
  await supabase.rpc("resolve_role_select", { p_room_id: roomId });
}

// All players have seen the role overview (this game's cast). Advance to the
// lore intro. Mirrors endGameOverview.
export async function endRoleOverview(roomId: string): Promise<void> {
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "lore_intro", phase_ends_at: null })
    .eq("id", roomId);
}

// Host clicks Continue on the lore card. Sets a short timer on the room (still
// in lore_intro phase). Every client sees the timer via realtime and plays the
// "abyss flight" cutscene in sync (LoreIntro.tsx) — a 3s flight through the void
// into the castle gate that ends on black ("entered the castle"). The host's
// client schedules endLoreIntro() for when the timer expires (3.5s = the 3s clip
// plus a brief black hold), at which point everyone lands on the next phase.
export const LORE_ENTRY_SECONDS = 3.5;

export async function beginLoreEntry(roomId: string): Promise<void> {
  const endsAt = new Date(
    Date.now() + LORE_ENTRY_SECONDS * 1000
  ).toISOString();
  await supabase
    .from("rooms")
    .update({ phase_ends_at: endsAt })
    .eq("id", roomId);
}

// Called by the host's client when the lore-entry timer expires.
// 'random' rooms go to role_reveal (you haven't seen your secretly-dealt
// card); 'choose' rooms skip it and start the first reflection directly —
// you picked your own role, there's nothing to reveal.
async function advancePastLore(
  roomId: string,
  assignMode: "random" | "choose"
): Promise<void> {
  if (assignMode === "choose") {
    await startRoleAction(roomId);
    return;
  }
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
  await supabase
    .from("rooms")
    .update({ phase: "role_reveal", phase_ends_at: null })
    .eq("id", roomId);
}

export async function endLoreIntro(
  roomId: string,
  assignMode: "random" | "choose" = "random"
): Promise<void> {
  // Straight to the role reveal / first action. The Wandering Soul no longer
  // gets a separate "an anomaly stirs" notification — everyone already sees it
  // listed in the role overview.
  await advancePastLore(roomId, assignMode);
}

// Host clicks Continue on the Wandering Soul intro → on to role reveal / action.
export async function endWanderingSoulIntro(
  roomId: string,
  assignMode: "random" | "choose" = "random"
): Promise<void> {
  await advancePastLore(roomId, assignMode);
}

// The Wandering Soul escaped: record results (the Soul, camp 'neutral', wins;
// both camps lose) and advance to the scoreboard.
export async function endSoulVictoryIntro(roomId: string): Promise<void> {
  await recordGameResults(roomId, "neutral").catch((e) =>
    console.error("Failed to record game results", e)
  );
  await supabase.from("rooms").update({ phase: "game_over" }).eq("id", roomId);
}

// Sets a single player's ready flag.
export async function setReady(
  playerId: string,
  ready: boolean
): Promise<void> {
  await supabase.from("players").update({ ready }).eq("id", playerId);
}

// Clears the ready flag for every player in a room. Used by phases whose
// transition-in doesn't already reset ready (e.g. the victory intros, which
// are reached from SQL resolve_* functions) so their majority-continue
// starts from a clean slate.
export async function resetRoomReady(roomId: string): Promise<void> {
  await supabase.from("players").update({ ready: false }).eq("room_id", roomId);
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
    .update({ phase: "minigame", phase_ends_at: endsAt, minigame_clue: null })
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

  // Minigame x2 potion: consume the armed holders (secret, server-side) and
  // double the Soul Energy they earned this round. Zero earned still doubles
  // to zero (a wrong-guess round wastes the potion, by design).
  const { data: multData } = await supabase.rpc("consume_minigame_mult", {
    p_room_id: roomId,
  });
  const multHolders = new Set((multData as string[] | null) ?? []);

  // Soul Energy is a guarded column (migration 102): clients can't write it
  // directly. The host still computes the awards here, but applies them through
  // a host-gated RPC that adds them server-side (bounded per round).
  const awards = ranked.map(({ player, soulEnergy }) => ({
    player: player.id,
    award: multHolders.has(player.id) ? soulEnergy * 2 : soulEnergy,
  }));
  const { error: awardError } = await supabase.rpc("apply_minigame_awards", {
    p_room_id: roomId,
    p_awards: awards,
  });
  if (awardError) throw awardError;

  // Compute the shared "most-read player" clue server-side (it needs the true
  // roles) and store it on the room for the result screen.
  await supabase.rpc("compute_minigame_clue", { p_room_id: roomId });

  // Clear ready so the Result screen's majority-continue starts fresh.
  await supabase
    .from("players")
    .update({ ready: false })
    .eq("room_id", roomId);
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
// every player's ready flag and sets the shared timer. Outreach is a
// mandatory phase, so the Result screen always advances here.
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

// Ends the outreach phase and moves into the store phase (individual potion
// shopping) that precedes the consultation group action.
export async function endOutreach(roomId: string): Promise<void> {
  await startStore(roomId);
}

// Starts the store phase: each active player can spend Soul Energy on day-long
// potions before the consultation. Resets ready and sets the shopping timer.
export async function startStore(roomId: string): Promise<void> {
  const endsAt = new Date(Date.now() + STORE_SECONDS * 1000).toISOString();
  // enter_store grants +50 SE to every non-imprisoned, non-dead player (hospital
  // included) and sets the phase atomically + idempotently (migration 092).
  await supabase.rpc("enter_store", { p_room_id: roomId, p_ends_at: endsAt });
}

// Ends the store phase: resolves everything bought/used in the shop (combat
// potions + bomb detonations + sacrifices) server-side, which opens the
// store_summary recap (migration 072). The summary then advances to the camp
// abilities via endStoreSummary.
export async function endStore(roomId: string): Promise<void> {
  await supabase.rpc("resolve_store", { p_room_id: roomId });
}

// Ends the store_summary recap and moves straight into the consultation. The
// camp abilities now live in the store (migration 092), so there's no separate
// group-action phase anymore.
export async function endStoreSummary(roomId: string): Promise<void> {
  await startConsultation(roomId);
}

// Buy a store potion (spends the player's Soul Energy, server-authoritative).
// Returns { ok, camp? } for camp-reveal, { ok, vices, virtues } for the
// Revealing Eye (shown only to the buyer).
export async function buyPotion(
  playerId: string,
  potion:
    | "camp_reveal"
    | "eye"
    | "minigame_mult"
    | "kill"
    | "hospitalise"
    | "protect"
    | "vote_reveal"
    | "iron_will",
  targetId?: string
): Promise<{ ok: boolean; camp?: string; vices?: number; virtues?: number; error?: string }> {
  const { data } = await supabase.rpc("buy_potion", {
    p_player_id: playerId,
    p_potion: potion,
    p_target: targetId ?? null,
  });
  return (
    (data as { ok: boolean; camp?: string; vices?: number; virtues?: number; error?: string } | null) ?? {
      ok: false,
      error: "no_response",
    }
  );
}

// Contribute 100 SE toward freeing a prisoner. The pool is communal and persists
// across market phases; at 500 the prisoner is freed (migration 092). Returns
// { ok, freed, pool } — pool is the prisoner's running total (0 once freed).
export async function contributeRelease(
  playerId: string,
  prisonerId: string
): Promise<{ ok: boolean; freed?: boolean; pool?: number; error?: string }> {
  const { data } = await supabase.rpc("contribute_release", {
    p_player_id: playerId,
    p_prisoner: prisonerId,
  });
  return (
    (data as { ok: boolean; freed?: boolean; pool?: number; error?: string } | null) ?? {
      ok: false,
      error: "no_response",
    }
  );
}

// Moves the room from the scoreboard into the consultation (voting) phase.
// Clears any leftover votes and the vote-reveal flag from a previous round,
// and sets the 95s voting timer.
export async function startConsultation(roomId: string): Promise<void> {
  const endsAt = new Date(
    Date.now() + CONSULTATION_SECONDS * 1000
  ).toISOString();
  // Clear the previous round's votes. `vote` lives in player_secrets, so a
  // direct `players` update is a no-op — clear_room_votes resets BOTH
  // player_secrets.vote and players.has_voted. Without this, day 2+ inherits the
  // stale secret votes: every player shows the "you voted" screen while
  // has_voted reads 0, and the round freezes.
  await supabase.rpc("clear_room_votes", { p_room_id: roomId });
  // Clear ready so the result screen's continue — and the imprisonment reveal,
  // which hides once you're ready — start fresh. (Every other phase-start does
  // this; without it the stale ready hides the reveal AND the Continue button.)
  await supabase
    .from("players")
    .update({ ready: false })
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
  // Surface failures — the caller-bound submit_vote gate (migrations 098/099)
  // rejects a browser whose auth session died, and swallowing that made votes
  // silently vanish ("voting doesn't always work"). Throwing lets the
  // consultation screen show the player their vote did NOT land.
  const { error } = await supabase.rpc("submit_vote", {
    p_player_id: playerId,
    p_vote: vote,
  });
  if (error) throw error;
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
      // Pride's minigame block only lasts the day it was cast.
      pride_target: null,
      // Love's tie-break only applies to the day it was armed.
      love_tiebreak: null,
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

// Lobby-only: removes a player row from the room. Used for host kicks of
// OTHER players (the host can't be kicked).
export async function kickPlayer(playerId: string): Promise<void> {
  await supabase.from("players").delete().eq("id", playerId);
}

// A player leaves the lobby. If they're the host, the oldest remaining
// player (the "second to join") is promoted to host first — atomic via RPC,
// so the lobby is never left host-less.
export async function leaveRoom(playerId: string): Promise<void> {
  await supabase.rpc("leave_room", { p_player_id: playerId });
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
  // Record results BEFORE flipping to game_over so the scoreboard (and
  // its "new badges" computation) sees this game's results immediately.
  await recordGameResults(roomId, "vice").catch((e) =>
    console.error("Failed to record game results", e)
  );
  await supabase
    .from("rooms")
    .update({ phase: "game_over" })
    .eq("id", roomId);
}

export async function endVirtueVictoryIntro(roomId: string): Promise<void> {
  await recordGameResults(roomId, "virtue").catch((e) =>
    console.error("Failed to record game results", e)
  );
  await supabase
    .from("rooms")
    .update({ phase: "game_over" })
    .eq("id", roomId);
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
    | "torment"
    | "worshipper_guess"
    | "seeker_guess",
  targetId: string
): Promise<void> {
  // currentSoulEnergy is no longer used (the server reads the live value).
  // For 'sacrifice', targetId is a JSON array string of target ids.
  await supabase.rpc("queue_action", {
    p_player_id: playerId,
    p_cost: cost,
    p_action: action,
    p_target: targetId,
  });
}

// Wandering Soul (migration 094): submit the camp guess for every active player
// ({playerId: 'vice'|'virtue'}). If all are correct it resolves to an escape win
// after role_action. Held in soul_escape_guess, so it survives resolution.
export async function submitSoulEscape(
  playerId: string,
  guess: Record<string, "vice" | "virtue">
): Promise<boolean> {
  const { data } = await supabase.rpc("submit_soul_escape", {
    p_player_id: playerId,
    p_guess: guess,
  });
  return data === true;
}

// Wandering Soul's 100 SE ward: one cycle of immunity to prison, kill, and
// hospitalisation. Bought in the Market; only the Soul can buy it.
export async function buySoulWard(
  playerId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabase.rpc("buy_soul_ward", { p_player_id: playerId });
  return (data as { ok: boolean; error?: string } | null) ?? { ok: false };
}

// Vote-reveal potion: the ids of players currently voting to imprison you this
// consultation. Returns [] unless you armed the potion (gated server-side).
export async function myVoters(playerId: string): Promise<string[]> {
  const { data } = await supabase.rpc("my_voters", { p_player_id: playerId });
  return (data as string[] | null) ?? [];
}

// Empathy 2nd ability: reveal one player's camp ('vice' | 'virtue' | null).
export async function revealCamp(
  playerId: string,
  targetId: string
): Promise<string | null> {
  const { data } = await supabase.rpc("reveal_camp", {
    p_player_id: playerId,
    p_target_id: targetId,
  });
  return (data as string | null) ?? null;
}

// Vice Worshipper / Virtue Seeker: privately reveal yourself to one player.
export async function revealSelf(
  playerId: string,
  targetId: string
): Promise<boolean> {
  const { data } = await supabase.rpc("reveal_self", {
    p_player_id: playerId,
    p_target_id: targetId,
  });
  return data === true;
}

// Imprisoned Vengeance: the still-alive jailers she may still kill.
export async function vengeanceRevengeTargets(
  playerId: string
): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.rpc("vengeance_revenge_targets", {
    p_player_id: playerId,
  });
  return (data as { id: string; name: string }[] | null) ?? [];
}

// Imprisoned Vengeance: queue a 150-SE revenge kill on a jailer.
export async function queueVengeanceRevenge(
  playerId: string,
  targetId: string
): Promise<boolean> {
  const { data } = await supabase.rpc("queue_vengeance_revenge", {
    p_player_id: playerId,
    p_target: targetId,
  });
  return data === true;
}

// --- New-role abilities, batch 1 (migration 066) ---

// Determination: buy one stackable extra life (100 SE). Returns the new total.
export async function buyExtraLife(
  playerId: string
): Promise<{ ok: boolean; extra_lives?: number }> {
  const { data } = await supabase.rpc("buy_extra_life", { p_player_id: playerId });
  return (data as { ok: boolean; extra_lives?: number } | null) ?? { ok: false };
}

// Generosity: gift a player 100 Soul Energy (100 SE).
export async function giftSoulEnergy(
  playerId: string,
  targetId: string
): Promise<boolean> {
  const { data } = await supabase.rpc("gift_soul_energy", {
    p_player_id: playerId,
    p_target_id: targetId,
  });
  return (data as { ok: boolean } | null)?.ok === true;
}

// Generosity: grant a player a lasting extra life (200 SE).
export async function grantExtraLife(
  playerId: string,
  targetId: string
): Promise<boolean> {
  const { data } = await supabase.rpc("grant_extra_life", {
    p_player_id: playerId,
    p_target_id: targetId,
  });
  return (data as { ok: boolean } | null)?.ok === true;
}

// Gambling: roll one die (100 SE). The face decides the ability (see
// gambling_roll). `kind` is the outcome; `needs_target` means a roll of 4/6
// that still needs a target chosen via gamblingPickTarget.
export type GambleKind =
  | "self_hospital"
  | "no_minigame"
  | "minigame_mult"
  | "hospital"
  | "extra_life"
  | "kill";

export async function gamblingRoll(
  playerId: string
): Promise<{
  ok: boolean;
  roll?: number;
  kind?: GambleKind;
  needs_target?: boolean;
}> {
  const { data } = await supabase.rpc("gambling_roll", {
    p_player_id: playerId,
  });
  return (
    (data as {
      ok: boolean;
      roll?: number;
      kind?: GambleKind;
      needs_target?: boolean;
    } | null) ?? { ok: false }
  );
}

// Gambling: after a roll of 4 (hospitalise) or 6 (kill), name the target.
export async function gamblingPickTarget(
  playerId: string,
  targetId: string
): Promise<{ ok: boolean }> {
  const { data } = await supabase.rpc("gambling_pick_target", {
    p_player_id: playerId,
    p_target_id: targetId,
  });
  return (data as { ok: boolean } | null) ?? { ok: false };
}

// Pride: reveal yourself to a random player who then scores 0 in the minigame
// (100 SE). Returns the revealed-to player's name.
export async function prideReveal(
  playerId: string
): Promise<{ ok: boolean; target_name?: string }> {
  const { data } = await supabase.rpc("pride_reveal", { p_player_id: playerId });
  return (data as { ok: boolean; target_name?: string } | null) ?? { ok: false };
}

// Diligence: pay 100 SE to learn how many of this round's guesses were correct.
export async function diligenceCount(
  playerId: string
): Promise<{ ok: boolean; correct?: number }> {
  const { data } = await supabase.rpc("diligence_count", {
    p_player_id: playerId,
  });
  return (data as { ok: boolean; correct?: number } | null) ?? { ok: false };
}

// --- New-role abilities, batch 2: Wrath / Love (migration 067) ---

// Wrath/Love: queue a conversion on a target (200 SE, charged now). It resolves
// at the END of role-action: it lands only on a still-alive, non-S role of the
// wanted camp (Wrath → Virtue → Vice Worshipper/follower; Love → Vice → Virtue
// Seeker). `ok` just means it was queued; the outcome comes back as a notice.
export async function convertPlayer(
  playerId: string,
  targetId: string
): Promise<{ ok: boolean; queued?: boolean }> {
  const { data } = await supabase.rpc("convert_player", {
    p_player_id: playerId,
    p_target_id: targetId,
  });
  return (data as { ok: boolean; queued?: boolean } | null) ?? { ok: false };
}

// Wrath: give up one living follower for a lasting extra life (100 SE).
export async function relinquishFollower(
  playerId: string
): Promise<boolean> {
  const { data } = await supabase.rpc("relinquish_follower", {
    p_player_id: playerId,
  });
  return (data as { ok: boolean } | null)?.ok === true;
}

// Love: arm this day's consultation tie-break (100 SE).
export async function armTiebreak(playerId: string): Promise<boolean> {
  const { data } = await supabase.rpc("arm_tiebreak", {
    p_player_id: playerId,
  });
  return (data as { ok: boolean } | null)?.ok === true;
}

// Wrath: how many living followers you currently hold (for the relinquish UI).
export async function myFollowerCount(playerId: string): Promise<number> {
  const { data } = await supabase.rpc("my_follower_count", {
    p_player_id: playerId,
  });
  return typeof data === "number" ? data : 0;
}

// --- New-role abilities, batch 3: Fanaticism / bombs (migration 068) ---

// Fanaticism: plant a bomb on a target (100 SE, one reflection action/day,
// up to 2 per game). The target holds it secretly until they must pass it on.
export async function plantBomb(
  playerId: string,
  targetId: string
): Promise<{ ok: boolean; bomb_id?: number; reason?: string }> {
  const { data } = await supabase.rpc("plant_bomb", {
    p_fanatic: playerId,
    p_target: targetId,
  });
  return (
    (data as { ok: boolean; bomb_id?: number; reason?: string } | null) ?? {
      ok: false,
    }
  );
}

// Fanaticism: pay 100 SE to see who currently carries your bombs.
export async function bombCarriers(
  playerId: string
): Promise<{ ok: boolean; carriers?: { id: number; name: string }[] }> {
  const { data } = await supabase.rpc("bomb_carriers", { p_fanatic: playerId });
  return (
    (data as { ok: boolean; carriers?: { id: number; name: string }[] } | null) ?? {
      ok: false,
    }
  );
}

// Any bomb-holder: choose who to pass your bomb to this reflection (free).
export async function passBomb(
  holderId: string,
  targetId: string
): Promise<boolean> {
  const { data } = await supabase.rpc("pass_bomb", {
    p_holder: holderId,
    p_target: targetId,
  });
  return (data as { ok: boolean } | null)?.ok === true;
}

// Fanaticism: arm one of your bombs to detonate (150 SE, shop phase). It fires
// when the shop closes (resolve_store), killing the blind holder; the result
// comes back as a private notice. `armed` confirms it's set.
export async function detonateBomb(
  playerId: string,
  bombId: number
): Promise<{ ok: boolean; armed?: boolean }> {
  const { data } = await supabase.rpc("detonate_bomb", {
    p_fanatic: playerId,
    p_bomb_id: bombId,
  });
  return (data as { ok: boolean; armed?: boolean } | null) ?? { ok: false };
}

// Fanaticism: bombs planted / remaining / active — drives the plant UI.
export async function fanaticState(
  playerId: string
): Promise<{ ok: boolean; planted?: number; remaining?: number; active?: number }> {
  const { data } = await supabase.rpc("fanatic_state", { p_fanatic: playerId });
  return (
    (data as
      | { ok: boolean; planted?: number; remaining?: number; active?: number }
      | null) ?? { ok: false }
  );
}

// Fanaticism: your active bombs (blind — id + whether the holder is alive +
// whether it's already armed this shop) for the shop detonate UI.
export async function myBombs(
  playerId: string
): Promise<{ id: number; alive: boolean; armed: boolean }[]> {
  const { data } = await supabase.rpc("my_bombs", { p_fanatic: playerId });
  return Array.isArray(data)
    ? (data as { id: number; alive: boolean; armed: boolean }[])
    : [];
}
