"use client";

import { useEffect, useRef, useState } from "react";
import { ROLES, getRole, type RoleDef } from "@/lib/roles";
import { setReady, endGameOverview } from "@/lib/game";
import type { Player, Room } from "@/lib/types";

// Pre-game overview screen, shown right after the host clicks Start
// in the lobby. Two sections:
//   1. Phase overview (the 3-phase day cycle)
//   2. Role list (every role in the current game; tap to expand)
// Everyone clicks Proceed; the host's client moves the room to
// lore_intro once everyone is ready.
export function GameOverview({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const advancedRef = useRef(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isHost = myPlayer?.is_host ?? false;
  const readyCount = players.filter((p) => p.ready).length;
  const allReady = players.length > 0 && players.every((p) => p.ready);

  // The host advances the room once every connected player has clicked
  // Proceed. advancedRef guards against firing twice.
  useEffect(() => {
    if (isHost && allReady && !advancedRef.current) {
      advancedRef.current = true;
      endGameOverview(room.id);
    }
  }, [isHost, allReady, room.id]);

  if (!myPlayer) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg px-6 text-center text-cream">
        This game is already in progress.
      </main>
    );
  }

  // Unique roles actually assigned in this game. (Worshipper / Seeker
  // can appear multiple times — only show one entry per role.)
  const assignedIds = Array.from(
    new Set(
      players
        .map((p) => p.role)
        .filter((r): r is string => !!r && r in ROLES)
    )
  );
  const assignedRoles: RoleDef[] = assignedIds
    .map((id) => getRole(id))
    .filter((r): r is RoleDef => !!r)
    // Stable sort by tier then name so the list is deterministic.
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
      return a.name.localeCompare(b.name);
    });

  return (
    <main className="wood-desk-startscreen min-h-screen bg-home-bg px-5 py-20 text-cream">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold text-gold">
          The game begins
        </h1>
        <p className="mt-1 text-center text-sm text-cream/70">
          Take a moment to read what&rsquo;s ahead.
        </p>

        {/* Phase overview */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">
            The day cycle
          </h2>
          <p className="mt-1 text-xs text-cream/60">
            Each in-game day moves through these three phases and then
            loops back. The cycle repeats until one camp wins.
          </p>

          <div className="mt-4 flex items-center gap-2">
            <PhaseChip
              title="Reflection"
              sub="Use your role, then a minigame to read the room."
            />
            <Arrow />
            <PhaseChip
              title="Outreach"
              sub="One-on-one chats with anyone you choose."
            />
            <Arrow />
            <PhaseChip
              title="Consultation"
              sub="Group discussion + a vote on who to imprison."
            />
          </div>
          <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-cream/40">
            &darr; loops back &darr;
          </p>
        </section>

        {/* Role overview */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">
            Roles in this game
          </h2>
          <p className="mt-1 text-xs text-cream/60">
            Tap a role for the full description.
          </p>

          <ul className="mt-3 flex flex-col gap-2">
            {assignedRoles.map((role) => {
              const isOpen = expandedId === role.id;
              const isVice = role.camp === "vice";
              return (
                <li key={role.id}>
                  <button
                    onClick={() =>
                      setExpandedId(isOpen ? null : role.id)
                    }
                    className="flex w-full items-center gap-3 rounded-lg border border-gold/40 bg-cream px-3 py-2 text-left text-home-bg transition-colors hover:bg-cream/90"
                  >
                    <span
                      className={
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-cream " +
                        (isVice
                          ? "bg-consultation-bg"
                          : "bg-consultation-fg")
                      }
                    >
                      {role.name.charAt(0)}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">
                        {role.name}
                      </span>
                      <span className="block text-xs text-home-bg/60">
                        {isVice ? "Vice" : "Virtue"} &middot; Tier{" "}
                        {role.tier} &middot; {role.cost}
                      </span>
                    </span>
                    <span className="text-xs text-home-bg/40">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-1 rounded-lg border border-gold/30 bg-cream/10 p-3 text-xs leading-relaxed text-cream/90">
                      <p className="font-semibold text-cream">
                        Ability ({role.cost})
                      </p>
                      <p className="mt-1">{role.ability}</p>
                      <p className="mt-2 text-cream/70">
                        {role.description}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Proceed gate */}
        <div className="mt-10 flex flex-col items-center">
          {myPlayer.ready ? (
            <p className="text-sm text-cream/70">
              You&rsquo;re ready &mdash; waiting for the others (
              {readyCount}/{players.length})
            </p>
          ) : (
            <button
              onClick={() => setReady(myPlayer.id, true)}
              className="rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Proceed
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function PhaseChip({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex-1 rounded-lg border border-gold/60 bg-cream/10 px-2 py-3 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-gold">
        {title}
      </p>
      <p className="mt-1 text-[10px] leading-tight text-cream/80">{sub}</p>
    </div>
  );
}

function Arrow() {
  return (
    <span aria-hidden className="shrink-0 text-gold/60">
      &rarr;
    </span>
  );
}
