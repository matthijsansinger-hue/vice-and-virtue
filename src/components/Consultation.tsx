"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  setVote,
  endConsultation,
  startRevote,
  CONSULTATION_SECONDS,
} from "@/lib/game";
import { Centered } from "./Centered";
import { TruthfulnessAction } from "./abilities/TruthfulnessAction";
import { SacrificeAction } from "./abilities/SacrificeAction";
import { displayedName } from "@/lib/swaps";
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
  const [now, setNow] = useState(() => Date.now());
  const autoSkippedRef = useRef(false);

  // Ticking clock for the 95s consultation timer.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : CONSULTATION_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  const isHost = myPlayer?.is_host ?? false;
  // Voters: only alive, free, non-hospitalized players cast votes.
  const voters = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );
  // Vote targets: anyone alive who isn't already imprisoned can be
  // imprisoned — that includes hospitalized players (per playtest
  // feedback: hospitalized players should still be imprisonable).
  const targetable = players.filter((p) => !p.in_prison && !p.dead);
  // In a re-vote, only the previously tied candidates are votable. In
  // the normal first round, every targetable non-self player is.
  const revoteCandidates = room.revote_candidates;
  const isRevote = revoteCandidates !== null && revoteCandidates.length > 0;
  const votableTargets = targetable
    .filter((p) => p.id !== myPlayer?.id)
    .filter((p) => !isRevote || revoteCandidates!.includes(p.id));
  // The game-over safety guard still uses voter count (need at least
  // 2 active voters to keep playing meaningfully).
  const active = voters;

  const votedCount = voters.filter((p) => p.vote).length;
  const allVoted = voters.length > 0 && voters.every((p) => p.vote);

  // When the timer runs out, every active voter who hasn't voted yet
  // auto-skips. Each client handles its own player.
  useEffect(() => {
    if (
      expired &&
      !autoSkippedRef.current &&
      myPlayer &&
      !myPlayer.dead &&
      !myPlayer.in_prison &&
      !myPlayer.in_hospital &&
      !myPlayer.vote
    ) {
      autoSkippedRef.current = true;
      setVote(myPlayer.id, "skip");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // Sacrifice can act any time during the consultation phase. We render
  // this block in every sub-state where an active Sacrifice player is
  // present (voting, waiting, result).
  const canSacrificeNow =
    myPlayer?.role === "sacrifice" &&
    !myPlayer.dead &&
    !myPlayer.in_prison &&
    !myPlayer.in_hospital &&
    !myPlayer.acted_this_day;
  const sacrificeBlock = canSacrificeNow && myPlayer ? (
    <div className="mt-6 w-full max-w-sm">
      <SacrificeAction
        myPlayer={myPlayer}
        players={players}
        room={room}
        mode="instant"
      />
    </div>
  ) : null;

  // Safety guard: not enough active players to keep playing.
  if (active.length <= 1) {
    return (
      <Centered className="bg-consultation-fg text-cream">
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

  async function triggerRevote(tiedIds: string[]) {
    setAdvancing(true);
    try {
      await startRevote(room.id, tiedIds);
    } catch {
      setAdvancing(false);
    }
  }

  // ----- While voting is still in progress -----

  if (!allVoted) {
    // Dead: passive, can't vote.
    if (myPlayer?.dead) {
      return (
        <Centered className="bg-consultation-fg text-cream">
          <p className="text-2xl font-semibold">You&rsquo;re dead</p>
          <p className="mt-2 text-cream/70">You cannot vote.</p>
          <p className="mt-6 text-sm text-cream/60">
            {votedCount}/{voters.length} voted
          </p>
        </Centered>
      );
    }

    // In hospital: passive, can't vote.
    if (myPlayer?.in_hospital) {
      return (
        <Centered className="bg-consultation-fg text-cream">
          <p className="text-2xl font-semibold">You&rsquo;re in hospital</p>
          <p className="mt-2 text-cream/70">You cannot vote this round.</p>
          <p className="mt-6 text-sm text-cream/60">
            {votedCount}/{voters.length} voted
          </p>
        </Centered>
      );
    }

    // Imprisoned: passive, can't vote.
    if (myPlayer?.in_prison) {
      return (
        <Centered className="bg-consultation-fg text-cream">
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
        <main className="flex min-h-screen flex-col items-center bg-consultation-fg px-6 py-12 text-cream">
          <div className="w-full max-w-sm">
            <h1 className="text-center text-sm uppercase tracking-widest text-gold">
              Day {room.day} &mdash; {isRevote ? "re-vote" : "consultation"}
            </h1>
            <p className="mt-1 text-center text-2xl font-semibold tabular-nums">
              {remainingSec}
              <span className="text-base text-cream/60">s</span>
            </p>
            <p className="mt-2 text-center text-sm text-cream/70">
              Vote to send a player to prison
            </p>

            <ul className="mt-6 flex flex-col gap-2">
              {votableTargets.map((p) => (
                <li key={p.id}>
                  <VoteOption
                    label={displayedName(p, room, players)}
                    selected={selected === p.id}
                    onClick={() => setSelected(p.id)}
                  />
                </li>
              ))}
              <li className="mt-3 border-t border-gold/30 pt-3">
                <button
                  onClick={() => setSelected("skip")}
                  className={
                    "w-full rounded-lg px-4 py-3 text-left font-semibold transition-colors " +
                    (selected === "skip"
                      ? "border-2 border-gold bg-cream text-home-bg"
                      : "border border-cream/40 bg-cream/10 text-cream/80 hover:bg-cream/20")
                  }
                >
                  Skip vote
                </button>
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

            {sacrificeBlock}
          </div>
        </main>
      );
    }

    // Active player who already voted: just waiting.
    return (
      <Centered className="bg-consultation-fg text-cream">
        <p className="text-xl font-semibold">You voted.</p>
        <p className="mt-2 text-cream/70">
          Waiting for the other players&hellip;
        </p>
        <p className="mt-6 text-sm text-cream/60">
          {votedCount}/{voters.length} voted
        </p>
        {sacrificeBlock}
      </Centered>
    );
  }

  // ----- All voted: tally + result + (host) advance -----
  // EVERYONE falls through here, including dead/imprisoned players, so
  // a dead-or-imprisoned host can still click "Continue".

  const tally = computeTally(voters, players);
  const imprisoned = tally.kind === "imprisoned" ? tally.player : null;

  // First-round tie -> host can trigger a re-vote between the tied
  // candidates. In a re-vote round, no further re-votes; "still tied"
  // just means nobody imprisoned.
  const canTriggerRevote = tally.kind === "tie" && !isRevote;
  // Compute the tied candidate ids (only meaningful when tally.kind === "tie").
  let tiedIds: string[] = [];
  if (tally.kind === "tie") {
    const counts: Record<string, number> = {};
    for (const p of voters) {
      if (!p.vote || p.vote === "skip") continue;
      counts[p.vote] = (counts[p.vote] ?? 0) + 1;
    }
    const max = Math.max(...Object.values(counts));
    tiedIds = Object.entries(counts)
      .filter(([, c]) => c === max)
      .map(([id]) => id);
  }
  const isTruthfulness = myPlayer?.role === "truthfulness";
  const canRevealVotes =
    isTruthfulness &&
    !!myPlayer &&
    !myPlayer.dead &&
    !myPlayer.in_prison &&
    !myPlayer.in_hospital &&
    !!imprisoned &&
    !room.vote_reveal;

  // When Truthfulness has revealed, show the voter list to everyone.
  const revealedVoters =
    room.vote_reveal && imprisoned
      ? players.filter((p) => p.vote === imprisoned.id)
      : [];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-consultation-fg px-6 py-12 text-center text-cream">
      <h1 className="text-sm uppercase tracking-widest text-gold">
        Day {room.day} &mdash; result
      </h1>

      {imprisoned ? (
        <p className="mt-4 max-w-sm text-2xl font-semibold">
          {displayedName(imprisoned, room, players)} has been imprisoned.
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

      {(myPlayer?.dead || myPlayer?.in_prison || myPlayer?.in_hospital) && (
        <p className="mt-4 text-xs text-cream/50 italic">
          {myPlayer.dead
            ? "You are dead."
            : myPlayer.in_hospital
              ? "You are in hospital."
              : "You are in prison."}
        </p>
      )}

      {/* Truthfulness reveal button (only visible to Truthfulness). */}
      {canRevealVotes && myPlayer && imprisoned && (
        <TruthfulnessAction
          myPlayer={myPlayer}
          room={room}
          imprisoned={imprisoned}
        />
      )}

      {/* The reveal itself, visible to everyone. */}
      {room.vote_reveal && imprisoned && (
        <div className="mt-6 w-full max-w-sm rounded-xl border border-gold/40 bg-cream p-4 text-left text-home-bg">
          <p className="text-sm uppercase tracking-widest text-home-bg/60">
            Truthfulness &mdash; voters for{" "}
            {displayedName(imprisoned, room, players)}
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {revealedVoters.map((v) => (
              <li
                key={v.id}
                className="rounded bg-home-bg/5 px-3 py-2 font-medium"
              >
                {displayedName(v, room, players)}
              </li>
            ))}
            {revealedVoters.length === 0 && (
              <li className="text-sm text-home-bg/60 italic">
                No one voted for {displayedName(imprisoned, room, players)}.
              </li>
            )}
          </ul>
        </div>
      )}

      {sacrificeBlock}

      {isHost ? (
        canTriggerRevote ? (
          <button
            onClick={() => triggerRevote(tiedIds)}
            disabled={advancing}
            className="mt-8 rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {advancing
              ? "Starting re-vote…"
              : `Re-vote between the ${tiedIds.length} tied players`}
          </button>
        ) : (
          <button
            onClick={advance}
            disabled={advancing}
            className="mt-8 rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {advancing ? "Continuing…" : `Continue to day ${room.day + 1}`}
          </button>
        )
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
          : "border border-gold/40 bg-consultation-bg text-cream hover:opacity-90")
      }
    >
      {label}
    </button>
  );
}
