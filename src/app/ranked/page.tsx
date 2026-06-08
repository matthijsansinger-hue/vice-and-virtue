"use client";

// Ranked matchmaking screen: pick a mode (3v3 / 6v6) and a side (Vice/Virtue),
// join the queue, and poll until a balanced match forms — then store the seat
// the server created for this account and enter the room. Your role is assigned
// automatically from your loadout. Account-only (ranked needs an identity).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import {
  joinQueue,
  leaveQueue,
  getQueueCounts,
  tryMatchmake,
  getMyQueue,
  resolveMySeat,
  MODE_SIZE,
  type QueueSide,
  type QueueMode,
  type QueueCounts,
} from "@/lib/rankedQueue";
import { setStoredPlayerId, setStoredPlayerName } from "@/lib/player";

const EMPTY_COUNTS: QueueCounts = {
  "3v3": { vice: 0, virtue: 0 },
  "6v6": { vice: 0, virtue: 0 },
};

export default function RankedPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();
  const [mode, setMode] = useState<QueueMode>("3v3");
  const [searching, setSearching] = useState(false);
  const [side, setSide] = useState<QueueSide | null>(null);
  const [counts, setCounts] = useState<QueueCounts>(EMPTY_COUNTS);
  const [error, setError] = useState<string | null>(null);
  const searchingRef = useRef(false);
  const navigatingRef = useRef(false);

  // If the user leaves this screen mid-search, drop out of the queue.
  useEffect(() => {
    return () => {
      if (searchingRef.current && !navigatingRef.current) {
        leaveQueue().catch(() => {});
      }
    };
  }, []);

  // Poll while searching: try to form a match, refresh counts, and enter the
  // room the moment we're matched.
  useEffect(() => {
    if (!searching) return;
    let active = true;

    async function tick() {
      try {
        await tryMatchmake();
        const [mine, c] = await Promise.all([getMyQueue(), getQueueCounts()]);
        if (!active) return;
        setCounts(c);
        if (
          mine?.status === "matched" &&
          mine.room_code &&
          !navigatingRef.current
        ) {
          navigatingRef.current = true;
          const seat = await resolveMySeat(mine.room_code);
          if (seat) {
            setStoredPlayerId(seat);
            if (profile) setStoredPlayerName(profile.username);
          }
          await leaveQueue().catch(() => {});
          router.push(`/room/${mine.room_code}`);
        }
      } catch {
        /* transient — the next tick retries */
      }
    }

    tick();
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [searching, profile, router]);

  async function start(chosen: QueueSide) {
    if (!profile) return;
    setError(null);
    try {
      await joinQueue(mode, chosen, profile.username);
      setSide(chosen);
      searchingRef.current = true;
      setSearching(true);
    } catch {
      setError("Could not join the queue. Please try again.");
    }
  }

  async function cancel() {
    searchingRef.current = false;
    setSearching(false);
    setSide(null);
    await leaveQueue().catch(() => {});
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-cream/70">Loading…</p>
      </Shell>
    );
  }

  if (!profile) {
    return (
      <Shell>
        <p className="text-center text-cream/80">
          You need an account to play ranked.
        </p>
        <Link
          href="/"
          className="mt-4 rounded-lg bg-gold px-4 py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          Back to home
        </Link>
      </Shell>
    );
  }

  const need = MODE_SIZE[mode];

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-gold">Ranked</h1>
      {!searching ? (
        <>
          {/* Mode */}
          <div className="mt-4 flex w-full max-w-sm gap-2">
            {(["3v3", "6v6"] as QueueMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  mode === m
                    ? "border-gold bg-gold text-home-bg"
                    : "border-gold/40 text-cream hover:bg-cream/10"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <p className="mt-4 text-center text-cream/70">
            Choose the side you want to play.
          </p>
          <div className="mt-3 flex w-full max-w-sm gap-3">
            <button
              onClick={() => start("vice")}
              className="flex-1 rounded-xl border-2 border-consultation-bg bg-consultation-bg/20 px-4 py-6 text-lg font-semibold text-cream transition-colors hover:bg-consultation-bg/30"
            >
              Vice
            </button>
            <button
              onClick={() => start("virtue")}
              className="flex-1 rounded-xl border-2 border-consultation-fg bg-consultation-fg/20 px-4 py-6 text-lg font-semibold text-cream transition-colors hover:bg-consultation-fg/30"
            >
              Virtue
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-cream/50">
            Your role is assigned automatically from your loadout.
          </p>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </>
      ) : (
        <>
          <p className="mt-3 text-center text-cream/80">
            Searching for a <b className="text-gold">{mode}</b> match… queued as{" "}
            <b className="capitalize text-gold">{side}</b>
          </p>
          <div className="mt-4 flex items-center gap-2">
            <span className="h-3 w-3 animate-ping rounded-full bg-gold" />
            <span className="text-sm text-cream/70">
              {counts[mode].vice} Vice · {counts[mode].virtue} Virtue waiting
              (need {need} each)
            </span>
          </div>
          <button
            onClick={cancel}
            className="mt-6 rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            Cancel
          </button>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-6 py-10 text-cream">
      <div className="w-full max-w-md">
        <Link href="/" className="text-sm text-cream/70 hover:text-cream">
          ← Back
        </Link>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        {children}
      </div>
    </main>
  );
}
