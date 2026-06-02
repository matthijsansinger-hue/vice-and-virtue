"use client";

import { getRole } from "@/lib/roles";
import type { UserStats } from "@/lib/stats";

// Read-only stats display shared by your own profile and a friend's
// profile: Games/Wins/Win-rate summary, wins-per-character, recent games.
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

      {/* Wins per character */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-gold">Wins per character</h2>
        {stats && stats.perRole.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {stats.perRole.map((r) => (
              <li
                key={r.role}
                className="flex items-center justify-between rounded-lg border border-gold/20 bg-cream/5 px-3 py-2"
              >
                <span className="text-sm text-cream/90">
                  {getRole(r.role)?.name ?? r.role}
                </span>
                <span className="text-sm text-cream/70">
                  <span className="font-semibold text-gold">{r.won}</span> won
                  {" / "}
                  {r.played} played
                </span>
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

// A single stat tile (Games / Wins / Win rate).
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-gold/30 bg-cream/5 px-3 py-3">
      <span className="text-2xl font-bold text-gold">{value}</span>
      <span className="text-xs text-cream/60">{label}</span>
    </div>
  );
}
