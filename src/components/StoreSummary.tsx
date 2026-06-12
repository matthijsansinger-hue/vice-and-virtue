"use client";

import { motion, MotionConfig, type Variants } from "framer-motion";
import { heading, fadeUp } from "@/components/ui/royal";
import { setReady, endStoreSummary } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { displayedName } from "@/lib/swaps";
import type { EventSummaryEntry, Player, Room } from "@/lib/types";

const tollContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.35, delayChildren: 0.25 } },
};

// Shown between the shop and the camp abilities (migration 072). Surfaces the
// visible consequences of the shop phase — deaths from combat potions, bomb
// detonations and sacrifices, plus hospitalisations — anonymously (name +
// initial, no role or cause), exactly like the post-role-action event summary.
export function StoreSummary({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => endStoreSummary(room.id),
  });
  const iAmActive =
    !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;

  if (!myPlayer) {
    return (
      <main className="outreach-castle-bg flex min-h-screen items-center justify-center px-6 text-center text-home-bg">
        This game is already in progress.
      </main>
    );
  }

  const events: EventSummaryEntry[] = room.last_events ?? [];
  const playerById = new Map(players.map((p) => [p.id, p] as const));

  return (
    <MotionConfig reducedMotion="user">
    <main className="outreach-castle-bg min-h-screen px-5 py-20 text-home-bg">
      <motion.div
        className="mx-auto w-full max-w-sm"
        initial="hidden"
        animate="show"
        variants={tollContainer}
      >
        <motion.div variants={fadeUp}>
          <h1 className={`text-center text-base uppercase tracking-[0.3em] text-home-bg ${heading}`}>
            Day {room.day} &mdash; the market closes
          </h1>
          <p className="mt-1 text-center text-xs text-home-bg/60">
            Deals were struck, and not all of them in coin.
          </p>
        </motion.div>

        <ul className="mt-6 flex flex-col gap-2">
          {events.length === 0 && (
            <motion.li
              variants={fadeUp}
              className="rounded-xl border border-home-bg/30 bg-cream/60 px-4 py-3 text-center text-sm text-home-bg/70"
            >
              Nothing notable happened.
            </motion.li>
          )}

          {events.map((e, idx) => {
            const target = playerById.get(e.target_id);
            if (!target) return null;
            const isHospital = e.type === "hospitalized";
            const name = displayedName(target, room, players, myPlayer?.id);
            return isHospital ? (
              <motion.li
                key={idx}
                variants={fadeUp}
                className="flex items-center gap-3 rounded-xl border border-gold/50 px-3 py-3 text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.3)]"
                style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-home-bg text-sm font-semibold text-cream ring-2 ring-gold/40"
                  aria-hidden
                >
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm">
                  <span className="font-semibold">{name}</span>
                  <span className="mx-2 text-home-bg/40">|</span>
                  <span>was sent to the hospital</span>
                </span>
              </motion.li>
            ) : (
              <motion.li
                key={idx}
                variants={fadeUp}
                className="flex items-center gap-3 rounded-xl border-2 border-[#b3445c]/60 px-3 py-3 text-cream shadow-[0_4px_12px_rgba(0,0,0,.35),0_0_12px_rgba(128,0,32,.3)]"
                style={{
                  background:
                    "linear-gradient(165deg, rgba(128,0,32,.55) 0%, rgba(24,6,10,.92) 70%)",
                }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/40 text-sm font-semibold text-red-100 ring-2 ring-red-400/40"
                  aria-hidden
                >
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm">
                  <span className={`font-semibold ${heading}`}>{name}</span>
                  <span className="mx-2 text-cream/40">|</span>
                  <span className="text-red-200">was killed</span>
                </span>
              </motion.li>
            );
          })}
        </ul>

        <motion.div variants={fadeUp} className="mt-8 flex flex-col items-center gap-2">
          {iAmActive ? (
            myPlayer.ready ? (
              <p className="rounded-full border border-home-bg/30 bg-cream/60 px-4 py-2 text-sm text-home-bg/70">
                You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
                {total})
              </p>
            ) : (
              <motion.button
                onClick={() => setReady(myPlayer.id, true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
              >
                Continue ({readyCount}/{total})
              </motion.button>
            )
          ) : (
            <p className="text-sm text-home-bg/70">
              Waiting for the others to continue&hellip;
            </p>
          )}
          {remainingSec !== null && (
            <p className={`text-xs font-semibold text-[#6b3f1e] ${heading}`}>
              Most are ready &mdash; continuing in {remainingSec}s
            </p>
          )}
        </motion.div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}
