"use client";

import { getRole } from "@/lib/roles";
import { setReady, startRoleAction } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { RoleCard } from "./RoleCard";
import { Centered } from "./Centered";
import type { Room, Player } from "@/lib/types";

export function RoleReveal({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  // Majority press "I'm ready" → 10s countdown → host starts role_action.
  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => startRoleAction(room.id),
  });

  if (!myPlayer) {
    return <Centered>This game is already in progress.</Centered>;
  }

  const myRole = getRole(myPlayer.role);
  if (!myRole) {
    return <Centered>Assigning your role&hellip;</Centered>;
  }

  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center bg-home-bg px-6 py-16 text-cream">
      {/* Card + "how a day works" panel side-by-side on desktop; stacked on
          mobile so the reveal moment fills the screen on both. */}
      <div className="flex w-full max-w-4xl flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-center lg:gap-12">
        <RoleCard role={myRole} />

        <div className="flex w-full max-w-sm flex-col gap-4">
          <div className="rounded-xl border border-gold/30 bg-home-bg/40 p-4 text-sm text-cream/80">
            <p className="text-xs uppercase tracking-widest text-gold">
              How a day works
            </p>
            <p className="mt-2">
              <span className="font-semibold text-cream">Reflection</span> — use
              your power (it costs Soul Energy), then read the room in the
              minigame.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-cream">Outreach</span> —
              message anyone privately.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-cream">Consultation</span> —
              debate, then vote someone to prison.
            </p>
          </div>

          {myPlayer.ready ? (
            <p className="text-center text-sm text-cream/70 lg:text-left">
              You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
              {total})
            </p>
          ) : (
            <button
              onClick={() => setReady(myPlayer.id, true)}
              className="rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
            >
              I&rsquo;m ready ({readyCount}/{total})
            </button>
          )}
          {remainingSec !== null && (
            <p className="text-center text-xs font-semibold text-gold lg:text-left">
              Most are ready &mdash; starting in {remainingSec}s
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
