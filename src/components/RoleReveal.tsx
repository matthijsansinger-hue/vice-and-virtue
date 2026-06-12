"use client";

import { motion, MotionConfig } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  CornerFrame,
  plaqueStyle,
  PlaqueLayers,
  SoulEnergyText,
} from "@/components/ui/royal";
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
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center justify-center bg-home-bg px-6 py-16 text-cream">
      {/* Card + "how a day works" panel side-by-side on desktop; stacked on
          mobile so the reveal moment fills the screen on both. */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={staggerContainer}
        className="flex w-full max-w-4xl flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-center lg:gap-12"
      >
        {/* The reveal moment: the card springs in over a breathing gold aura. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 22, delay: 0.1 }}
          className="relative"
        >
          <span className="card-aura pointer-events-none absolute -inset-6 rounded-full" aria-hidden />
          <div className="relative">
            <RoleCard role={myRole} />
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="flex w-full max-w-sm flex-col gap-4">
          <div
            className="relative overflow-hidden rounded-xl border-2 border-gold/40 p-4 text-sm text-cream/80"
            style={plaqueStyle()}
          >
            <PlaqueLayers />
            <CornerFrame />
            <p className={`relative text-xs uppercase tracking-widest text-gold ${heading}`}>
              How a day works
            </p>
            <p className="relative mt-2">
              <span className="font-semibold text-[#a9aaf0]">Reflection</span> —{" "}
              <SoulEnergyText>use your power (it costs Soul Energy), then read the room in the minigame.</SoulEnergyText>
            </p>
            <p className="relative mt-1">
              <span className="font-semibold text-[#bdbe8e]">Outreach</span> —
              message anyone privately.
            </p>
            <p className="relative mt-1">
              <span className="font-semibold text-[#9af593]">Consultation</span> —
              debate, then vote someone to prison.
            </p>
          </div>

          {myPlayer.ready ? (
            <p className="rounded-full border border-gold/30 bg-black/25 px-4 py-2 text-center text-sm text-cream/70 lg:text-left">
              You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
              {total})
            </p>
          ) : (
            <motion.button
              onClick={() => setReady(myPlayer.id, true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className={`rounded-xl bg-gold px-8 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
            >
              I&rsquo;m ready ({readyCount}/{total})
            </motion.button>
          )}
          {remainingSec !== null && (
            <p className={`text-center text-xs font-semibold text-gold lg:text-left ${heading}`}>
              Most are ready &mdash; starting in {remainingSec}s
            </p>
          )}
        </motion.div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}
