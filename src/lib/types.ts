// Shared TypeScript types that mirror the database tables.
// Keep these in sync with db/schema.sql.

export type Room = {
  id: string;
  code: string;
  status: "lobby" | "in_game" | "ended";
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
  created_at: string;
};
