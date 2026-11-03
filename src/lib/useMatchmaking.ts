// The public/ranked queue as a hook (migration 117 mechanics, unchanged):
// join with a class preference, nudge the matchmaker every 3 s, and enter the
// room the moment our seat exists. Shared by the hub's Play button and the
// /ranked page's MatchmakingPanel so the polling/seat logic lives once.
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

export function useMatchmaking(kind: QueueKind, playerName: string): Matchmaking {
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [activeKind, setActiveKind] = useState<QueueKind | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchingRef = useRef(false);
  const navigatingRef = useRef(false);
  const startedAtRef = useRef(0);
  const nameRef = useRef(playerName);
  useEffect(() => {
    nameRef.current = playerName;
  }, [playerName]);

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
  // decide to queue.
  useEffect(() => {
    if (searching) return;
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
  }, [searching, countKind]);

  // Local ticker for the elapsed time — independent of the poll so the clock
  // doesn't stutter on a slow request.
  useEffect(() => {
    if (!searching) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 500);
    return () => clearInterval(id);
  }, [searching]);

  const tick = useCallback(async () => {
    if (!activeKind) return;
    try {
      await tryMatchmake();
      const [mine, counts] = await Promise.all([getMyQueue(), getQueueCounts()]);
      setWaiting(counts[activeKind] ?? 0);

      if (mine?.status === "matched" && mine.roomCode && !navigatingRef.current) {
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
        setError(
          res.reason === "forbidden"
            ? "You need to be signed in to queue."
            : "Could not join the queue. Please try again."
        );
        return;
      }
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setActiveKind(k);
      searchingRef.current = true;
      setSearching(true);
    } catch {
      setError("Could not join the queue. Please try again.");
    }
  }, []);

  const cancel = useCallback(async () => {
    searchingRef.current = false;
    setSearching(false);
    setActiveKind(null);
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
