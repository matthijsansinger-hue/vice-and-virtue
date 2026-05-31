"use client";

import { useEffect, useRef, useState } from "react";
import {
  setVote,
  endGroupAction,
  GROUP_ACTION_SECONDS,
} from "@/lib/game";
import { ConsultationChat } from "./ConsultationChat";
import type { Player, Room } from "@/lib/types";

// Pre-consultation group decision. All active players vote on one of
// three options:
//   - Revealing Eye   → reveals camp counts in the consultation banner
//   - Free a prisoner → triggers a second vote on WHICH prisoner
//   - Skip            → no action
// Day 1 (no prisoners): the "Free" option is hidden.
// Tie / no votes: defaults to Skip (handled in endGroupAction).
export function GroupAction({
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
    : GROUP_ACTION_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  const isHost = myPlayer?.is_host ?? false;
  const voters = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );
  const votedCount = voters.filter((p) => p.vote).length;
  const allVoted = voters.length > 0 && voters.every((p) => p.vote);
  const anyImprisoned = players.some((p) => p.in_prison && !p.dead);

  // Per-game caps. Each action has 2 uses total per game; once a
  // counter hits 0 the corresponding option is hidden so it can't be
  // voted for.
  const eyeAvailable = (room.eye_uses_left ?? 0) > 0;
  const freeAvailable = (room.free_uses_left ?? 0) > 0 && anyImprisoned;

  // Auto-skip non-voters when the timer expires (matches consultation).
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

  // The host advances once everyone has voted, or right after the
  // timer expires (allowing auto-skip writes to land).
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const graceOver = endsAt !== null && now > endsAt + 1500;
    if (allVoted || graceOver) {
      advancedRef.current = true;
      endGroupAction(room.id, players);
    }
  }, [isHost, allVoted, endsAt, now, room.id, players]);

  async function submit() {
    if (!myPlayer || !selected) return;
    setSubmitting(true);
    try {
      await setVote(myPlayer.id, selected);
    } finally {
      setSubmitting(false);
    }
  }

  // The shared chat sits below every variant — keeps the consultation
  // thread flowing across the group-action interlude.
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
            Day {room.day} &mdash; group action
          </h1>
          <p className="mt-2 text-2xl font-semibold">{label}</p>
          <p className="mt-2 text-home-bg/70">You cannot vote this round.</p>
          <p className="mt-6 text-sm text-home-bg/60">
            {votedCount}/{voters.length} voted
          </p>
        </div>
        {chatBlock}
      </main>
    );
  }

  // Active voter who already voted: waiting screen.
  if (myPlayer?.vote) {
    return (
      <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 py-12 text-home-bg">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-sm uppercase tracking-widest text-home-bg/70">
            Day {room.day} &mdash; group action
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

  // Active voter who hasn't voted yet: the choice UI.
  return (
    <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 py-12 text-home-bg">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-home-bg/70">
          Day {room.day} &mdash; group action
        </h1>
        <p className="mt-1 text-center text-2xl font-semibold tabular-nums">
          {remainingSec}
          <span className="text-base text-home-bg/60">s</span>
        </p>
        <p className="mt-2 text-center text-sm text-home-bg/75">
          Choose one. Majority decides.
        </p>

        {/* Per-game uses remaining — players see what's still on the
            table this game before they vote. */}
        <div className="mt-4 flex justify-center gap-4 text-[10px] uppercase tracking-widest text-home-bg/65">
          <span>
            Eye:{" "}
            <span className="font-semibold text-home-bg">
              {room.eye_uses_left ?? 0}
            </span>{" "}
            left
          </span>
          <span>
            Free:{" "}
            <span className="font-semibold text-home-bg">
              {room.free_uses_left ?? 0}
            </span>{" "}
            left
          </span>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {eyeAvailable && (
            <ActionOption
              label="Revealing Eye"
              sub={`Show how many Vices and Virtues are still in the game. ${room.eye_uses_left} use(s) left this game.`}
              selected={selected === "eye"}
              onClick={() => setSelected("eye")}
            />
          )}
          {freeAvailable && (
            <ActionOption
              label="Free a prisoner"
              sub={`Pick which prisoner to free in a follow-up vote. ${room.free_uses_left} use(s) left this game.`}
              selected={selected === "free"}
              onClick={() => setSelected("free")}
            />
          )}
          <ActionOption
            label="Skip"
            sub="Do nothing and go straight to the imprisonment vote."
            selected={selected === "skip"}
            onClick={() => setSelected("skip")}
          />
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

function ActionOption({
  label,
  sub,
  selected,
  onClick,
}: {
  label: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={
          "block w-full rounded-lg px-4 py-3 text-left transition-colors " +
          (selected
            ? "border-2 border-gold bg-gold text-home-bg"
            : "border-2 border-home-bg/60 bg-cream/70 text-home-bg hover:bg-cream")
        }
      >
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-home-bg/70">{sub}</span>
      </button>
    </li>
  );
}
