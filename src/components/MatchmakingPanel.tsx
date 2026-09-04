"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { heading } from "@/components/ui/royal";
import { ClassPreferencePicker } from "./ClassPreferencePicker";
import {
  joinQueue,
  leaveQueue,
  getQueueCounts,
  getMyQueue,
  tryMatchmake,
  resolveMySeat,
  MATCH_SIZE,
  QUEUE_PATIENCE_MS,
  VICE_CLASSES,
  VIRTUE_CLASSES,
  type ClassPreference,
  type QueueKind,
} from "@/lib/matchmaking";
import { setStoredPlayerId, setStoredPlayerName } from "@/lib/player";

// The whole queue flow for both public and ranked (migration 117): pick a class
// per camp, search, and enter the room the moment the matchmaker seats you.
// Both kinds share this so the polling/seat-resolution logic exists once.
export function MatchmakingPanel({
  kind,
  playerName,
  onCancel,
}: {
  kind: QueueKind;
  playerName: string;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [pref, setPref] = useState<ClassPreference>({
    vice: VICE_CLASSES[0],
    virtue: VIRTUE_CLASSES[0],
  });
  const [searching, setSearching] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchingRef = useRef(false);
  const navigatingRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  // Leaving the screen mid-search must drop us from the queue, or we'd be
  // seated into a lobby nobody is looking at.
  useEffect(() => {
    return () => {
      if (searchingRef.current && !navigatingRef.current) {
        leaveQueue().catch(() => {});
      }
    };
  }, []);

  // Local ticker for the elapsed/autofill copy — independent of the poll so the
  // clock doesn't stutter on a slow request.
  useEffect(() => {
    if (!searching) return;
    const id = setInterval(
      () => setElapsedMs(Date.now() - startedAtRef.current),
      500
    );
    return () => clearInterval(id);
  }, [searching]);

  const tick = useCallback(async () => {
    try {
      await tryMatchmake();
      const [mine, counts] = await Promise.all([getMyQueue(), getQueueCounts()]);
      setWaiting(counts[kind] ?? 0);

      if (mine?.status === "matched" && mine.roomCode && !navigatingRef.current) {
        // Resolve OUR seat before entering. Entering with a missing player id
        // makes the room treat us as not-in-the-game (reads as a kick), so if
        // the seat isn't visible yet we leave the row 'matched' and retry.
        const seat = await resolveMySeat(mine.roomCode);
        if (seat) {
          navigatingRef.current = true;
          setStoredPlayerId(seat);
          setStoredPlayerName(playerName);
          await leaveQueue().catch(() => {});
          router.push(`/room/${mine.roomCode}`);
        }
      }
    } catch {
      /* transient — the next tick retries */
    }
  }, [kind, playerName, router]);

  useEffect(() => {
    if (!searching) return;
    let active = true;
    const run = () => {
      if (active) tick();
    };
    run();
    const id = setInterval(run, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [searching, tick]);

  async function start() {
    setError(null);
    try {
      const res = await joinQueue(kind, playerName, pref);
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
      searchingRef.current = true;
      setSearching(true);
    } catch {
      setError("Could not join the queue. Please try again.");
    }
  }

  async function cancel() {
    searchingRef.current = false;
    setSearching(false);
    await leaveQueue().catch(() => {});
    onCancel?.();
  }

  const pastPatience = elapsedMs >= QUEUE_PATIENCE_MS;
  const secs = Math.floor(elapsedMs / 1000);

  if (!searching) {
    return (
      <div>
        <ClassPreferencePicker value={pref} onChange={setPref} />
        {error && (
          <p className="mt-3 text-center text-sm text-red-300">{error}</p>
        )}
        <button
          onClick={start}
          className={`mt-4 w-full rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
        >
          {kind === "ranked" ? "Find ranked match" : "Find a game"}
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className={`text-lg font-semibold text-gold ${heading}`}>
        Searching for a game&hellip;
      </p>
      <p className="mt-1 text-4xl font-bold tabular-nums text-cream">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
      </p>
      <p className="mt-2 text-sm text-cream/70">
        {waiting} of {MATCH_SIZE} players searching
      </p>

      <p className="mx-auto mt-4 max-w-sm text-xs leading-relaxed text-cream/55">
        {pastPatience
          ? "You've waited long enough that we'll now place you in any free class to get a game started."
          : "Holding out for the classes you picked. After a minute we'll place you anywhere free so you're not stuck waiting."}
      </p>

      <button
        onClick={cancel}
        className="mt-5 rounded-lg border border-gold/50 px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10"
      >
        Cancel search
      </button>
    </div>
  );
}
