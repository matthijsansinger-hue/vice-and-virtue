"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { endMinigame, MINIGAME_SECONDS } from "@/lib/game";
import { awardAchievement } from "@/lib/achievements";
import { displayedName } from "@/lib/swaps";
import { Centered } from "./Centered";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import type { Room, Player } from "@/lib/types";

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
  const submittedRef = useRef(false);
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  // Players who actually play this round (used for the all-ready check
  // and the reset-seen guard). Hospitalized + imprisoned + dead skip it.
  const active = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );
  // Guess targets: include hospitalized players (their alignment is
  // still secret), but exclude dead (alignment revealed) and imprisoned.
  const others = players.filter(
    (p) => p.id !== myPlayer?.id && !p.dead && !p.in_prison
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

  // The host ends the minigame once every active player is done, or — as
  // a fallback if someone never submits — shortly after the timer expires.
  const allReady = active.length > 0 && active.every((p) => p.ready);
  const graceOver = endsAt !== null && now > endsAt + 5000;
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const everyoneDone = resetSeen && allReady;
    if (everyoneDone || graceOver) {
      advancedRef.current = true;
      endMinigame(room.id);
    }
  }, [isHost, resetSeen, allReady, graceOver, room.id]);

  function setGuess(targetId: string, guess: Guess) {
    setGuesses((current) => ({ ...current, [targetId]: guess }));
  }

  // Dead: passive screen, no participation. Dead chat embedded.
  if (myPlayer?.dead) {
    return (
      <main className="flex min-h-screen flex-col items-center constellations-bg px-6 py-12 text-cream">
        <div className="w-full max-w-sm text-center">
          <p className="text-xs uppercase tracking-widest text-gold">
            Day {room.day}
          </p>
          <p className="mt-2 text-2xl font-semibold">You&rsquo;re dead</p>
          <p className="mt-2 text-cream/70">The game continues without you.</p>
        </div>
        <div className="mt-6 w-full max-w-sm">
          <DeadChat room={room} players={players} myPlayer={myPlayer} />
        </div>
      </main>
    );
  }

  // In hospital: passive, recovers tomorrow.
  if (myPlayer?.in_hospital) {
    return (
      <Centered className="constellations-bg text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Day {room.day}
        </p>
        <p className="mt-2 text-2xl font-semibold">You&rsquo;re in hospital</p>
        <p className="mt-2 text-cream/70">
          You skip this day. You&rsquo;ll recover tomorrow.
        </p>
      </Centered>
    );
  }

  // Imprisoned: passive screen, no participation.
  if (myPlayer?.in_prison) {
    return (
      <Centered className="constellations-bg text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Day {room.day}
        </p>
        <p className="mt-2 text-xl font-semibold">You&rsquo;re in prison</p>
        <p className="mt-2 text-cream/70">You cannot play this round.</p>
      </Centered>
    );
  }

  // After submitting, wait for the rest of the players.
  if (myPlayer?.ready) {
    return (
      <Centered className="constellations-bg text-cream">
        <p className="text-xl font-semibold">Done!</p>
        <p className="mt-2 text-cream/70">
          Waiting for the other players&hellip;
        </p>
      </Centered>
    );
  }

  const taggedCount = others.filter((p) => guesses[p.id]).length;

  // If this player just took over as Murder via succession, show a
  // one-time banner explaining the role change.
  const isFreshSuccessor = !!myPlayer?.is_recent_successor && !bannerDismissed;

  return (
    <main className="flex min-h-screen flex-col items-center constellations-bg px-4 pb-8 pt-16 text-cream">
      <div className="w-full max-w-4xl">
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
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-gold">
            Day {room.day} &mdash; reflection minigame
          </p>
          <p className="mt-1 text-5xl font-semibold tabular-nums">
            {remainingSec}
            <span className="text-2xl text-cream/60">s</span>
          </p>
          <p className="mt-1 text-sm text-cream/60">
            Tag each player. {taggedCount}/{others.length} tagged.
          </p>
        </div>
        </div>

        {/* Player tag grid — multi-column on desktop so it fills the width
            instead of one tall column. If Torment targeted me, the displayed
            NAMES are scrambled across all rows (each row keeps its real id, so
            clicks still tag the real player; the names just don't match). */}
        <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
              <li
                key={player.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-home-bg"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {shownName}
                </span>
                <div className="flex gap-1">
                  <GuessButton
                    label="Vice"
                    active={effectiveGuess === "vice"}
                    activeClass="bg-consultation-bg text-cream"
                    onClick={() => setGuess(player.id, "vice")}
                  />
                  <GuessButton
                    label="Virtue"
                    active={effectiveGuess === "virtue"}
                    activeClass="bg-consultation-fg text-cream"
                    onClick={() => setGuess(player.id, "virtue")}
                  />
                  <GuessButton
                    label="?"
                    active={effectiveGuess === "unknown"}
                    activeClass="bg-home-bg text-cream"
                    onClick={() => setGuess(player.id, "unknown")}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {others.length === 0 && (
          <p className="mt-6 text-center text-cream/60">
            There are no other players to guess.
          </p>
        )}

        <div className="mx-auto mt-6 max-w-sm">
          <button
            onClick={submit}
            className="w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Done
          </button>
          <p className="mt-2 text-center text-xs text-cream/50">
            Untagged players count as &ldquo;?&rdquo;. One wrong Vice/Virtue
            guess scores 0 for the round &mdash; leave anyone you&rsquo;re
            unsure about as &ldquo;?&rdquo;.
          </p>
        </div>
      </div>
    </main>
  );
}

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
        "rounded px-2 py-1 text-xs font-semibold transition-colors " +
        (active ? activeClass : "border border-home-bg/30 text-home-bg/60")
      }
    >
      {label}
    </button>
  );
}
