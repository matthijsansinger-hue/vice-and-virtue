// The public/ranked queue as a hook: join with a class preference, nudge the
// matchmaker every 3 s, and enter the room the moment our seat exists. Shared
// by the hub's Play button and the /ranked page's MatchmakingPanel so the
// polling/seat logic lives once.
//
// Party searches (migration 138): the leader's Play queues every member, so a
// member's screen didn't start the search itself. Passing `follow` (the
// member's own row of the party's search, from my_party) makes the hook show
// and run that search exactly like its own — timer, queue size, Cancel (which
// stops it for the whole party), and entering the room on a match.
//
// The hook should live at a level that survives the UI around it (the hub
// keeps it in HomePage, not in the Play section) — unmounting it mid-search
// leaves the queue, so a tab switch must not unmount it.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  joinQueue,
  leaveQueue,
  getQueueCounts,
  getMyQueue,
  tryMatchmake,
  resolveMySeat,
  MATCH_SIZE,
  type ClassPreference,
  type QueueKind,
} from "./matchmaking";
import { setStoredPlayerId, setStoredPlayerName } from "./player";

// A search this client didn't start: `token` identifies it (the row's
// joined_at), `startedAtMs` is when it began on this device's clock.
export type QueueFollow = { kind: QueueKind; token: string; startedAtMs: number };

export type Matchmaking = {
  searching: boolean;
  // The kind being searched (fixed when the search starts).
  activeKind: QueueKind | null;
  // Players waiting in `kind`'s queue (or the active search's).
  waiting: number;
  needed: number;
  elapsedMs: number;
  error: string | null;
  start: (kind: QueueKind, pref: ClassPreference) => Promise<void>;
  cancel: () => Promise<void>;
  clearError: () => void;
};

function joinError(res: { reason?: string; name?: string; status?: string }): string {
  switch (res.reason) {
    case "forbidden":
      return "You need to be signed in to queue.";
    case "not_leader":
      return "Only your party leader can start a search.";
    case "member_offline":
      return `${res.name ?? "A party member"} is offline. Remove them or wait until they're back.`;
    case "member_busy":
      return `${res.name ?? "A party member"} is ${res.status === "lobby" ? "in a lobby" : "in a game"}. Wait until everyone is on the home screen.`;
    default:
      return "Could not join the queue. Please try again.";
  }
}

export function useMatchmaking(
  kind: QueueKind,
  playerName: string,
  { idleCounts = true, follow = null }: { idleCounts?: boolean; follow?: QueueFollow | null } = {}
): Matchmaking {
  const router = useRouter();
  const [ownSearching, setOwnSearching] = useState(false);
  const [ownKind, setOwnKind] = useState<QueueKind | null>(null);
  const [ownStartedAt, setOwnStartedAt] = useState(0);
  // A followed search this client cancelled (or saw end), until the party
  // refresh drops it.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchingRef = useRef(false);
  const navigatingRef = useRef(false);
  const nameRef = useRef(playerName);
  const followRef = useRef<QueueFollow | null>(null);
  useEffect(() => {
    nameRef.current = playerName;
  }, [playerName]);

  const followed = follow && follow.token !== dismissed ? follow : null;
  useEffect(() => {
    followRef.current = followed;
  }, [followed]);

  const searching = ownSearching || !!followed;
  const activeKind = ownSearching ? ownKind : followed?.kind ?? null;
  const startedAt = ownSearching ? ownStartedAt : followed?.startedAtMs ?? 0;
  const countKind = activeKind ?? kind;

  // Leaving mid-search must drop us from the queue, or we'd be seated into a
  // lobby nobody is looking at.
  useEffect(() => {
    return () => {
      if (searchingRef.current && !navigatingRef.current) {
        leaveQueue().catch(() => {});
      }
    };
  }, []);

  // "N waiting · needs M more" before searching too: it's what makes someone
  // decide to queue. Off for screens that don't show it (the hub).
  useEffect(() => {
    if (searching || !idleCounts) return;
    let active = true;
    const poll = async () => {
      try {
        const counts = await getQueueCounts();
        if (active) setWaiting(counts[countKind] ?? 0);
      } catch {
        /* transient */
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [searching, countKind, idleCounts]);

  // Local ticker for the elapsed time — independent of the poll so the clock
  // doesn't stutter on a slow request.
  useEffect(() => {
    if (!searching) return;
    const update = () => setElapsedMs(Math.max(0, Date.now() - startedAt));
    const first = setTimeout(update, 0);
    const id = setInterval(update, 500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [searching, startedAt]);

  const tick = useCallback(async () => {
    if (!activeKind) return;
    try {
      await tryMatchmake();
      const [mine, counts] = await Promise.all([getMyQueue(), getQueueCounts()]);
      setWaiting(counts[activeKind] ?? 0);

      // Our row is gone without us cancelling: a party member cancelled, or
      // the party changed. Stop showing a search that no longer exists.
      if (!mine) {
        if (navigatingRef.current) return;
        if (searchingRef.current) {
          searchingRef.current = false;
          setOwnSearching(false);
          setOwnKind(null);
          setError("The search was cancelled.");
        }
        const f = followRef.current;
        if (f) setDismissed(f.token);
        return;
      }

      if (mine.status === "matched" && mine.roomCode && !navigatingRef.current) {
        // Resolve OUR seat before entering. Entering with a missing player id
        // makes the room treat us as not-in-the-game (reads as a kick), so if
        // the seat isn't visible yet we leave the row 'matched' and retry.
        const seat = await resolveMySeat(mine.roomCode);
        if (seat) {
          navigatingRef.current = true;
          setStoredPlayerId(seat);
          setStoredPlayerName(nameRef.current);
          await leaveQueue().catch(() => {});
          router.push(`/room/${mine.roomCode}`);
        }
      }
    } catch {
      /* transient — the next tick retries */
    }
  }, [activeKind, router]);

  useEffect(() => {
    if (!searching) return;
    let active = true;
    const run = () => {
      if (active) void tick();
    };
    run();
    const id = setInterval(run, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [searching, tick]);

  const start = useCallback(async (k: QueueKind, pref: ClassPreference) => {
    setError(null);
    try {
      const res = await joinQueue(k, nameRef.current, pref);
      if (!res.ok) {
        setError(joinError(res));
        return;
      }
      setOwnStartedAt(Date.now());
      setElapsedMs(0);
      setOwnKind(k);
      searchingRef.current = true;
      setOwnSearching(true);
    } catch {
      setError("Could not join the queue. Please try again.");
    }
  }, []);

  const cancel = useCallback(async () => {
    searchingRef.current = false;
    setOwnSearching(false);
    setOwnKind(null);
    const f = followRef.current;
    if (f) setDismissed(f.token);
    // In a party this stops the search for everyone (migration 138).
    await leaveQueue().catch(() => {});
  }, []);

  return {
    searching,
    activeKind,
    waiting,
    needed: Math.max(0, MATCH_SIZE - waiting),
    elapsedMs,
    error,
    start,
    cancel,
    clearError: () => setError(null),
  };
}
