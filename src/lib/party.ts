// Parties (migration 137): you + up to 2 friends. The leader invites friends
// who are on the home screen; when the leader opens or joins a lobby, every
// member's client follows into it (see PartyProvider). All state lives in
// locked tables behind SECURITY DEFINER RPCs; reads go through my_party().

"use client";

import { supabase } from "./supabase";
import { levelFromXp } from "./economy";
import { normalizeCharacter, randomCharacter, type CharacterConfig } from "./character";
import type { PresenceStatus } from "./presence";
import type { ClassPreference, QueueKind } from "./matchmaking";

export const PARTY_MAX = 3;
// Followers only act on a lobby the leader picked this recently, so a stale
// destination from an earlier game is never followed.
export const PARTY_FOLLOW_WINDOW_S = 120;

export type PartyMember = {
  userId: string;
  username: string;
  character: CharacterConfig;
  level: number;
  joinedAt: string;
  status: PresenceStatus;
};

export type PartyInvited = {
  userId: string;
  username: string;
  character: CharacterConfig;
  createdAt: string;
};

// Your own row of the party's search (migration 138): waiting, or matched into
// a game that's still running. `token` identifies the search; `startedAtMs` is
// when it began, converted to this device's clock at load time.
export type PartyQueue = {
  kind: QueueKind;
  status: "waiting" | "matched";
  roomCode: string | null;
  token: string;
  startedAtMs: number;
};

export type Party = {
  id: string;
  leaderId: string;
  mode: QueueKind;
  roomCode: string | null;
  roomSetAt: string | null;
  // Seconds since the leader picked roomCode, measured by the server.
  roomAgeS: number | null;
  members: PartyMember[]; // oldest first, you included
  invited: PartyInvited[]; // pending (not yet expired)
  queue: PartyQueue | null;
};

export type PartyInvite = {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromCharacter: CharacterConfig;
  partySize: number;
  createdAt: string;
};

export type PartyState = { party: Party | null; invites: PartyInvite[] };

type Raw = Record<string, unknown>;

// Same rule as the profile loaders: no saved character yet = a stable random one.
const character = (id: string, appearance: unknown): CharacterConfig =>
  appearance ? normalizeCharacter(appearance) : randomCharacter(id);

const status = (s: unknown): PresenceStatus =>
  s === "home" || s === "lobby" || s === "game" ? s : "offline";

export async function getMyParty(): Promise<PartyState> {
  const { data, error } = await supabase.rpc("my_party");
  if (error) throw error;
  const d = (data as { party: Raw | null; invites: Raw[] | null } | null) ?? { party: null, invites: [] };
  const p = d.party;
  const q = (p?.queue as Raw | null | undefined) ?? null;
  const loadedAt = Date.now();
  const party: Party | null = p
    ? {
        id: String(p.id),
        leaderId: String(p.leader_id),
        mode: p.mode === "ranked" ? "ranked" : "public",
        roomCode: (p.room_code as string | null) ?? null,
        roomSetAt: (p.room_set_at as string | null) ?? null,
        roomAgeS: p.room_age_s == null ? null : Number(p.room_age_s),
        members: ((p.members as Raw[] | null) ?? []).map((m) => ({
          userId: String(m.user_id),
          username: String(m.username ?? ""),
          character: character(String(m.user_id), m.appearance),
          level: levelFromXp(Number(m.xp ?? 0)).level,
          joinedAt: String(m.joined_at),
          status: status(m.status),
        })),
        invited: ((p.invited as Raw[] | null) ?? []).map((i) => ({
          userId: String(i.user_id),
          username: String(i.username ?? ""),
          character: character(String(i.user_id), i.appearance),
          createdAt: String(i.created_at),
        })),
        queue: q
          ? {
              kind: q.kind === "ranked" ? "ranked" : "public",
              status: q.status === "matched" ? "matched" : "waiting",
              roomCode: (q.room_code as string | null) ?? null,
              token: String(q.since),
              startedAtMs: loadedAt - Number(q.age_s ?? 0) * 1000,
            }
          : null,
      }
    : null;
  const invites: PartyInvite[] = (d.invites ?? []).map((i) => ({
    id: String(i.id),
    fromUserId: String(i.from_user),
    fromUsername: String(i.from_username ?? ""),
    fromCharacter: character(String(i.from_user), i.from_appearance),
    partySize: Number(i.party_size ?? 1),
    createdAt: String(i.created_at),
  }));
  return { party, invites };
}

export type PartyResult = { ok: boolean; reason?: string };

async function call(fn: string, args?: Record<string, unknown>): Promise<PartyResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data as PartyResult | null) ?? { ok: false };
}

export const inviteToParty = (userId: string, mode: QueueKind) =>
  call("party_invite", { p_to: userId, p_mode: mode });
export const respondToPartyInvite = (inviteId: string, accept: boolean) =>
  call("party_respond", { p_invite: inviteId, p_accept: accept });
export const leaveParty = () => call("party_leave");
export const removeFromParty = (userId: string) => call("party_kick", { p_user: userId });
export const setPartyMode = (mode: QueueKind) => call("party_set_mode", { p_mode: mode });
export const partyGoto = (code: string) => call("party_goto", { p_code: code });
// Keep your class picks on the server so the leader's Play queues you with
// them (migration 138).
export const setPartyPrefs = (pref: ClassPreference) =>
  call("party_set_prefs", { p_pref_vice: pref.vice, p_pref_virtue: pref.virtue });

export function partyReasonText(reason: string | undefined, name?: string): string {
  const who = name ?? "They";
  switch (reason) {
    case "not_home":
      return `${who} isn't on the home screen any more.`;
    case "in_party":
      return `${who} is already in a party.`;
    case "full":
      return "Your party is full.";
    case "not_leader":
      return "Only the party leader can do that.";
    case "not_friends":
      return `${who} isn't on your friends list.`;
    case "expired":
      return "That invite has expired.";
    case "gone":
      return "That party doesn't exist any more.";
    case "forbidden":
      return "You need to be logged in.";
    default:
      return "Something went wrong. Please try again.";
  }
}
