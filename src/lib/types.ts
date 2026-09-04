// Shared TypeScript types that mirror the database tables.
// Keep these in sync with db/schema.sql and the migration files.

import type { CharacterConfig } from "./character";

export type RoomPhase =
  | "lobby"
  | "game_overview"
  | "role_select"
  | "role_overview"
  | "lore_intro"
  | "wandering_soul_intro" // one-time anomaly intro (only when the Soul is in play)
  | "role_reveal"
  | "role_action"
  | "murder_succession"
  | "event_summary"
  | "minigame"
  | "result"
  | "outreach"
  | "store"
  | "store_summary"
  | "consultation"
  | "new_day"
  | "vice_victory_intro"
  | "virtue_victory_intro"
  | "soul_victory_intro" // the Wandering Soul escaped and won
  | "game_over";

// One entry written to rooms.last_events by endRoleAction and read by
// the Event Summary screen.
export type EventSummaryEntry = {
  type: "killed" | "hospitalized";
  target_id: string;
};

// Published on rooms.minigame_clue after each minigame: the player the most
// others read correctly (target_id) + how many got them right (correct/total).
// target_id is null when nobody was clearly read. Never includes the camp.
export type MinigameClue = {
  target_id: string | null;
  correct?: number;
  total?: number;
};

export type Room = {
  id: string;
  code: string;
  status: "lobby" | "in_game" | "ended";
  is_public: boolean; // discoverable via "Find Public Session" matchmaking (private = code-only)
  is_ranked: boolean; // ranked game: ladder points apply at game end
  phase: RoomPhase;
  phase_ends_at: string | null;
  day: number;
  outreach_enabled: boolean;
  last_imprisoned_player: string | null;
  vote_reveal: boolean;
  envy_swap_a: string | null;
  envy_swap_b: string | null;
  torment_target: string | null;
  pending_murder_death: string | null;
  revote_candidates: string[] | null;
  recent_successor_id: string | null;
  last_events: EventSummaryEntry[] | null;
  group_action_result: "eye" | "freed" | "skip" | null; // legacy; superseded by eye_revealed + group_action_freed_id
  group_action_freed_id: string | null;
  eye_revealed: boolean;
  eye_uses_left: number;
  free_uses_left: number;
  role_pool: string[] | null; // the set of role ids in this game (Game Overview list)
  next_room_code: string | null; // re-queue: code of the new lobby created from the end screen
  minigame_clue: MinigameClue | null; // shared post-minigame clue (most-read player + counts)
  role_assign_mode: "random" | "choose"; // 'choose' = live role_select (skips role_reveal); 'random' = secret deal + role_reveal
  role_config?: Record<string, Partial<Record<string, string>>> | null; // host per-tier role config for random mode (lobby batch)
  winner?: string | null; // 'neutral' when the Wandering Soul escaped (migration 094); camp wins stay null
  created_at: string;
};

export type Message = {
  id: string;
  room_id: string;
  camp: "vice" | "virtue";
  sender_id: string;
  text: string;
  created_at: string;
};

export type DirectMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  recipient_id: string;
  day: number | null;
  text: string;
  created_at: string;
};

export type ConsultationMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  day: number;
  text: string;
  created_at: string;
};

export type DeadMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  text: string;
  created_at: string;
};

// A registered account's public profile (mirrors the `profiles` table).
// Email lives in Supabase auth.users and is never exposed here.
export type Profile = {
  id: string;
  username: string;
  favorite_role: string | null;
  appearance: CharacterConfig | null; // customizable layered avatar (migration 091); null = not made yet ("character" is a reserved SQL word)
  featured_badges: string[]; // up to 2 badge ids shown next to your name
  name_color: string | null; // equipped name-color tier id (migration 080), or null
  banner_color: string | null; // equipped banner-color tier id (migration 080), or null
  created_at: string;
};

// One row per account per finished game (mirrors the game_results table).
export type GameResult = {
  id: string;
  user_id: string;
  room_id: string;
  role: string | null;
  camp: "vice" | "virtue" | null;
  won: boolean;
  created_at: string;
};

// A friendship/request between two accounts (mirrors the friendships table).
export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: string;
};

export type Player = {
  id: string;
  room_id: string;
  user_id: string | null; // account this row belongs to, null for guests
  name: string;
  is_host: boolean;
  connected: boolean;
  role: string | null;
  ready: boolean;
  minigame_score: number;
  minigame_submitted_at: string | null;
  soul_energy: number;
  vote: string | null; // target player id, "skip", or null
  has_voted: boolean; // public mirror of (vote !== null) — for vote counts without revealing the target
  in_prison: boolean;
  dead: boolean;
  in_hospital: boolean;
  release_pool: number; // communal SE toward freeing this prisoner (migration 092); 0 unless imprisoned
  acted_this_day: boolean;
  pending_action: string | null; // e.g. "kill" | "protect" | "intox" | "sacrifice" | "vengeance_kill" (jsonb array target)
  pending_target: string | null;
  murder_kills: number; // per-game kills landed while holding Murder (badges)
  muted: boolean;
  // Silenced by Sociability for this in-game day (migration 115). Distinct from
  // `muted`, which is the sticky report auto-mute — an ability must never clear
  // a moderation mute.
  ability_muted_day: number | null; // silenced by moderation (auto-mute after repeated reports)
  created_at: string;
  // Client-only per-viewer flags, merged into MY player from get_my_secrets
  // (so the underlying room "tells" never reach the browser). Undefined for
  // other players.
  is_dying_murder?: boolean;
  is_recent_successor?: boolean;
  is_tormented?: boolean;
  extra_lives?: number; // my stored extra lives (migration 066); own player only
  bomb_must_pass?: boolean; // I hold a Fanaticism bomb I must pass this reflection (migration 068); own player only
  bomb_pass_to?: string | null; // who I've chosen to pass it to (own player only)
};
