"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  PhaseTimer,
  StatePanel,
} from "@/components/ui/royal";
import { endMinigame, MINIGAME_SECONDS } from "@/lib/game";
import { CONTINUE_SECONDS, setContinueDeadline } from "@/lib/useMajorityAdvance";
import {
  myQuiz,
  quizSitOut,
  submitQuizChoice,
  QUIZ_POINTS,
  type QuizChoice,
  type QuizResult,
} from "@/lib/quiz";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import { QuizOutcome } from "./QuizOutcome";
import type { Room, Player } from "@/lib/types";
import { fireHostAdvance } from "@/lib/hostAdvance";
import { pacers } from "@/lib/bots";

// The two Quiz options (migration 149; reading a soul is gone). One secret
// choice per round.
const OPTIONS: { id: QuizChoice; title: string; text: string }[] = [
  { id: "points", title: "Soul Energy", text: "Play it safe and bank the full reward." },
  {
    id: "hint",
    title: "A whisper",
    text: "No reward — a clue about two other players. It never says who is who.",
  },
];

const REASON_TEXT: Record<string, string> = {
  wrong_phase: "The Quiz has already ended.",
  cannot_act: "You can't play this round.",
  bad_target: "Pick another player.",
  no_quiz: "Your dice took today's Quiz from you.",
  bad_choice: "That option isn't in the Quiz any more.",
};

export function Minigame({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const [quiz, setQuiz] = useState<QuizResult | null>(null);
  const [selected, setSelected] = useState<QuizChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  // Players who actually play this round (used for the all-ready check
  // and the reset-seen guard). Hospitalized + imprisoned + dead skip it.
  const active = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );
  // Who sets the pace: the humans (bots act instantly — lib/bots.ts).
  const pace = pacers(active);
  // Whether the viewer can actually act this round (hospital/prison spectate
  // read-only — controls disabled).
  const canAct = !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;


  // Restore this round's choice after a refresh (the server is the record).
  useEffect(() => {
    if (!myPlayer) return;
    let cancelled = false;
    myQuiz(myPlayer.id).then((q) => {
      if (!cancelled && q) setQuiz(q);
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id, room.day]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gambling's roll of 2: no Quiz today (and the server counts them done).
  const [sittingOut, setSittingOut] = useState(false);
  useEffect(() => {
    if (!myPlayer?.id || myPlayer.role !== "gambling") return;
    let cancelled = false;
    quizSitOut(myPlayer.id).then((b) => {
      if (!cancelled) setSittingOut(b);
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id, myPlayer?.role, room.day]);

  // Ticking clock that drives the countdown display.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : MINIGAME_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  async function confirm() {
    if (!myPlayer || !selected || busy) return;
    setBusy(true);
    setError(null);
    const res = await submitQuizChoice(myPlayer.id, selected);
    setBusy(false);
    if (res.ok && res.quiz) {
      setQuiz(res.quiz);
    } else {
      setError(REASON_TEXT[res.reason ?? ""] ?? "That didn't go through — try again.");
    }
  }

  // At the start of the minigame every active player's ready flag is reset
  // to false. We only trust "everyone is done" once we've actually observed
  // that reset land — otherwise stale ready flags from a previous phase
  // would end the minigame immediately.
  useEffect(() => {
    if (pace.length > 0 && pace.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Majority chose → shorten the timer to a visible 10s countdown so
  // everyone sees the round is about to end. (Won't extend a timer already
  // under 10s.) Anyone who hasn't chosen by then simply gets nothing.
  const readyCount = pace.filter((p) => p.ready).length;
  const majority =
    resetSeen && pace.length > 0 && readyCount * 2 > pace.length;
  useEffect(() => {
    if (!isHost || !majority) return;
    if (endsAt !== null && endsAt - Date.now() <= (CONTINUE_SECONDS + 0.5) * 1000) {
      return;
    }
    void setContinueDeadline(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, majority, endsAt, room.id]);

  // Everyone chose → end immediately (don't wait out the countdown). Else the
  // host ends the round when the (possibly shortened) timer elapses, plus a
  // short grace so a last-second choice lands before the payout runs.
  const allReady =
    resetSeen && pace.length > 0 && pace.every((p) => p.ready);
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const timerExpired = endsAt !== null && now >= endsAt + 1500;
    if (allReady || timerExpired) {
      fireHostAdvance({
        ref: advancedRef,
        roomId: room.id,
        phase: room.phase,
        day: room.day,
        run: () => endMinigame(room.id),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, now, endsAt, room.id, allReady]);

  // Dead: passive screen, no participation. Dead chat embedded.
  if (myPlayer?.dead) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center constellations-bg px-6 py-12 text-cream">
        <StatePanel accentRgb="153,27,27">
          <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
            Day {room.day}
          </p>
          <p className={`mt-2 text-3xl font-bold text-red-200 ${heading}`}>
            You&rsquo;re dead
          </p>
          <p className="mt-2 text-cream/70">The game continues without you.</p>
        </StatePanel>
        <div className="mt-6 w-full max-w-sm">
          <DeadChat room={room} players={players} myPlayer={myPlayer} />
        </div>
      </main>
      </MotionConfig>
    );
  }

  const waitingLine = (
    <p className="mt-4 text-center text-sm text-cream/60">
      {readyCount}/{pace.length} have chosen &mdash; waiting for the others&hellip;
    </p>
  );

  const confirmLabel =
    selected === "points"
      ? `Take ${QUIZ_POINTS.points} Soul Energy`
      : selected === "hint"
        ? "Take the whisper"
        : "Choose an option";


  return (
    <MotionConfig reducedMotion="user">
    <main className="flex min-h-screen flex-col items-center constellations-bg px-4 pb-8 pt-16 text-cream">
      <motion.div
        className="w-full max-w-3xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <div className="mx-auto max-w-2xl">
          <PhaseTip
            id="minigame_v3"
            text="Make one secret choice: bank 100 Soul Energy, or give up the reward for a whisper — a clue about two other players."
          />

          {/* Timer */}
          <motion.div variants={fadeUp} className="text-center">
            <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
              Day {room.day} &mdash; quiz
            </p>
            <PhaseTimer seconds={remainingSec} className="mt-1" />
            <p className="mt-1 text-sm text-cream/60">
              {quiz ? "Your choice is made." : sittingOut ? "Sitting this one out." : "Choose one."}
            </p>
          </motion.div>
        </div>

        {sittingOut && !quiz ? (
          <motion.div variants={fadeUp} className="mt-6 flex justify-center">
            <StatePanel accentRgb="227,181,16">
              <p className={`text-xl font-bold text-gold ${heading}`}>No Quiz for you today</p>
              <p className="mt-2 text-cream/70">Your dice took it. Waiting for the others&hellip;</p>
            </StatePanel>
          </motion.div>
        ) : quiz ? (
          // Chosen: show what you got, then wait for the others.
          <motion.div variants={fadeUp} className="mx-auto mt-6 max-w-sm">
            <QuizOutcome quiz={quiz} room={room} players={players} myPlayer={myPlayer} />
            {waitingLine}
          </motion.div>
        ) : myPlayer?.ready ? (
          <motion.div variants={fadeUp} className="mt-6 flex justify-center">
            <StatePanel accentRgb="227,181,16" pulse>
              <p className={`text-2xl font-bold text-gold ${heading}`}>Done!</p>
              <p className="mt-2 text-cream/70">Waiting for the other players&hellip;</p>
            </StatePanel>
          </motion.div>
        ) : (
          <>
            {/* The three options. */}
            <motion.div
              variants={fadeUp}
              className={
                "mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2" +
                (canAct && !expired ? "" : " pointer-events-none opacity-60")
              }
            >
              {OPTIONS.map((o) => {
                const on = selected === o.id;
                return (
                  <button
                    key={o.id}
                    onClick={() => {
                      setSelected(o.id);
                      setError(null);
                    }}
                    className={
                      "rounded-xl border-2 px-4 py-4 text-left text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.3)] transition-[border-color,box-shadow] duration-150 " +
                      (on
                        ? "border-gold shadow-[0_3px_10px_rgba(0,0,0,.3),0_0_16px_rgba(227,181,16,.55)]"
                        : "border-gold/40 hover:border-gold/80")
                    }
                    style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
                  >
                    <span className={`block text-xs uppercase tracking-widest text-home-bg/60 ${heading}`}>
                      {o.title}
                    </span>
                    <span className={`mt-1 block text-3xl font-bold text-soul-ink ${heading}`}>
                      +{QUIZ_POINTS[o.id]}
                    </span>
                    <span className="mt-1 block text-sm leading-snug text-home-bg/75">
                      {o.text}
                    </span>
                  </button>
                );
              })}
            </motion.div>

            <motion.div variants={fadeUp} className="mx-auto mt-6 max-w-sm">
              {!canAct ? (
                <div className="rounded-xl border-2 border-gold/40 bg-black/25 py-3 text-center text-sm font-semibold text-cream/80">
                  You&rsquo;re in {myPlayer?.in_hospital ? "hospital" : "prison"} &mdash; you can watch but can&rsquo;t play this round.
                </div>
              ) : expired ? (
                <div className="rounded-xl border-2 border-gold/40 bg-black/25 py-3 text-center text-sm font-semibold text-cream/80">
                  Time&rsquo;s up &mdash; you didn&rsquo;t choose this round.
                </div>
              ) : (
                <>
                  <motion.button
                    onClick={confirm}
                    disabled={!selected || busy}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:cursor-not-allowed disabled:opacity-50 ${heading}`}
                  >
                    {busy ? "…" : confirmLabel}
                  </motion.button>
                  {error && (
                    <p className="mt-2 text-center text-sm text-red-200">{error}</p>
                  )}
                  <p className="mt-2 text-center text-xs text-cream/50">
                    Your choice is secret, and final once confirmed. No choice
                    before the timer ends means no reward.
                  </p>
                </>
              )}
            </motion.div>
          </>
        )}
      </motion.div>
    </main>
    </MotionConfig>
  );
}
