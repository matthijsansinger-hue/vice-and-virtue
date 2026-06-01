"use client";

import { useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { endMinigame, MINIGAME_SECONDS } from "@/lib/game";
import { displayedName } from "@/lib/swaps";
import { Centered } from "./Centered";
import { DeadChat } from "./DeadChat";
import type { Room, Player } from "@/lib/types";

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

  // This player's raw score:
  //   +1 per correct V/V tag
  //   +0.4 per Unknown / untagged
  //   ANY explicit wrong V/V tag wipes the day's score to 0 — so
  //   players are better off leaving uncertain rows as "?" than
  //   guessing wrong on them.
  function computeScore(): number {
    let score = 0;
    for (const target of others) {
      const guess: Guess = guesses[target.id] ?? "unknown";
      const truth = target.role ? ROLES[target.role]?.camp : undefined;
      if (guess === "unknown" || !truth) {
        score += 0.4;
      } else if (guess === truth) {
        score += 1;
      } else {
        // Wrong explicit tag — zero out and stop counting.
        return 0;
      }
    }
    return score;
  }

  // Writes the player's score and marks them done.
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
    await supabase
      .from("players")
      .update({
        minigame_score: computeScore(),
        minigame_submitted_at: new Date().toISOString(),
        ready: true,
      })
      .eq("id", myPlayer.id);
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
  const isFreshSuccessor =
    room.recent_successor_id === myPlayer?.id && !bannerDismissed;

  return (
    <main className="flex min-h-screen flex-col items-center constellations-bg px-4 py-8 text-cream">
      <div className="w-full max-w-md">
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

        {/* Player list.
            If Torment targeted me, the displayed NAMES are rotated by
            one across all rows — each row keeps its real player ID
            (clicks still tag the real player), but the names shown
            don't match. Even if you visually identify someone correctly
            you'll be tagging the wrong row. */}
        <ul className="mt-6 flex flex-col gap-2">
          {others.map((player, index) => {
            const guess = guesses[player.id];
            // Default to "unknown" so the "?" pill is visually selected
            // for untagged rows (it was already the scoring default).
            const effectiveGuess: Guess = guess ?? "unknown";
            const isTormented = room.torment_target === myPlayer?.id;
            // Tormented view: show the next player's name on each row,
            // wrapping the last row back to the first.
            const displayedFor = isTormented
              ? others[(index + 1) % others.length]
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

        <button
          onClick={submit}
          className="mt-6 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          Done
        </button>
        <p className="mt-2 text-center text-xs text-cream/50">
          Players you don&rsquo;t tag count as Unknown.
        </p>
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
