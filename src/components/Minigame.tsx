"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { displayedName } from "@/lib/swaps";
import {
  myQuiz,
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

// The three Quiz options (migration 122). One secret choice per round.
const OPTIONS: { id: QuizChoice; title: string; text: string }[] = [
  { id: "points", title: "Soul Energy", text: "Play it safe and bank the full reward." },
  { id: "hint", title: "A whisper", text: "Half the reward, plus a clue about two other players." },
  { id: "peek", title: "Read a soul", text: "No reward — but see one player's camp." },
];

const REASON_TEXT: Record<string, string> = {
  wrong_phase: "The Quiz has already ended.",
  cannot_act: "You can't play this round.",
  bad_target: "Pick another player.",
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
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  // Players who actually play this round (used for the all-ready check
  // and the reset-seen guard). Hospitalized + imprisoned + dead skip it.
  const active = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );
  // Whether the viewer can actually act this round (hospital/prison spectate
  // read-only — controls disabled).
  const canAct = !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;

  // Peek targets: every other living player (imprisoned + hospitalised
  // included — their camp is still secret). Stable created_at order so a
  // realtime reshuffle can't move a row under a tap.
  const others = useMemo(
    () =>
      players
        .filter((p) => p.id !== myPlayer?.id && !p.dead)
        .sort((a, b) =>
          a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
        ),
    [players, myPlayer?.id]
  );

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
    if (selected === "peek" && !target) return;
    setBusy(true);
    setError(null);
    const res = await submitQuizChoice(
      myPlayer.id,
      selected,
      selected === "peek" ? target ?? undefined : undefined
    );
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
    if (active.length > 0 && active.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Majority chose → shorten the timer to a visible 10s countdown so
  // everyone sees the round is about to end. (Won't extend a timer already
  // under 10s.) Anyone who hasn't chosen by then simply gets nothing.
  const readyCount = active.filter((p) => p.ready).length;
  const majority =
    resetSeen && active.length > 0 && readyCount * 2 > active.length;
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
    resetSeen && active.length > 0 && active.every((p) => p.ready);
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
      {readyCount}/{active.length} have chosen &mdash; waiting for the others&hellip;
    </p>
  );

  const confirmLabel =
    selected === "points"
      ? `Take ${QUIZ_POINTS.points} Soul Energy`
      : selected === "hint"
        ? `Take ${QUIZ_POINTS.hint} + the whisper`
        : selected === "peek"
          ? target
            ? `Read ${nameOf(target)}'s soul`
            : "Pick a player to read"
          : "Choose an option";

  function nameOf(id: string) {
    const p = players.find((x) => x.id === id);
    return p ? displayedName(p, room, players, myPlayer?.id) : "someone";
  }

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
            id="minigame_v2"
            text="Make one secret choice: bank 100 Soul Energy, take 50 plus a clue about two players, or give up the reward to see one player's camp."
          />

          {/* Timer */}
          <motion.div variants={fadeUp} className="text-center">
            <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
              Day {room.day} &mdash; quiz
            </p>
            <PhaseTimer seconds={remainingSec} className="mt-1" />
            <p className="mt-1 text-sm text-cream/60">
              {quiz ? "Your choice is made." : "Choose one."}
            </p>
          </motion.div>
        </div>

        {quiz ? (
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
                "mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3" +
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
                      if (o.id !== "peek") setTarget(null);
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

            {/* Peek: pick whose camp to see. */}
            {selected === "peek" && canAct && !expired && (
              <motion.ul
                variants={fadeUp}
                className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                {others.map((p) => {
                  const on = target === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setTarget(p.id)}
                        className={
                          "w-full truncate rounded-xl border px-3 py-2 text-left font-medium text-home-bg transition-[border-color,box-shadow] duration-150 " +
                          (on
                            ? "border-2 border-gold shadow-[0_0_12px_rgba(227,181,16,.5)]"
                            : "border-gold/40 hover:border-gold/80")
                        }
                        style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
                      >
                        {displayedName(p, room, players, myPlayer?.id)}
                      </button>
                    </li>
                  );
                })}
                {others.length === 0 && (
                  <p className="text-center text-cream/60">There&rsquo;s nobody left to read.</p>
                )}
              </motion.ul>
            )}

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
                    disabled={!selected || busy || (selected === "peek" && !target)}
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
