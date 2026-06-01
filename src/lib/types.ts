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
  | "group_action_target"
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
  group_action_result: "eye" | "freed" | "skip" | null;
  group_action_freed_id: string | null;
  eye_uses_left: number;
  free_uses_left: number;
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

export type Player = {
  id: string;
  room_id: string;
  name: string;
  is_host: boolean;
  connected: boolean;
  role: string | null;
  ready: boolean;
  minigame_score: number;
  minigame_submitted_at: string | null;
  soul_energy: number;
  vote: string | null; // target player id, "skip", or null
  in_prison: boolean;
  dead: boolean;
  in_hospital: boolean;
  acted_this_day: boolean;
  pending_action: string | null; // e.g. "kill" | "protect" | "intox" | "vengeance_guess"
  pending_target: string | null;
  created_at: string;
};
