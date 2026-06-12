"use client";

import { useState } from "react";
import { ROLES, getRole, type RoleDef } from "@/lib/roles";
import { setReady, endGameOverview } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import type { Player, Room } from "@/lib/types";
import { RoleIcon } from "./RoleIcon";
import { Walkthrough } from "./Walkthrough";
import { SoulEnergyText } from "@/components/ui/royal";

// Pre-game overview screen, shown right after the host clicks Start in the
// lobby. Plays the quick walkthrough slideshow (the same one from "How to
// play"), then lists the specific roles in play for this game. Everyone
// clicks Proceed; the host's client moves the room to lore_intro once
// everyone is ready.
export function GameOverview({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Majority press Proceed → 10s countdown → host advances to lore_intro.
  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => endGameOverview(room.id),
  });

  if (!myPlayer) {
    return (
      <main className="wood-desk-startscreen flex min-h-screen items-center justify-center bg-home-bg px-6 text-center text-cream">
        This game is already in progress.
      </main>
    );
  }

  // Unique roles in this game (from the room's role_pool, so we don't read
  // individual players' roles). One entry per role.
  const assignedIds = (room.role_pool ?? []).filter((r) => r in ROLES);
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

        {/* Quick walkthrough slideshow (shared with the "How to play" guide) */}
        <div className="mt-8">
          <Walkthrough endNote="The roles in this game are below ↓" />
        </div>

        {/* Role overview — the specific roles in play this game */}
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
                    onClick={() => setExpandedId(isOpen ? null : role.id)}
                    className="flex w-full items-center gap-3 rounded-lg border border-gold/40 bg-cream px-3 py-2 text-left text-home-bg transition-colors hover:bg-cream/90"
                  >
                    <RoleIcon
                      roleId={role.id}
                      camp={role.camp}
                      className="h-8 w-8"
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">
                        {role.name}
                      </span>
                      <span className="block text-xs text-home-bg/60">
                        {isVice ? "Vice" : "Virtue"} &middot; Tier{" "}
                        {role.tier} &middot; <SoulEnergyText onLight>{role.cost}</SoulEnergyText>
                      </span>
                    </span>
                    <span className="text-xs text-home-bg/40">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-1 rounded-lg border border-gold/30 bg-cream/10 p-3 text-xs leading-relaxed text-cream/90">
                      <p className="font-semibold text-cream">
                        Ability (<SoulEnergyText>{role.cost}</SoulEnergyText>)
                      </p>
                      <p className="mt-1"><SoulEnergyText>{role.ability}</SoulEnergyText></p>
                      <p className="mt-2 text-cream/70"><SoulEnergyText>{role.description}</SoulEnergyText></p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Proceed gate */}
        <div className="mt-10 flex flex-col items-center gap-2">
          {myPlayer.ready ? (
            <p className="text-sm text-cream/70">
              You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
              {total})
            </p>
          ) : (
            <button
              onClick={() => setReady(myPlayer.id, true)}
              className="rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              Proceed ({readyCount}/{total})
            </button>
          )}
          {remainingSec !== null && (
            <p className="text-xs font-semibold text-gold">
              Most are ready &mdash; starting in {remainingSec}s
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
