"use client";

// Ranked matchmaking screen. You pick a preferred class for each camp and
// search; the matchmaker builds a 4v4 where everyone gets a class they asked
// for where it can, and autofills anyone still waiting after a minute
// (migration 117). When a match forms you're dealt a camp + class and choose
// your role live on the role-select screen.
//
// The queue mechanics live in MatchmakingPanel, shared with public Quick play —
// the polling and seat resolution are fiddly enough to be worth having once.
// Account-only: ranked needs a stable identity for the ladder.

import { type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import { MatchmakingPanel } from "@/components/MatchmakingPanel";
import { RankPanel } from "@/components/RankPanel";
import { MATCH_SIZE } from "@/lib/matchmaking";

export default function RankedPage() {
  const { profile, loading } = useAuth();

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

  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-gold">Ranked</h1>
      <p className="mt-1 text-xs uppercase tracking-widest text-cream/50">
        {MATCH_SIZE / 2}v{MATCH_SIZE / 2}
      </p>

      <div className="mt-4 w-full max-w-lg">
        <RankPanel showCta={false} />
      </div>

      <div className="mt-5 w-full max-w-lg">
        <MatchmakingPanel kind="ranked" playerName={profile.username} />
      </div>
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
