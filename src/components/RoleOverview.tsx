"use client";

import { setReady, endRoleOverview } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { ROLES, type RoleDef } from "@/lib/roles";
import { RoleIcon } from "./RoleIcon";
import type { Player, Room } from "@/lib/types";

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

// The role_overview phase: after role selection resolves (or, later, after a
// random deal), everyone sees the full cast of THIS game — every role in play,
// sorted Vice | Virtue — before the lore intro. Majority-continue advances.
export function RoleOverview({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const pool = (room.role_pool ?? [])
    .map((id) => ROLES[id])
    .filter((r): r is RoleDef => !!r)
    .sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9));
  const vices = pool.filter((r) => r.camp === "vice");
  const virtues = pool.filter((r) => r.camp === "virtue");

  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => endRoleOverview(room.id),
  });

  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-4 pb-12 pt-10 text-cream">
      <div className="w-full max-w-3xl">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-cream/60">
            The cast is set
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-gold">
            The roles in this game
          </h1>
          <p className="mt-1 text-sm text-cream/70">
            These — and only these — walk the castle. Remember them.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <CampColumn title="Vices" camp="vice" roles={vices} />
          <CampColumn title="Virtues" camp="virtue" roles={virtues} />
        </div>

        {/* Majority-continue. */}
        <div className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-2">
          {myPlayer?.ready ? (
            <p className="text-sm text-cream/70">
              You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
              {total})
            </p>
          ) : (
            <button
              onClick={() => myPlayer && setReady(myPlayer.id, true)}
              className="w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Continue ({readyCount}/{total})
            </button>
          )}
          {remainingSec !== null && (
            <p className="text-xs font-semibold text-gold">
              Most are ready &mdash; continuing in {remainingSec}s
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function CampColumn({
  title,
  camp,
  roles,
}: {
  title: string;
  camp: "vice" | "virtue";
  roles: RoleDef[];
}) {
  const vice = camp === "vice";
  return (
    <section
      className="rounded-xl border-2 bg-black/25 p-3"
      style={{ borderColor: vice ? "#9b2741" : "#3a49b8" }}
    >
      <h2
        className="text-center text-sm font-semibold uppercase tracking-widest"
        style={{ color: vice ? "#e6889a" : "#9a9ce0" }}
      >
        {title}
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {roles.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-2.5 rounded-lg bg-cream/5 px-2.5 py-2"
          >
            <RoleIcon roleId={r.id} camp={r.camp} className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-sm font-semibold">{r.name}</span>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gold/80">
                  Tier {r.tier}
                </span>
              </div>
              <p className="truncate text-xs text-cream/65">{r.ability}</p>
            </div>
          </li>
        ))}
        {roles.length === 0 && (
          <li className="py-2 text-center text-xs italic text-cream/50">
            No roles on this side.
          </li>
        )}
      </ul>
    </section>
  );
}
