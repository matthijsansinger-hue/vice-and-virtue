// Shared TypeScript types that mirror the database tables.
// Keep these in sync with db/schema.sql and the migration files.

export type RoomPhase = "lobby" | "role_reveal" | "minigame" | "result";

export type Room = {
  id: string;
  code: string;
  status: "lobby" | "in_game" | "ended";
  phase: RoomPhase;
  phase_ends_at: string | null;
  day: number;
  outreach_enabled: boolean;
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
  created_at: string;
};
