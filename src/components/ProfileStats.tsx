"use client";

import { ROLES, getRole } from "@/lib/roles";
import {
  milestoneProgress,
  roleBadgeProgress,
  type BadgeProgress,
} from "@/lib/badges";
import { Medallion } from "./BadgesShowcase";
import type { UserStats } from "@/lib/stats";

// Read-only stats display shared by your own profile and a friend's profile:
// Games/Wins/Win-rate summary, milestone-badge progress (total wins + games),
// wins-per-character with each character's badge progress, and recent games.
export function ProfileStats({ stats }: { stats: UserStats | null }) {
  // Every role, with this player's wins/plays merged in (0 for unplayed),
  // most-won first — so each character's badge progress is visible.
  const winsByRole = new Map((stats?.perRole ?? []).map((r) => [r.role, r]));
  const allRoles = Object.values(ROLES)
    .map((role) => {
      const e = winsByRole.get(role.id);
      return {
        role: role.id,
        name: role.name,
        won: e?.won ?? 0,
        played: e?.played ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.won - a.won || b.played - a.played || a.name.localeCompare(b.name)
    );

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

      {/* Wins per character — with each character's badge progress */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-gold">Wins per character</h2>
        {stats ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {allRoles.map((r) => (
              <li
                key={r.role}
                className="rounded-lg border border-gold/20 bg-cream/5 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-cream/90">
                    {getRole(r.role)?.name ?? r.role}
                  </span>
                  <span className="text-sm text-cream/70">
                    <span className="font-semibold text-gold">{r.won}</span> won
                    {" / "}
                    {r.played} played
                  </span>
                </div>
                <div className="mt-1.5">
                  <BadgeProgressStrip progress={roleBadgeProgress(r.role, r.won)} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-cream/50">
            No games yet — play one to start tracking wins.
          </p>
        )}
      </div>

      {/* Recent games */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-gold">Recent games</h2>
        {stats && stats.recent.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {stats.recent.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-gold/20 bg-cream/5 px-3 py-2"
              >
                <span className="text-sm text-cream/90">
                  {getRole(g.role)?.name ?? g.role ?? "Unknown role"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold ${
                    g.won ? "bg-gold/20 text-gold" : "bg-cream/10 text-cream/60"
                  }`}
                >
                  {g.won ? "WON" : "LOST"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-cream/50">No games played yet.</p>
        )}
      </div>
    </>
  );
}

// A row of earned badge medallions plus the next target with a count, or
// "All earned" when every threshold is reached. Used for milestone + per-role
// badge progress. The next (unearned) target shows dimmed; locked badges
// beyond the next one are intentionally not shown.
function BadgeProgressStrip({ progress }: { progress: BadgeProgress }) {
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
