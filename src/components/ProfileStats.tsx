"use client";

import { milestoneProgress, type BadgeProgress } from "@/lib/badges";
import { Medallion } from "./BadgesShowcase";
import type { UserStats } from "@/lib/stats";

// Read-only stats display shared by your own profile and a friend's profile:
// Games/Wins/Win-rate summary + milestone-badge progress (total wins + games).
// (Per-character win progress now lives in each role's popup on the Roles tab.)
export function ProfileStats({ stats }: { stats: UserStats | null }) {
  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Games" value={stats ? String(stats.totalGames) : "—"} />
        <StatCard label="Wins" value={stats ? String(stats.totalWins) : "—"} />
        <StatCard
          label="Win rate"
          value={
            stats && stats.totalGames > 0
              ? `${Math.round(stats.winRate * 100)}%`
              : "—"
          }
        />
      </div>

      {/* Milestone badge progress — total wins + total games */}
      {stats && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-gold">Milestones</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-gold/20 bg-cream/5 px-3 py-2">
              <p className="text-sm text-cream/90">
                Total wins{" "}
                <span className="text-cream/50">({stats.totalWins})</span>
              </p>
              <div className="mt-1.5">
                <BadgeProgressStrip
                  progress={milestoneProgress("games_won", stats.totalWins)}
                />
              </div>
            </div>
            <div className="rounded-lg border border-gold/20 bg-cream/5 px-3 py-2">
              <p className="text-sm text-cream/90">
                Games played{" "}
                <span className="text-cream/50">({stats.totalGames})</span>
              </p>
              <div className="mt-1.5">
                <BadgeProgressStrip
                  progress={milestoneProgress("games_played", stats.totalGames)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// A row of earned badge medallions plus the next target with a count, or
// "All earned" when every threshold is reached. Used for milestone progress
// and each role's per-character progress (the role popup on the Roles tab). The
// next (unearned) target shows dimmed; badges beyond the next one aren't shown.
export function BadgeProgressStrip({ progress }: { progress: BadgeProgress }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {progress.earned.map((b) => (
        <Medallion key={b.id} badge={b} earned sizeClass="h-8 w-8" />
      ))}
      {progress.next ? (
        <span className="flex items-center gap-1.5">
          <Medallion badge={progress.next} earned={false} sizeClass="h-8 w-8" />
          <span className="text-xs text-cream/60">
            {progress.current}/{progress.target}
          </span>
        </span>
      ) : (
        <span className="text-xs font-semibold text-gold">All earned</span>
      )}
    </div>
  );
}

// A single stat tile (Games / Wins / Win rate).
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-gold/30 bg-cream/5 px-3 py-3">
      <span className="text-2xl font-bold text-gold">{value}</span>
      <span className="text-xs text-cream/60">{label}</span>
    </div>
  );
}
