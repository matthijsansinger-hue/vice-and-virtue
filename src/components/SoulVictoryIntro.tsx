"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig, type Variants } from "framer-motion";
import { heading } from "@/components/ui/royal";
import { setReady, resetRoomReady, endSoulVictoryIntro } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import type { Player, Room } from "@/lib/types";

const loreContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.45, delayChildren: 1.1 } },
};
const loreLine: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease: [0.22, 1, 0.36, 1] } },
};

// Shown when the Wandering Soul wins (winner = 'neutral'), before the
// scoreboard. A majority pressing Continue advances to game_over.
//
// Two ways to get here — the ESCAPE (migration 094: he named every active
// player's camp and slipped out while the castle was still full) and LAST ONE
// STANDING (migration 108: Vice and Virtue wiped each other out and he outlived
// them). They share the same lore; only the title differs. The escape always
// leaves at least one other active player behind, so "at most one player still
// active" identifies the second case without needing roles (which stay secret
// until the scoreboard).
export function SoulVictoryIntro({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const isHost = myPlayer?.is_host ?? false;
  const [revealed, setRevealed] = useState(false);
  const resetRef = useRef(false);

  useEffect(() => {
    const handle = setTimeout(() => setRevealed(true), 1000);
    return () => clearTimeout(handle);
  }, []);

  // Reached from a SQL resolve_* function that doesn't reset ready; the host
  // clears it once so majority-continue starts clean.
  useEffect(() => {
    if (!isHost || resetRef.current) return;
    resetRef.current = true;
    void resetRoomReady(room.id);
  }, [isHost, room.id]);

  // A third way in (migration 118): the Game Master simply outlasted everyone
  // to round 9. That one is flagged explicitly on the room rather than inferred,
  // because it can happen with the castle still full — no player count
  // distinguishes it from an ordinary turn.
  const endurance = room.anomaly_win === "gm_endurance";
  const lastStanding =
    !endurance && players.filter((p) => !p.dead && !p.in_prison).length <= 1;

  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => endSoulVictoryIntro(room.id),
    // Normally the active players gate. On a last-standing win there may be no
    // active player left at all (a warded Soul can win from a cell), which would
    // leave an empty electorate and a screen nobody can advance — so fall back
    // to the living, then to everyone.
    electorate: (ps) => {
      const active = ps.filter((p) => !p.dead && !p.in_prison && !p.in_hospital);
      if (active.length > 0) return active;
      const living = ps.filter((p) => !p.dead);
      return living.length > 0 ? living : ps;
    },
  });

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0a1014] px-6 py-12 text-cream">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(125,224,240,.16) 0%, transparent 60%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(8,40,48,.7) 100%)",
          }}
          aria-hidden
        />

        <div className="relative w-full max-w-2xl text-center">
          <motion.h1
            initial={{ opacity: 0, scale: 0.82, y: 8 }}
            animate={revealed ? { opacity: 1, scale: 1, y: 0 } : {}}
            transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.1 }}
            className={`relative text-5xl leading-[0.95] tracking-tight sm:text-7xl ${heading}`}
            style={{
              backgroundImage: "linear-gradient(180deg,#eafdff 0%,#7de0f0 45%,#2f9fb8 78%,#0b5566 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: "drop-shadow(0 4px 20px rgba(125,224,240,.5))",
            }}
          >
            {endurance ? (
              <>
                The Game
                <br />
                Never Ends
              </>
            ) : lastStanding ? (
              <>
                The Soul
                <br />
                Walks Free
              </>
            ) : (
              <>
                The Soul
                <br />
                Escapes
              </>
            )}
          </motion.h1>

          <motion.div
            variants={loreContainer}
            initial="hidden"
            animate={revealed ? "show" : "hidden"}
            className="mx-auto mt-7 max-w-lg space-y-4 text-lg leading-relaxed text-cream/95 drop-shadow-md"
          >
            <motion.p variants={loreLine}>
              Their own laxity was their undoing, and the stranger among them went
              unnoticed.
            </motion.p>
            <motion.p variants={loreLine}>
              Neither Vice nor Virtue proved worthy of victory tonight.
            </motion.p>
            <motion.p variants={loreLine} className={`text-xl font-semibold text-cream ${heading}`}>
              The Wandering Soul claims the night &mdash; and walks alone.
            </motion.p>
          </motion.div>

          <motion.div
            className="mx-auto mt-9 max-w-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={revealed ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, delay: 2.6 }}
          >
            {myPlayer?.ready ? (
              <p className="text-sm text-cream/70">
                You&rsquo;re ready &mdash; waiting for the others ({readyCount}/{total})
              </p>
            ) : (
              <button
                onClick={() => myPlayer && setReady(myPlayer.id, true)}
                className={`w-full rounded-xl bg-soul py-3 font-semibold text-[#06363f] shadow-[0_0_16px_rgba(125,224,240,.35)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_26px_rgba(125,224,240,.55)] ${heading}`}
              >
                Continue to results ({readyCount}/{total})
              </button>
            )}
            {remainingSec !== null && (
              <p className={`mt-3 text-sm font-semibold text-soul ${heading}`}>
                Most are ready &mdash; continuing in {remainingSec}s
              </p>
            )}
          </motion.div>
        </div>
      </main>
    </MotionConfig>
  );
}
