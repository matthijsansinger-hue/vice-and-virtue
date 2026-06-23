"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { heading, CornerFrame } from "@/components/ui/royal";
import { endWanderingSoulIntro } from "@/lib/game";
import { ROLES } from "@/lib/roles";
import { RoleCard } from "./RoleCard";
import type { Player, Room } from "@/lib/types";

// One-time anomaly intro, shown to EVERYONE when the Wandering Soul is in the
// game (inserted after lore_intro). Host-advanced: the host reads the card +
// win condition + the Quiz warning, then Continue moves on to the role reveal /
// first action (endWanderingSoulIntro).
export function WanderingSoulIntro({
  room,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const isHost = myPlayer?.is_host ?? false;
  const advancedRef = useRef(false);

  function next() {
    if (advancedRef.current) return;
    advancedRef.current = true;
    endWanderingSoulIntro(room.id, room.role_assign_mode).catch(() => {
      advancedRef.current = false;
    });
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0b1117] px-6 py-16 text-cream">
      {/* Spectral cyan vignette. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, rgba(125,224,240,.12) 0%, transparent 60%)",
        }}
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md"
      >
        <p className={`text-center text-xs uppercase tracking-[0.3em] text-soul/80 ${heading}`}>
          An anomaly stirs
        </p>

        <div className="mt-4">
          <RoleCard role={ROLES["wandering_soul"]} />
        </div>

        <div
          className="relative mt-4 overflow-hidden rounded-2xl border-2 border-soul/40 bg-[#0d1c20]/80 p-5 text-cream"
          style={{ boxShadow: "0 6px 18px rgba(0,0,0,.4), 0 0 16px rgba(125,224,240,.14)" }}
        >
          <CornerFrame colorClass="border-soul/50" />
          <div className="relative space-y-2.5 text-sm leading-relaxed text-cream/85">
            <p>
              A soul, lost on its way from the living world to heaven, has strayed
              into the castle and cannot leave. It serves no camp.
            </p>
            <p>
              <span className={`font-semibold text-soul ${heading}`}>How it wins:</span>{" "}
              it escapes by naming the camp of every living player. Guess them all
              right and the game ends at once &mdash; the Soul alone is the winner.
            </p>
            <p className="rounded-lg border border-soul/30 bg-soul/10 px-3 py-2 text-cream/90">
              <span className="font-semibold text-soul">Beware:</span> on the Quiz,
              tagging the Wandering Soul as Vice or Virtue is{" "}
              <span className="font-semibold">always wrong</span> and zeroes your
              score that round. Mark it &ldquo;unknown.&rdquo;
            </p>
          </div>
        </div>

        {isHost ? (
          <button
            onClick={next}
            className={`mt-6 w-full rounded-xl bg-soul py-3 font-semibold text-[#06363f] shadow-[0_0_16px_rgba(125,224,240,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_26px_rgba(125,224,240,.5)] ${heading}`}
          >
            Continue
          </button>
        ) : (
          <p className="mt-6 text-center text-sm text-cream/60">
            Waiting for the host to continue&hellip;
          </p>
        )}
      </motion.div>
    </main>
  );
}
