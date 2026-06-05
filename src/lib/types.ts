// Shared TypeScript types that mirror the database tables.
// Keep these in sync with db/schema.sql and the migration files.

export type RoomPhase =
  | "lobby"
  | "game_overview"
  | "lore_intro"
  | "role_reveal"
  | "role_action"
  | "murder_succession"
  | "event_summary"
  | "minigame"
  | "result"
  | "outreach"
  | "group_action"
  | "consultation"
  | "new_day"
  | "vice_victory_intro"
  | "virtue_victory_intro"
  | "game_over";

// One entry written to rooms.last_events by endRoleAction and read by
// the Event Summary screen.
export type EventSummaryEntry = {
  type: "killed" | "hospitalized";
  target_id: string;
};

export type Room = {
  id: string;
  code: string;
  status: "lobby" | "in_game" | "ended";
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
  avatar_url: string | null;
  featured_badges: string[]; // up to 2 badge ids shown next to your name
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
  acted_this_day: boolean;
  pending_action: string | null; // e.g. "kill" | "protect" | "intox" | "vengeance_guess"
  pending_target: string | null;
  murder_kills: number; // per-game kills landed while holding Murder (badges)
  created_at: string;
  // Client-only per-viewer flags, merged into MY player from get_my_secrets
  // (so the underlying room "tells" never reach the browser). Undefined for
  // other players.
  is_dying_murder?: boolean;
  is_recent_successor?: boolean;
  is_tormented?: boolean;
};
