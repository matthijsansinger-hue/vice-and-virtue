"use client";

import { useState } from "react";
import Link from "next/link";
import { setVote, endConsultation } from "@/lib/game";
import { Centered } from "./Centered";
import type { Room, Player } from "@/lib/types";

type TallyResult =
  | { kind: "imprisoned"; player: Player }
  | { kind: "no_votes" }
  | { kind: "skip_majority" }
  | { kind: "tie" };

function computeTally(voters: Player[], players: Player[]): TallyResult {
  const counts: Record<string, number> = {};
  for (const p of voters) {
    if (!p.vote) continue;
    counts[p.vote] = (counts[p.vote] ?? 0) + 1;
  }
  const skipCount = counts["skip"] ?? 0;
  delete counts["skip"];

  const entries = Object.entries(counts);
  if (entries.length === 0) return { kind: "no_votes" };

  const maxCount = Math.max(...entries.map(([, c]) => c));
  if (skipCount >= maxCount) return { kind: "skip_majority" };

  const top = entries.filter(([, c]) => c === maxCount);
  if (top.length > 1) return { kind: "tie" };

  const player = players.find((p) => p.id === top[0][0]);
  return player ? { kind: "imprisoned", player } : { kind: "no_votes" };
}

export function Consultation({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const isHost = myPlayer?.is_host ?? false;
  // Active = alive AND free. Only active players vote and are vote targets.
  const active = players.filter((p) => !p.in_prison && !p.dead);
  const voters = active;
  const votableTargets = active.filter((p) => p.id !== myPlayer?.id);

  const votedCount = voters.filter((p) => p.vote).length;
  const allVoted = voters.length > 0 && voters.every((p) => p.vote);

  // Safety guard: not enough active players to keep playing.
  if (active.length <= 1) {
    return (
      <Centered className="bg-consultation-bg text-cream">
        <p className="text-2xl font-semibold">Game over</p>
        <p className="mt-2 max-w-sm text-cream/70">
          Only {active.length} active player(s) left.
        </p>
        <Link href="/" className="mt-4 text-gold underline">
          Back to start
        </Link>
      </Centered>
    );
  }

  async function submitVote() {
    if (!myPlayer || !selected) return;
    setSubmitting(true);
    try {
      await setVote(myPlayer.id, selected);
    } finally {
      setSubmitting(false);
    }
  }

  async function advance() {
    setAdvancing(true);
    try {
      await endConsultation(room.id, players, room.day);
    } catch {
      setAdvancing(false);
    }
  }

  // ----- While voting is still in progress -----

  if (!allVoted) {
    // Dead: passive, can't vote.
    if (myPlayer?.dead) {
      return (
        <Centered className="bg-consultation-bg text-cream">
          <p className="text-2xl font-semibold">You&rsquo;re dead</p>
          <p className="mt-2 text-cream/70">You cannot vote.</p>
          <p className="mt-6 text-sm text-cream/60">
            {votedCount}/{voters.length} voted
          </p>
        </Centered>
      );
    }

    // Imprisoned: passive, can't vote.
    if (myPlayer?.in_prison) {
      return (
        <Centered className="bg-consultation-bg text-cream">
          <p className="text-2xl font-semibold">You&rsquo;re in prison</p>
          <p className="mt-2 text-cream/70">You cannot vote this round.</p>
          <p className="mt-6 text-sm text-cream/60">
            {votedCount}/{voters.length} voted
          </p>
        </Centered>
      );
    }

    // Active player who hasn't voted yet: the voting UI.
    if (myPlayer && !myPlayer.vote) {
      return (
        <main className="flex min-h-screen flex-col items-center bg-consultation-bg px-6 py-12 text-cream">
          <div className="w-full max-w-sm">
            <h1 className="text-center text-sm uppercase tracking-widest text-gold">
              Day {room.day} &mdash; consultation
            </h1>
            <p className="mt-2 text-center text-sm text-cream/70">
              Vote to send a player to prison
            </p>

            <ul className="mt-6 flex flex-col gap-2">
              {votableTargets.map((p) => (
                <li key={p.id}>
                  <VoteOption
                    label={p.name}
                    selected={selected === p.id}
                    onClick={() => setSelected(p.id)}
                  />
                </li>
              ))}
              <li>
                <VoteOption
                  label="Skip vote"
                  selected={selected === "skip"}
                  onClick={() => setSelected("skip")}
                />
              </li>
            </ul>

            <button
              onClick={submitVote}
              disabled={!selected || submitting}
              className="mt-6 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit vote"}
            </button>

            <p className="mt-3 text-center text-xs text-cream/60">
              Votes are anonymous. {votedCount}/{voters.length} voted.
            </p>
          </div>
        </main>
      );
    }

    // Active player who already voted: just waiting.
    return (
      <Centered className="bg-consultation-bg text-cream">
        <p className="text-xl font-semibold">You voted.</p>
        <p className="mt-2 text-cream/70">
          Waiting for the other players&hellip;
        </p>
        <p className="mt-6 text-sm text-cream/60">
          {votedCount}/{voters.length} voted
        </p>
      </Centered>
    );
  }

  // ----- All voted: tally + result + (host) advance -----
  // EVERYONE falls through here, including dead/imprisoned players, so
  // a dead-or-imprisoned host can still click "Continue".

  const tally = computeTally(voters, players);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-consultation-bg px-6 text-center text-cream">
      <h1 className="text-sm uppercase tracking-widest text-gold">
        Day {room.day} &mdash; result
      </h1>

      {tally.kind === "imprisoned" ? (
        <p className="mt-4 max-w-sm text-2xl font-semibold">
          {tally.player.name} has been imprisoned.
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-sm text-2xl font-semibold">
            No one was imprisoned.
          </p>
          <p className="mt-2 text-sm text-cream/70">
            {tally.kind === "skip_majority"
              ? "The group chose to skip the vote."
              : tally.kind === "tie"
                ? "The vote was tied."
                : "No votes were cast."}
          </p>
        </>
      )}

      {(myPlayer?.dead || myPlayer?.in_prison) && (
        <p className="mt-4 text-xs text-cream/50 italic">
          {myPlayer.dead ? "You are dead." : "You are in prison."}
        </p>
      )}

      {isHost ? (
        <button
          onClick={advance}
          disabled={advancing}
          className="mt-8 rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {advancing ? "Continuing…" : `Continue to day ${room.day + 1}`}
        </button>
      ) : (
        <p className="mt-8 text-sm text-cream/60">
          Waiting for the host&hellip;
        </p>
      )}
    </main>
  );
}

function VoteOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "w-full rounded-lg px-4 py-3 text-left transition-colors " +
        (selected
          ? "border-2 border-gold bg-cream text-home-bg"
          : "border border-gold/40 bg-consultation-fg/30 text-cream hover:bg-consultation-fg/50")
      }
    >
      {label}
    </button>
  );
}
