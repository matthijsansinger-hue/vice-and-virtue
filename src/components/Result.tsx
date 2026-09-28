"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  ParchmentCard,
  SoulCost,
  SoulEnergyText,
} from "@/components/ui/royal";
import { setReady, startOutreach } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { myQuiz, type QuizResult } from "@/lib/quiz";
import { QuizOutcome } from "./QuizOutcome";
import type { Room, Player } from "@/lib/types";

// After the Quiz. Choices are secret (migration 122), so there is no public
// scoreboard any more: each player sees only their own choice + payout.
export function Result({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  // Majority press Continue → 10s countdown → host advances to outreach.
  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => startOutreach(room.id),
  });
  const iAmActive =
    !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;

  // My choice for this round (null = didn't choose / couldn't play).
  const [quiz, setQuiz] = useState<QuizResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!myPlayer) return;
    let cancelled = false;
    myQuiz(myPlayer.id).then((q) => {
      if (cancelled) return;
      setQuiz(q);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id, room.day]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-6 pb-12 pt-16 text-cream">
      <motion.div
        className="w-full max-w-md"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.h1
          variants={fadeUp}
          className={`text-center text-base uppercase tracking-[0.3em] text-gold ${heading}`}
        >
          Day {room.day} &mdash; results
        </motion.h1>

        <motion.div variants={fadeUp} className="mt-6 flex flex-col gap-4">
          {quiz ? (
            <QuizOutcome quiz={quiz} room={room} players={players} myPlayer={myPlayer} />
          ) : (
            loaded &&
            myPlayer && (
              <ParchmentCard
                kicker={
                  myPlayer.dead
                    ? "You're dead"
                    : myPlayer.in_prison
                      ? "You're in prison"
                      : myPlayer.in_hospital
                        ? "You're in hospital"
                        : "You didn't choose"
                }
                center
              >
                <p className="mt-1 text-sm text-home-bg/70">
                  {iAmActive
                    ? "The timer ran out before you picked, so you earned nothing this round."
                    : "You sat this Quiz out, so you didn't earn anything this round."}
                </p>
              </ParchmentCard>
            )
          )}

          {myPlayer && (
            <ParchmentCard kicker={<SoulEnergyText onLight>Your Soul Energy</SoulEnergyText>} center>
              <p className="mt-1 text-3xl font-semibold">
                <SoulCost value={myPlayer.soul_energy} label="" onLight />
              </p>
            </ParchmentCard>
          )}

          <p className="text-center text-xs text-cream/60">
            Everyone&rsquo;s choice is secret. What did the others learn?
          </p>
        </motion.div>

        {/* Continue + back link. */}
        <motion.div
          variants={fadeUp}
          className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-2"
        >
          {iAmActive ? (
            myPlayer?.ready ? (
              <p className="rounded-full border border-gold/30 bg-black/25 px-4 py-2 text-center text-sm text-cream/70">
                You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
                {total})
              </p>
            ) : (
              <motion.button
                onClick={() => myPlayer && setReady(myPlayer.id, true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
              >
                Continue to outreach ({readyCount}/{total})
              </motion.button>
            )
          ) : (
            <p className="text-center text-sm text-cream/60">
              Waiting for the others to continue&hellip;
            </p>
          )}
          {remainingSec !== null && (
            <p className={`text-center text-xs font-semibold text-gold ${heading}`}>
              Most are ready &mdash; continuing in {remainingSec}s
            </p>
          )}

          <div className="mt-4 text-center">
            <Link href="/" className="text-xs text-cream/40 underline">
              Back to start
            </Link>
          </div>
        </motion.div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}
