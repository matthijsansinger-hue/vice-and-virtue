"use client";

import { useEffect, useRef, useState } from "react";
import {
  setVote,
  endGroupActionTarget,
  GROUP_ACTION_TARGET_SECONDS,
} from "@/lib/game";
import { ConsultationChat } from "./ConsultationChat";
import { DeadChat } from "./DeadChat";
import { displayedName } from "@/lib/swaps";
import type { Player, Room } from "@/lib/types";

// Follow-up to GroupAction when "Free a prisoner" wins. Active players
// pick which prisoner to free. The winner gets in_prison set to false;
// ties / no votes mean nobody is freed (handled in endGroupActionTarget).
export function GroupActionTarget({
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
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const advancedRef = useRef(false);
  const autoSkippedRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : GROUP_ACTION_TARGET_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  const isHost = myPlayer?.is_host ?? false;
  const voters = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );
  const prisoners = players.filter((p) => p.in_prison && !p.dead);
  const votedCount = voters.filter((p) => p.vote).length;
  const allVoted = voters.length > 0 && voters.every((p) => p.vote);

  // Auto-skip non-voters on timer expiry.
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

  // Reset-seen guard: this phase is entered with every active player's
  // vote cleared, but realtime can deliver the phase change before the
  // vote=null writes land. Without this we'd auto-advance immediately
  // off the previous phase's stale votes. Only trust "everyone voted"
  // once we've actually observed votes reset to null at least once.
  useEffect(() => {
    if (voters.length > 0 && voters.every((p) => !p.vote)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const graceOver = endsAt !== null && now > endsAt + 1500;
    const everyoneDone = resetSeen && allVoted;
    if (everyoneDone || graceOver) {
      advancedRef.current = true;
      endGroupActionTarget(room.id, players);
    }
  }, [isHost, resetSeen, allVoted, endsAt, now, room.id, players]);

  async function submit() {
    if (!myPlayer || !selected) return;
    setSubmitting(true);
    try {
      await setVote(myPlayer.id, selected);
    } finally {
      setSubmitting(false);
    }
  }

  const chatBlock = (
    <div className="mt-6 w-full max-w-sm">
      <ConsultationChat room={room} players={players} myPlayer={myPlayer} />
    </div>
  );

  // Passive screen for non-voters.
  if (myPlayer && (myPlayer.dead || myPlayer.in_prison || myPlayer.in_hospital)) {
    const label = myPlayer.dead
      ? "You're dead"
      : myPlayer.in_hospital
        ? "You're in hospital"
        : "You're in prison";
    return (
      <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 py-12 text-home-bg">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-sm uppercase tracking-widest text-home-bg/70">
            Day {room.day} &mdash; free a prisoner
          </h1>
          <p className="mt-2 text-2xl font-semibold">{label}</p>
          <p className="mt-2 text-home-bg/70">You cannot vote this round.</p>
          <p className="mt-6 text-sm text-home-bg/60">
            {votedCount}/{voters.length} voted
          </p>
        </div>
        {chatBlock}
        {myPlayer.dead && (
          <div className="mt-4 w-full max-w-sm">
            <DeadChat room={room} players={players} myPlayer={myPlayer} />
          </div>
        )}
      </main>
    );
  }

  // Voted: waiting screen.
  if (myPlayer?.vote) {
    return (
      <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 py-12 text-home-bg">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-sm uppercase tracking-widest text-home-bg/70">
            Day {room.day} &mdash; free a prisoner
          </h1>
          <p className="mt-4 text-xl font-semibold">You voted.</p>
          <p className="mt-2 text-home-bg/75">
            Waiting for the other players&hellip;
          </p>
          <p className="mt-6 text-sm text-home-bg/60">
            {votedCount}/{voters.length} voted
          </p>
        </div>
        {chatBlock}
      </main>
    );
  }

  // Active voter: prisoner list.
  return (
    <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 py-12 text-home-bg">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-home-bg/70">
          Day {room.day} &mdash; free a prisoner
        </h1>
        <p className="mt-1 text-center text-2xl font-semibold tabular-nums">
          {remainingSec}
          <span className="text-base text-home-bg/60">s</span>
        </p>
        <p className="mt-2 text-center text-sm text-home-bg/75">
          Pick the prisoner to release. Majority decides.
        </p>

        <ul className="mt-6 flex flex-col gap-2">
          {prisoners.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setSelected(p.id)}
                className={
                  "w-full rounded-lg px-4 py-3 text-left font-medium transition-colors " +
                  (selected === p.id
                    ? "border-2 border-gold bg-gold text-home-bg"
                    : "border-2 border-home-bg/60 bg-cream/70 text-home-bg hover:bg-cream")
                }
              >
                {displayedName(p, room, players, myPlayer?.id)}
              </button>
            </li>
          ))}
          <li className="mt-3 border-t border-home-bg/30 pt-3">
            <button
              onClick={() => setSelected("skip")}
              className={
                "w-full rounded-lg px-4 py-3 text-left font-semibold transition-colors " +
                (selected === "skip"
                  ? "border-2 border-gold bg-gold text-home-bg"
                  : "border border-home-bg/40 bg-outreach-outline text-cream hover:opacity-90")
              }
            >
              Abstain
            </button>
          </li>
        </ul>

        <button
          onClick={submit}
          disabled={!selected || submitting}
          className="mt-6 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit vote"}
        </button>

        <p className="mt-3 text-center text-xs text-home-bg/65">
          Votes are anonymous. {votedCount}/{voters.length} voted.
        </p>
      </div>

      {chatBlock}
    </main>
  );
}
