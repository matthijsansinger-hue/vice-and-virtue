"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig, type Variants } from "framer-motion";
import { heading } from "@/components/ui/royal";
import { setReady, resetRoomReady, endVirtueVictoryIntro } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { playVictoryMusic } from "@/lib/sound";
import type { Player, Room } from "@/lib/types";

// Slow, ceremonial reveal — the lore lines drift up one by one well after
// the title lands, so the victory beat breathes instead of snapping in.
const loreContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.45, delayChildren: 1.1 } },
};
const loreLine: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 1, ease: [0.22, 1, 0.36, 1] } },
};

// Dramatic intro shown when the Virtues win, BEFORE the regular
// game-over scoreboard. Flow:
//   0.0s – 1.0s: only the harmonious-city image is visible (silent beat)
//   1.0s+      : the lore paragraph fades in and the Continue button appears
// A majority pressing Continue → 10s countdown → endVirtueVictoryIntro flips
// the phase to game_over and everyone lands on the scoreboard together.
export function VirtueVictoryIntro({
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
  const stungRef = useRef(false);
  const resetRef = useRef(false);

  // 1-second silent beat before the text + button appear.
  useEffect(() => {
    const handle = setTimeout(() => setRevealed(true), 1000);
    return () => clearTimeout(handle);
  }, []);

  // Triumphant sting the moment the Virtue win screen appears (once).
  useEffect(() => {
    if (stungRef.current) return;
    stungRef.current = true;
    playVictoryMusic("virtue");
  }, []);

  // This phase is reached from a SQL resolve_* function that doesn't reset
  // ready, so the host clears it once so majority-continue starts clean.
  useEffect(() => {
    if (!isHost || resetRef.current) return;
    resetRef.current = true;
    void resetRoomReady(room.id);
  }, [isHost, room.id]);

  // Majority press Continue → 10s countdown → host advances to game_over.
  // Scoped to the living (the winners), so ghosted/AFK dead losers can't hold
  // the majority hostage. The dead still see the button; it just doesn't gate.
  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => endVirtueVictoryIntro(room.id),
  });

  return (
    <MotionConfig reducedMotion="user">
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#2a3f5e] bg-cover bg-center bg-no-repeat px-6 py-12 text-cream"
      style={{ backgroundImage: "url('/virtues-win-bg.png')" }}
    >
      {/* Full-screen dark overlay so the lore text stays legible against the
          bright sunny image. A warm golden glow radiates from the centre —
          the dawn breaking. */}
      <div
        className="pointer-events-none absolute inset-0 bg-black/55"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(227,181,16,.22) 0%, transparent 55%)",
        }}
        aria-hidden
      />

      <div className="relative w-full max-w-2xl text-center">
        {/* Hero title — a huge gold-leaf headline that swells in slowly over
            its own golden dawn glow so it crowns the bright scene. */}
        <div className="relative mx-auto w-fit">
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 scale-[1.7]"
            style={{
              background:
                "radial-gradient(ellipse, rgba(227,181,16,.6) 0%, transparent 70%)",
              filter: "blur(22px)",
            }}
            initial={{ opacity: 0 }}
            animate={revealed ? { opacity: [0, 1, 0.8], scale: [1.5, 1.75, 1.7] } : {}}
            transition={{ duration: 2.4, ease: "easeOut" }}
          />
          <motion.h1
            initial={{ opacity: 0, scale: 0.82, y: 8 }}
            animate={revealed ? { opacity: 1, scale: 1, y: 0 } : {}}
            transition={{ type: "spring", stiffness: 70, damping: 18, delay: 0.1 }}
            className={`relative text-5xl leading-[0.95] tracking-tight sm:text-7xl ${heading}`}
            style={{
              backgroundImage:
                "linear-gradient(180deg,#fff7da 0%,#f4d36b 45%,#e3b510 75%,#a9790a 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextStroke: "1px rgba(120,80,0,.3)",
              filter: "drop-shadow(0 4px 18px rgba(227,181,16,.55))",
            }}
          >
            Unity
            <br />
            Prevails
          </motion.h1>
        </div>

        <motion.div
          variants={loreContainer}
          initial="hidden"
          animate={revealed ? "show" : "hidden"}
          className="mx-auto mt-7 max-w-lg space-y-4 text-lg leading-relaxed text-cream/95 drop-shadow-md"
        >
          <motion.p variants={loreLine}>
            The Vices collapse, and dawn breaks within the chamber.
          </motion.p>
          <motion.p variants={loreLine}>
            Harmony rekindles the teachings long forgotten.
          </motion.p>
          <motion.p variants={loreLine}>
            Here, humanity rose above anger and fear.
          </motion.p>
          <motion.p variants={loreLine} className={`text-xl font-semibold text-cream ${heading}`}>
            Wrath is proven wrong &mdash; unity prevails.
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
              You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
              {total})
            </p>
          ) : (
            <button
              onClick={() => myPlayer && setReady(myPlayer.id, true)}
              className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
            >
              Continue to results ({readyCount}/{total})
            </button>
          )}
          {remainingSec !== null && (
            <p className={`mt-3 text-sm font-semibold text-gold ${heading}`}>
              Most are ready &mdash; continuing in {remainingSec}s
            </p>
          )}
        </motion.div>
      </div>
    </main>
    </MotionConfig>
  );
}
