"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, MotionConfig, type Variants } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  PhaseTimer,
  StatePanel,
} from "@/components/ui/royal";
import { supabase } from "@/lib/supabase";
import { endMinigame, MINIGAME_SECONDS } from "@/lib/game";
import { CONTINUE_SECONDS, setContinueDeadline } from "@/lib/useMajorityAdvance";
import { awardAchievement } from "@/lib/achievements";
import { displayedName } from "@/lib/swaps";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import type { Room, Player } from "@/lib/types";

// Faster stagger for the tag grid — up to ~19 rows, so the cascade has to
// finish quickly.
const gridContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } },
};

// Tiny deterministic PRNG used to shuffle Torment's name list so the
// scramble is stable across renders within a single minigame round but
// not predictable across games.
function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Returns a derangement-like permutation of [0..n) seeded by `seed`.
// Fisher-Yates with a follow-up pass that swaps any element that
// happens to land on its own index, so no row ends up showing its
// own real name (which would break Torment's deception).
function tormentPermutation(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  for (let i = 0; i < n; i++) {
    if (indices[i] === i) {
      const swap = (i + 1) % n;
      [indices[i], indices[swap]] = [indices[swap], indices[i]];
    }
  }
  return indices;
}

type Guess = "vice" | "virtue" | "unknown";

export function Minigame({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [guesses, setGuesses] = useState<Record<string, Guess>>({});
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [soulWarnDismissed, setSoulWarnDismissed] = useState(false);
  const submittedRef = useRef(false);
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
  // Day-1 heads-up shown to everyone when an anomaly (the Wandering Soul) is in
  // play: tagging it Vice/Virtue is always wrong and zeroes the round.
  const showSoulWarning =
    room.day === 1 &&
    !soulWarnDismissed &&
    (room.role_pool ?? []).includes("wandering_soul");
  // Guess targets: include hospitalized players (their alignment is
  // still secret), but exclude dead (alignment revealed) and imprisoned.
  // Sorted by created_at into a STABLE order: realtime/resync can deliver the
  // `players` array in a changed order at the start of the round, which would
  // otherwise reshuffle the keyed rows mid-click. A fixed order keeps each row
  // (and its Vice/Virtue/? buttons) put so quick taps land where intended.
  const others = useMemo(
    () =>
      players
        .filter((p) => p.id !== myPlayer?.id && !p.dead && !p.in_prison)
        .sort((a, b) =>
          a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
        ),
    [players, myPlayer?.id]
  );

  // Pre-compute the Torment name scramble. Seeded by room.id + day so
  // every render in the same minigame round sees the same permutation,
  // but it's unpredictable across rooms/days. Only matters when this
  // player is the torment target.
  const tormentedPermutation = useMemo(() => {
    if (others.length < 2) return others.map((_, i) => i);
    return tormentPermutation(
      others.length,
      hashString(`${room.id}-${room.day}`)
    );
  }, [others.length, room.id, room.day]);

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

  // Submits this player's guesses and marks them done. Scoring runs in
  // the database (submit_minigame_guesses) so the real roles never reach
  // the browser — we send only our guesses (+1 correct, +0.4 unknown,
  // any explicit wrong tag => 0 for the round).
  async function submit() {
    if (
      submittedRef.current ||
      !myPlayer ||
      myPlayer.in_prison ||
      myPlayer.dead ||
      myPlayer.in_hospital
    )
      return;
    submittedRef.current = true;
    await supabase.rpc("submit_minigame_guesses", {
      p_player_id: myPlayer.id,
      p_guesses: guesses,
    });

    // "Unwavering" badge: tagged every player V/V, never left a "?".
    const noUnknown =
      others.length > 0 &&
      others.every((p) => {
        const g = guesses[p.id];
        return g === "vice" || g === "virtue";
      });
    if (noUnknown && myPlayer.user_id) {
      void awardAchievement("minigame_no_unknown");
    }
  }

  // Auto-submit when the timer runs out.
  useEffect(() => {
    if (expired) submit();
    // Only react to `expired` flipping true; submit() is guarded so it
    // can never run twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // At the start of the minigame every active player's ready flag is reset
  // to false. We only trust "everyone is done" once we've actually observed
  // that reset land — otherwise stale ready flags from a previous phase
  // would end the minigame immediately.
  useEffect(() => {
    if (active.length > 0 && active.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Majority submitted → shorten the timer to a visible 10s countdown so
  // everyone sees the round is about to end. (Won't extend a timer already
  // under 10s.) Stragglers auto-submit at expiry via the effect above.
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

  // Everyone done → end immediately (don't wait out the countdown). Else the
  // host ends the minigame when the (possibly shortened) timer elapses, plus a
  // short grace so stragglers' auto-submit guesses land before scoring runs.
  const allReady =
    resetSeen && active.length > 0 && active.every((p) => p.ready);
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const timerExpired = endsAt !== null && now >= endsAt + 1500;
    if (allReady || timerExpired) {
      advancedRef.current = true;
      endMinigame(room.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, now, endsAt, room.id, allReady]);

  function setGuess(targetId: string, guess: Guess) {
    setGuesses((current) => ({ ...current, [targetId]: guess }));
  }

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

  // Hospital + prison stay on the normal Quiz board as read-only spectators
  // (controls disabled below) — no passive screen.

  // After submitting, wait for the rest of the players.
  if (myPlayer?.ready) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="constellations-bg flex min-h-screen flex-col items-center justify-center px-6 text-cream">
        <StatePanel accentRgb="227,181,16" pulse>
          <p className={`text-2xl font-bold text-gold ${heading}`}>Done!</p>
          <p className="mt-2 text-cream/70">
            Waiting for the other players&hellip;
          </p>
        </StatePanel>
      </main>
      </MotionConfig>
    );
  }

  const taggedCount = others.filter((p) => guesses[p.id]).length;

  // If this player just took over as Murder via succession, show a
  // one-time banner explaining the role change.
  const isFreshSuccessor = !!myPlayer?.is_recent_successor && !bannerDismissed;

  return (
    <MotionConfig reducedMotion="user">
    <main className="flex min-h-screen flex-col items-center constellations-bg px-4 pb-8 pt-16 text-cream">
      {showSoulWarning && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setSoulWarnDismissed(true)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border-2 border-soul/60 bg-[#0d1c20] p-6 text-center text-cream"
            style={{ boxShadow: "0 0 30px rgba(125,224,240,.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className={`text-xs uppercase tracking-[0.3em] text-soul ${heading}`}>
              An anomaly walks among you
            </p>
            <h2 className={`mt-2 text-2xl font-bold text-soul ${heading}`}>
              Beware the Wandering Soul
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-cream/85">
              On the Quiz, tagging the{" "}
              <span className="font-semibold text-soul">Wandering Soul</span> as
              Vice or Virtue is <span className="font-semibold">always wrong</span>{" "}
              and zeroes your score for the round. Mark it{" "}
              <span className="font-semibold">&ldquo;unknown.&rdquo;</span>
            </p>
            <button
              onClick={() => setSoulWarnDismissed(true)}
              className={`mt-5 w-full rounded-xl bg-soul py-3 font-semibold text-[#06363f] shadow-[0_0_16px_rgba(125,224,240,.3)] transition-opacity hover:opacity-90 ${heading}`}
            >
              Got it
            </button>
          </div>
        </div>
      )}
      <motion.div
        className="w-full max-w-4xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <div className="mx-auto max-w-2xl">
        <PhaseTip
          id="minigame"
          text="Read the room: tag each player Vice or Virtue. Correct tags earn Soul Energy; a wrong guess scores 0 for the whole round, so leave anyone you're unsure about as “?”."
        />
        {isFreshSuccessor && (
          <div className="mb-4 rounded-xl border-2 border-gold bg-cream p-4 text-home-bg">
            <p className="text-sm uppercase tracking-widest text-home-bg/60">
              Role change
            </p>
            <p className="mt-2 font-semibold">
              You are now Murder.
            </p>
            <p className="mt-1 text-sm text-home-bg/80">
              The previous Murder picked you as their successor before dying.
              Your Murder ability becomes available in the next role-action
              phase.
            </p>
            <button
              onClick={() => setBannerDismissed(true)}
              className="mt-3 rounded-lg bg-home-bg px-4 py-1 text-sm font-semibold text-cream transition-opacity hover:opacity-90"
            >
              Got it
            </button>
          </div>
        )}

        {/* Timer */}
        <motion.div variants={fadeUp} className="text-center">
          <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
            Day {room.day} &mdash; quiz
          </p>
          <PhaseTimer seconds={remainingSec} className="mt-1" />
          <p className="mt-1 text-sm text-cream/60">
            Tag each player.{" "}
            <span className="font-semibold text-cream/80">
              {taggedCount}/{others.length}
            </span>{" "}
            tagged.
          </p>
        </motion.div>
        </div>

        {/* Player tag grid — multi-column on desktop so it fills the width
            instead of one tall column. If Torment targeted me, the displayed
            NAMES are scrambled across all rows (each row keeps its real id, so
            clicks still tag the real player; the names just don't match). */}
        <motion.ul
          variants={gridContainer}
          className={
            "mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" +
            (canAct ? "" : " pointer-events-none opacity-60")
          }
        >
          {others.map((player, index) => {
            const guess = guesses[player.id];
            // Default to "unknown" so the "?" pill is visually selected
            // for untagged rows (it was already the scoring default).
            const effectiveGuess: Guess = guess ?? "unknown";
            const isTormented = !!myPlayer?.is_tormented;
            const displayedFor = isTormented
              ? others[tormentedPermutation[index]]
              : player;
            const shownName = displayedName(displayedFor, room, players, myPlayer?.id);
            return (
              <motion.li
                key={player.id}
                variants={fadeUp}
                className="flex items-center justify-between gap-2 rounded-xl border border-gold/50 px-3 py-2 text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.3)]"
                style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {shownName}
                </span>
                <div className="flex gap-1">
                  <GuessButton
                    label="Vice"
                    active={effectiveGuess === "vice"}
                    activeClass="bg-consultation-bg text-cream shadow-[0_0_10px_rgba(128,0,32,.55)]"
                    onClick={() => setGuess(player.id, "vice")}
                  />
                  <GuessButton
                    label="Virtue"
                    active={effectiveGuess === "virtue"}
                    activeClass="bg-consultation-fg text-cream shadow-[0_0_10px_rgba(0,0,128,.55)]"
                    onClick={() => setGuess(player.id, "virtue")}
                  />
                  <GuessButton
                    label="?"
                    active={effectiveGuess === "unknown"}
                    activeClass="bg-home-bg text-cream shadow-[0_0_8px_rgba(78,54,36,.6)]"
                    onClick={() => setGuess(player.id, "unknown")}
                  />
                </div>
              </motion.li>
            );
          })}
        </motion.ul>

        {others.length === 0 && (
          <p className="mt-6 text-center text-cream/60">
            There are no other players to guess.
          </p>
        )}

        <motion.div variants={fadeUp} className="mx-auto mt-6 max-w-sm">
          {canAct ? (
            <>
              <motion.button
                onClick={submit}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
              >
                Done
              </motion.button>
              <p className="mt-2 text-center text-xs text-cream/50">
                Untagged players count as &ldquo;?&rdquo;. One wrong Vice/Virtue
                guess scores 0 for the round &mdash; leave anyone you&rsquo;re
                unsure about as &ldquo;?&rdquo;.
              </p>
            </>
          ) : (
            <div className="rounded-xl border-2 border-gold/40 bg-black/25 py-3 text-center text-sm font-semibold text-cream/80">
              You&rsquo;re in {myPlayer?.in_hospital ? "hospital" : "prison"} &mdash; you can watch but can&rsquo;t play this round.
            </div>
          )}
        </motion.div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}

// Tag pill: colour + glow transitions only (no transform — Tailwind v4
// scale utilities don't transition reliably, see globals gotcha).
function GuessButton({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-md px-2 py-1 text-xs font-semibold transition-[background-color,color,box-shadow,border-color] duration-150 " +
        (active
          ? activeClass
          : "border border-home-bg/30 text-home-bg/60 hover:border-home-bg/60 hover:text-home-bg")
      }
    >
      {label}
    </button>
  );
}
