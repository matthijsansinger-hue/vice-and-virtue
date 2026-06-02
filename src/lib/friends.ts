// Friends: searching for players, sending/accepting requests, listing
// friends, and counting games played together. "Games together" = any
// finished game both accounts were in (from game_results.room_id).

import { supabase } from "./supabase";
import type { Friendship, Profile } from "./types";

export type FriendEntry = {
  friendshipId: string;
  profile: Profile;
  gamesTogether: number;
};

export type RequestEntry = {
  friendshipId: string;
  profile: Profile;
};

export type FriendData = {
  friends: FriendEntry[];
  incoming: RequestEntry[]; // requests sent TO me, awaiting my accept
  outgoing: RequestEntry[]; // requests I sent, awaiting their accept
};

// Search usernames (case-insensitive substring), excluding yourself.
export async function searchUsers(
  query: string,
  myId: string
): Promise<Profile[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", `%${q}%`)
    .neq("id", myId)
    .limit(10);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

// Send a friend request. Rejects if any relationship already exists
// between the two (in either direction).
export async function sendFriendRequest(
  myId: string,
  addresseeId: string
): Promise<void> {
  if (myId === addresseeId) throw new Error("You can't add yourself.");

  const { data: existing, error: exErr } = await supabase
    .from("friendships")
    .select("id")
    .or(
      `and(requester_id.eq.${myId},addressee_id.eq.${addresseeId}),and(requester_id.eq.${addresseeId},addressee_id.eq.${myId})`
    );
  if (exErr) throw exErr;
  if (existing && existing.length > 0) {
    throw new Error("You already have a request or friendship with them.");
  }

  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: myId, addressee_id: addresseeId, status: "pending" });
  if (error) throw error;
}

export async function acceptRequest(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted" })
    .eq("id", friendshipId);
  if (error) throw error;
}

// Decline an incoming request, cancel an outgoing one, or unfriend —
// all just delete the row (RLS allows either party to delete).
export async function removeFriendship(friendshipId: string): Promise<void> {
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  if (error) throw error;
}

// Number of finished games two accounts share (by room_id).
export async function gamesPlayedTogether(
  aId: string,
  bId: string
): Promise<number> {
  const [aRes, bRes] = await Promise.all([
    supabase.from("game_results").select("room_id").eq("user_id", aId),
    supabase.from("game_results").select("room_id").eq("user_id", bId),
  ]);
  if (aRes.error) throw aRes.error;
  if (bRes.error) throw bRes.error;

  const aRooms = new Set((aRes.data ?? []).map((r) => r.room_id as string));
  let count = 0;
  for (const r of bRes.data ?? []) {
    if (aRooms.has(r.room_id as string)) count += 1;
  }
  return count;
}

// All of my friends + pending requests (both directions), with the other
// person's profile and (for accepted friends) games-played-together.
export async function getFriendData(myId: string): Promise<FriendData> {
  const { data: rows, error } = await supabase
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${myId},addressee_id.eq.${myId}`);
  if (error) throw error;
  const fships = (rows ?? []) as Friendship[];

  const otherId = (f: Friendship) =>
    f.requester_id === myId ? f.addressee_id : f.requester_id;

  // Fetch all involved profiles in one query.
  const otherIds = [...new Set(fships.map(otherId))];
  const profilesById = new Map<string, Profile>();
  if (otherIds.length) {
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("*")
      .in("id", otherIds);
    if (pErr) throw pErr;
    for (const p of (profs ?? []) as Profile[]) profilesById.set(p.id, p);
  }

  // Games together: my room ids ∩ each accepted friend's room ids.
  const acceptedOtherIds = fships
    .filter((f) => f.status === "accepted")
    .map(otherId);
  const togetherCount = new Map<string, number>();
  if (acceptedOtherIds.length) {
    const [myRes, theirRes] = await Promise.all([
      supabase.from("game_results").select("room_id").eq("user_id", myId),
      supabase
        .from("game_results")
        .select("user_id,room_id")
        .in("user_id", acceptedOtherIds),
    ]);
    if (myRes.error) throw myRes.error;
    if (theirRes.error) throw theirRes.error;
    const myRooms = new Set((myRes.data ?? []).map((r) => r.room_id as string));
    for (const r of theirRes.data ?? []) {
      if (myRooms.has(r.room_id as string)) {
        const uid = r.user_id as string;
        togetherCount.set(uid, (togetherCount.get(uid) ?? 0) + 1);
      }
    }
  }

  const friends: FriendEntry[] = fships
    .filter((f) => f.status === "accepted")
    .map((f) => {
      const oid = otherId(f);
      return {
        friendshipId: f.id,
        profile: profilesById.get(oid)!,
        gamesTogether: togetherCount.get(oid) ?? 0,
      };
    })
    .filter((e) => e.profile)
    .sort((a, b) => a.profile.username.localeCompare(b.profile.username));

  const incoming: RequestEntry[] = fships
    .filter((f) => f.status === "pending" && f.addressee_id === myId)
    .map((f) => ({
      friendshipId: f.id,
      profile: profilesById.get(f.requester_id)!,
    }))
    .filter((e) => e.profile);

  const outgoing: RequestEntry[] = fships
    .filter((f) => f.status === "pending" && f.requester_id === myId)
    .map((f) => ({
      friendshipId: f.id,
      profile: profilesById.get(f.addressee_id)!,
    }))
    .filter((e) => e.profile);

  return { friends, incoming, outgoing };
}
