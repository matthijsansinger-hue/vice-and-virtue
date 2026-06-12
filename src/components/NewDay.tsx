"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { heading } from "@/components/ui/royal";
import { startNextDay } from "@/lib/game";
import type { Player, Room } from "@/lib/types";

// Splash screen shown between consultation and the next day's
// role-action. Auto-advances after a short timer (NEW_DAY_SECONDS,
// stored as room.phase_ends_at). The host's client triggers the
// actual advance.
export function NewDay({
  room,
  myPlayer,
}: {
  room: Room;
  myPlayer: Player | null;
}) {
  const advancedRef = useRef(false);
  const isHost = myPlayer?.is_host ?? false;

  const endsAtMs = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;

  // Live countdown for the splash text.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const remaining = endsAtMs
    ? Math.max(0, Math.ceil((endsAtMs - now) / 1000))
    : 0;

  // Host-only auto-advance once the timer expires.
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    if (!endsAtMs) return;
    if (now < endsAtMs) return;
    advancedRef.current = true;
    startNextDay(room.id, room.day);
  }, [isHost, endsAtMs, now, room.id, room.day]);

  // The day shown should be the NEXT day, since this splash is the
  // transition into it. room.day is still the day that just ended.
  const nextDay = room.day + 1;

  return (
    <MotionConfig reducedMotion="user">
    <main className="constellations-bg flex min-h-screen flex-col items-center justify-center px-6 text-cream">
      {/* The day number rises out of an enchanted aura — a quiet, magical
          beat between days. */}
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`text-sm uppercase tracking-[0.35em] text-gold ${heading}`}
      >
        A new day in the castle
      </motion.p>
      <div className="relative mt-3">
        <span className="card-aura pointer-events-none absolute -inset-10 rounded-full" aria-hidden />
        <motion.h1
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 18, delay: 0.15 }}
          className={`relative text-6xl font-bold text-cream ${heading}`}
          style={{ textShadow: "0 0 30px rgba(118,120,237,.6)" }}
        >
          Day {nextDay}
        </motion.h1>
      </div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="mt-6 max-w-xs text-center text-sm text-cream/70"
      >
        Use your ability again &mdash; the next reflection begins in {remaining}.
      </motion.p>
    </main>
    </MotionConfig>
  );
}
