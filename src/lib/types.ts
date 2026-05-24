// Shared TypeScript types that mirror the database tables.
// Keep these in sync with db/schema.sql and the migration files.

export type RoomPhase =
  | "lobby"
  | "role_reveal"
  | "role_action"
  | "minigame"
  | "result"
  | "consultation"
  | "game_over";

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

export type Player = {
  id: string;
  room_id: string;
  name: string;
  is_host: boolean;
  connected: boolean;
  role: string | null;
  ready: boolean;
  minigame_score: number;
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
