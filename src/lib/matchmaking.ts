// Preference matchmaking for public + ranked (migration 117).
//
// On pressing Play you pick one class you'd like for Vice and one for Virtue —
// you don't know which camp you'll be dealt, so both are asked. The matchmaker
// builds a lobby of 4v4 where everyone lands on a preference where possible,
// and after QUEUE_PATIENCE_MS anyone still waiting becomes eligible to be
// placed in any free slot, so a contested queue can't deadlock.
//
// Replaces rankedQueue.ts's 3v3/5v5 mode queue.

import { supabase } from "./supabase";
import { CLASS_PAIRS, type RoleClass, type ViceClass, type VirtueClass } from "./roles";

export type QueueKind = "public" | "ranked";

// 4 classes a camp, so a full lobby is 8 and every seat is a real class —
// nobody is dealt a filler. Mirrors c_seats in form_match.
export const SEATS_PER_CAMP = 4;
export const MATCH_SIZE = SEATS_PER_CAMP * 2;

// Mirrors c_patience in form_match. Used for the "still looking…" copy, not for
// any decision — the server owns the actual grace period.
export const QUEUE_PATIENCE_MS = 60_000;

export const VICE_CLASSES: ViceClass[] = CLASS_PAIRS.map(([v]) => v);
export const VIRTUE_CLASSES: VirtueClass[] = CLASS_PAIRS.map(([, t]) => t);

export type ClassPreference = {
  vice: ViceClass;
  virtue: VirtueClass;
};

export type QueueCounts = Record<QueueKind, number>;

export type MyQueue = {
  kind: QueueKind;
  status: "waiting" | "matched";
  roomCode: string | null;
  joinedAt: string;
  pref: { vice: string | null; virtue: string | null };
} | null;

// Join, or update your preferences without losing your place in line.
export async function joinQueue(
  kind: QueueKind,
  name: string,
  pref: ClassPreference
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc("join_queue", {
    p_kind: kind,
    p_name: name,
    p_pref_vice: pref.vice,
    p_pref_virtue: pref.virtue,
  });
  if (error) throw error;
  return (data as { ok: boolean; reason?: string } | null) ?? { ok: false };
}

export async function leaveQueue(): Promise<void> {
  const { error } = await supabase.rpc("leave_queue");
  if (error) throw error;
}

export async function getQueueCounts(): Promise<QueueCounts> {
  const { data } = await supabase.rpc("queue_counts");
  const d = (data as Partial<Record<QueueKind, number>> | null) ?? {};
  return { public: d.public ?? 0, ranked: d.ranked ?? 0 };
}

// Nudge the matchmaker. Returns the code of whatever lobby it managed to form —
// which may not be YOURS, so always read your own row with getMyQueue after.
export async function tryMatchmake(): Promise<string | null> {
  const { data } = await supabase.rpc("matchmake");
  return (data as string | null) ?? null;
}

export async function getMyQueue(): Promise<MyQueue> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("ranked_queue")
    .select("mode, status, room_code, joined_at, pref_vice, pref_virtue")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    mode: string;
    status: string;
    room_code: string | null;
    joined_at: string;
    pref_vice: string | null;
    pref_virtue: string | null;
  };
  return {
    kind: row.mode === "ranked" ? "ranked" : "public",
    status: row.status === "matched" ? "matched" : "waiting",
    roomCode: row.room_code,
    joinedAt: row.joined_at,
    pref: { vice: row.pref_vice, virtue: row.pref_virtue },
  };
}

// The seat the matchmaker created for us, so the client can store its player id
// before entering the room. limit(1) rather than single(): a stray duplicate row
// must not throw us out of a match we're already in.
export async function resolveMySeat(roomCode: string): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: room } = await supabase
    .from("rooms")
    .select("id")
    .eq("code", roomCode)
    .maybeSingle();
  if (!room) return null;
  const { data } = await supabase
    .from("players")
    .select("id")
    .eq("room_id", (room as { id: string }).id)
    .eq("user_id", user.id)
    .limit(1);
  const rows = (data as { id: string }[] | null) ?? [];
  return rows[0]?.id ?? null;
}

// Did this player get the class they asked for? Used to tell them so on the
// match-found screen — an autofilled player should know why they're a Torment.
export function gotPreference(
  pref: ClassPreference,
  dealtCamp: "vice" | "virtue" | "neutral",
  dealtClass: RoleClass | null
): boolean {
  if (!dealtClass) return false;
  if (dealtCamp === "vice") return dealtClass === pref.vice;
  if (dealtCamp === "virtue") return dealtClass === pref.virtue;
  return false;
}
