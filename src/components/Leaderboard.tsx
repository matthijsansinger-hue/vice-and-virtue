"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLeaderboard, type LeaderboardEntry } from "@/lib/leaderboard";
import { ShowcaseBadges } from "./ShowcaseBadges";

// Gold / silver / bronze styling for the top three spots (rank coin + border).
const MEDALS = [
  {
    rankBg: "linear-gradient(135deg,#f8e08a,#d9a521)",
    rankText: "#4e3624",
    border: "#caa015",
  },
  {
    rankBg: "linear-gradient(135deg,#eef0f2,#a9adb3)",
    rankText: "#34373b",
    border: "#9aa0a6",
  },
  {
    rankBg: "linear-gradient(135deg,#e3a368,#a9692f)",
    rankText: "#3a2415",
    border: "#b06a2c",
  },
];

// A small button on the profile that opens the worldwide leaderboard popup.
export function Leaderboard({ meUserId }: { meUserId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 self-center rounded-lg border border-gold px-5 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
      >
        <TrophyIcon />
        Leaderboard
      </button>
      {open && (
        <LeaderboardModal meUserId={meUserId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// The popup: top 10 players by wins, gold/silver/bronze top three, with each
// player's favourited badges next to their name. `meUserId` highlights the
// viewer's own row.
export function LeaderboardModal({
  meUserId,
  onClose,
}: {
  meUserId?: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    getLeaderboard(10)
      .then((r) => active && setRows(r))
      .catch(() => active && setRows([]));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gold">Leaderboard</h2>
            <p className="text-xs text-cream/50">Most wins worldwide.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 text-2xl leading-none text-cream/60 hover:text-cream"
          >
            &times;
          </button>
        </div>

        {rows === null ? (
          <p className="mt-6 text-center text-sm text-cream/50">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-6 text-center text-sm text-cream/50">
            No wins recorded yet.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col gap-2">
            {rows.map((r, i) => {
              const medal = MEDALS[i];
              const isMe = !!meUserId && r.user_id === meUserId;
              return (
                <li key={r.user_id}>
                  <Link
                    href={`/profile/${r.user_id}`}
                    onClick={onClose}
                    className={
                      "flex items-center gap-3 rounded-lg border-2 bg-cream px-3 py-2 text-home-bg transition-colors hover:bg-cream/90 " +
                      (isMe ? "ring-2 ring-gold" : "")
                    }
                    style={{
                      borderColor: medal
                        ? medal.border
                        : "rgba(227,181,16,0.45)",
                    }}
                  >
                  {/* Rank — gold/silver/bronze for the top three */}
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={
                      medal
                        ? {
                            background: medal.rankBg,
                            color: medal.rankText,
                            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.2)",
                          }
                        : { background: "#4e3624", color: "#ffefc5" }
                    }
                  >
                    {i + 1}
                  </span>

                  {/* Avatar or initial */}
                  {r.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.avatar_url}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-home-bg text-sm font-bold text-cream">
                      {r.username.charAt(0).toUpperCase()}
                    </span>
                  )}

                  {/* Name + favourited badges */}
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold">
                      {r.username}
                      {isMe && (
                        <span className="ml-1.5 text-xs text-home-bg/50">
                          (you)
                        </span>
                      )}
                    </span>
                    <ShowcaseBadges ids={r.featured_badges} sizeClass="h-9 w-9" />
                  </span>

                  {/* Wins */}
                  <span className="shrink-0 text-sm font-bold">
                    {r.wins}
                    <span className="ml-1 text-xs font-normal text-home-bg/55">
                      {r.wins === 1 ? "win" : "wins"}
                    </span>
                  </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 4h10v4a5 5 0 01-10 0V4z" />
      <path d="M7 5H4v1a3 3 0 003 3" />
      <path d="M17 5h3v1a3 3 0 01-3 3" />
      <path d="M12 13v4M9 20h6M10 17h4" />
    </svg>
  );
}
