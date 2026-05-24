"use client";

import { useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { endMinigame, MINIGAME_SECONDS } from "@/lib/game";
import { Centered } from "./Centered";
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
  const submittedRef = useRef(false);
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  // Only alive, free, non-hospitalized players play this round.
  const active = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );
  const others = active.filter((p) => p.id !== myPlayer?.id);

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

  // This player's raw score: +1 correct, -1 wrong, +0.4 for Unknown/untagged.
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
        score -= 1;
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
      .update({ minigame_score: computeScore(), ready: true })
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

  // Dead: passive screen, no participation.
  if (myPlayer?.dead) {
    return (
      <Centered className="bg-reflection-bg text-cream">
        <p className="text-xs uppercase tracking-widest text-gold">
          Day {room.day}
        </p>
        <p className="mt-2 text-2xl font-semibold">You&rsquo;re dead</p>
        <p className="mt-2 text-cream/70">The game continues without you.</p>
      </Centered>
    );
  }

  // In hospital: passive, recovers tomorrow.
  if (myPlayer?.in_hospital) {
    return (
      <Centered className="bg-reflection-bg text-cream">
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
      <Centered className="bg-reflection-bg text-cream">
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
      <Centered className="bg-reflection-bg text-cream">
        <p className="text-xl font-semibold">Done!</p>
        <p className="mt-2 text-cream/70">
          Waiting for the other players&hellip;
        </p>
      </Centered>
    );
  }

  const taggedCount = others.filter((p) => guesses[p.id]).length;

  return (
    <main className="flex min-h-screen flex-col items-center bg-reflection-bg px-4 py-8 text-cream">
      <div className="w-full max-w-md">
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

        {/* Player list */}
        <ul className="mt-6 flex flex-col gap-2">
          {others.map((player) => {
            const guess = guesses[player.id];
            return (
              <li
                key={player.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-home-bg"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {player.name}
                </span>
                <div className="flex gap-1">
                  <GuessButton
                    label="Vice"
                    active={guess === "vice"}
                    activeClass="bg-consultation-bg text-cream"
                    onClick={() => setGuess(player.id, "vice")}
                  />
                  <GuessButton
                    label="Virtue"
                    active={guess === "virtue"}
                    activeClass="bg-consultation-fg text-cream"
                    onClick={() => setGuess(player.id, "virtue")}
                  />
                  <GuessButton
                    label="?"
                    active={guess === "unknown"}
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
