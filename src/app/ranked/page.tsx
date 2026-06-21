"use client";

// Ranked matchmaking screen: pick a mode (3v3 / 5v5) and search. No side pick
// and no pre-game loadout (migration 063) — when a match forms you're dealt a
// camp + tier and choose your role live on the role-select screen. Poll until
// matched, then store the seat the server created and enter the room.
// Account-only (ranked needs an identity).

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
  type QueueMode,
  type QueueCounts,
} from "@/lib/rankedQueue";
import { setStoredPlayerId, setStoredPlayerName } from "@/lib/player";
import { RankPanel } from "@/components/RankPanel";

const EMPTY_COUNTS: QueueCounts = { "3v3": 0, "5v5": 0 };

export default function RankedPage() {
  const router = useRouter();
  const { profile, loading } = useAuth();
  const [mode, setMode] = useState<QueueMode>("3v3");
  const [searching, setSearching] = useState(false);
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

  async function start() {
    if (!profile) return;
    setError(null);
    try {
      await joinQueue(mode, profile.username);
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

  const need = MODE_SIZE[mode] * 2;

  return (
    <Shell hideBack={searching}>
      <h1 className="text-2xl font-semibold text-gold">Ranked</h1>
      {!searching ? (
        <>
          {/* Your current ladder position. */}
          <div className="mt-4 w-full max-w-sm">
            <RankPanel showCta={false} />
          </div>

          {/* Mode */}
          <div className="mt-4 flex w-full max-w-sm gap-2">
            {(["3v3", "5v5"] as QueueMode[]).map((m) => (
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

          <button
            onClick={start}
            className="mt-5 w-full max-w-sm rounded-xl bg-gold px-4 py-4 text-lg font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Find match
          </button>
          <p className="mt-3 max-w-sm text-center text-xs text-cream/50">
            When a match is found you&rsquo;re dealt a camp and a tier, then you
            choose your role — coordinate with your team on the spot.
          </p>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </>
      ) : (
        <>
          <p className="mt-3 text-center text-cream/80">
            Searching for a <b className="text-gold">{mode}</b> match&hellip;
          </p>
          <div className="mt-4 flex items-center gap-2">
            <span className="h-3 w-3 animate-ping rounded-full bg-gold" />
            <span className="text-sm text-cream/70">
              {counts[mode]} waiting (need {need})
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

function Shell({
  children,
  hideBack = false,
}: {
  children: ReactNode;
  hideBack?: boolean;
}) {
  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-6 py-10 text-cream">
      <div className="w-full max-w-md">
        {!hideBack && (
          <Link href="/" className="text-sm text-cream/70 hover:text-cream">
            ← Back
          </Link>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center">
        {children}
      </div>
    </main>
  );
}
