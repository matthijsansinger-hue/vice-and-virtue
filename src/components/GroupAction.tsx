"use client";

import { useEffect, useRef, useState } from "react";
import { setVote, resolveGroupAction, GROUP_ACTION_SECONDS } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import { ROLES } from "@/lib/roles";
import { displayedName } from "@/lib/swaps";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import type { Player, Room } from "@/lib/types";

// Pre-consultation group action — two camp-restricted abilities decided
// simultaneously, before the imprisonment vote:
//   - Vices vote whether to use the Revealing Eye (once per game).
//   - Virtues majority-vote whether to free a prisoner and which one
//     (once per game).
// A player whose camp has no available action (already used, or no
// prisoners to free) just waits. We deliberately show NO vote counts —
// the number of eligible voters per camp would leak camp sizes.
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
  const [resetSeen, setResetSeen] = useState(false);
  const [ready, setReady] = useState(false);
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
  const isActive = (p: Player) => !p.dead && !p.in_prison && !p.in_hospital;
  const campOf = (p: Player) => (p.role ? ROLES[p.role]?.camp : undefined);

  const anyImprisoned = players.some((p) => p.in_prison && !p.dead);
  const prisoners = players.filter((p) => p.in_prison && !p.dead);
  const eyeAvailable = (room.eye_uses_left ?? 0) > 0;
  const freeAvailable = (room.free_uses_left ?? 0) > 0 && anyImprisoned;

  const activeAll = players.filter(isActive);

  // Only my OWN camp (read from my own role) decides which ballot I see;
  // other players' camps are no longer read in the browser. Whether all
  // eligible voters have voted is answered server-side (group_action_ready).
  const myCamp = myPlayer ? campOf(myPlayer) : undefined;
  const iAmActive = myPlayer ? isActive(myPlayer) : false;
  const iAmEligible =
    iAmActive &&
    ((myCamp === "vice" && eyeAvailable) ||
      (myCamp === "virtue" && freeAvailable));

  // Which ballot (if any) I should see.
  const myBallot: "passive" | "none" | "eye" | "free" = !myPlayer
    ? "none"
    : !iAmActive
      ? "passive"
      : myCamp === "vice" && eyeAvailable
        ? "eye"
        : myCamp === "virtue" && freeAvailable
          ? "free"
          : "none";

  // Auto-skip eligible non-voters when the timer expires: write a
  // camp-appropriate no-op so the tally and "all voted" stay clean.
  useEffect(() => {
    if (
      expired &&
      !autoSkippedRef.current &&
      myPlayer &&
      iAmEligible &&
      !myPlayer.vote
    ) {
      autoSkippedRef.current = true;
      setVote(myPlayer.id, myCamp === "vice" ? "eye_no" : "no_free");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // Reset-seen guard: startGroupAction clears every player's vote before
  // changing the phase, but realtime can deliver the phase change first.
  // Only trust "everyone voted" once we've observed all active players'
  // votes reset to null at least once.
  useEffect(() => {
    if (activeAll.length > 0 && activeAll.every((p) => !p.has_voted)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whether every eligible voter has voted — computed server-side so we
  // don't read other players' camps/votes here. Re-checked on each change.
  useEffect(() => {
    if (!resetSeen) return;
    let cancelled = false;
    supabase
      .rpc("group_action_ready", { p_room_id: room.id })
      .then(({ data }) => {
        if (!cancelled) setReady(!!data);
      });
    return () => {
      cancelled = true;
    };
  }, [resetSeen, players, room.id]);

  // Host advances once everyone eligible has voted (post-reset), or on
  // timer grace.
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const graceOver = endsAt !== null && now > endsAt + 1500;
    if ((resetSeen && ready) || graceOver) {
      advancedRef.current = true;
      resolveGroupAction(room.id);
    }
  }, [isHost, resetSeen, ready, endsAt, now, room.id]);

  async function submit() {
    if (!myPlayer || !selected) return;
    setSubmitting(true);
    try {
      await setVote(myPlayer.id, selected);
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <h1 className="text-center text-sm uppercase tracking-widest text-outreach-outline/70">
      Day {room.day} &mdash; group action
    </h1>
  );
  const timer = (
    <p className="mt-1 text-center text-2xl font-semibold tabular-nums">
      {remainingSec}
      <span className="text-base text-outreach-outline/60">s</span>
    </p>
  );
  // A plain JSX-returning helper — NOT a component. Defining a component
  // inside render would give it a new type each tick and remount the dead
  // chat (wiping the input) on every timer update.
  //
  // NOTE: no public/camp chat here on purpose — the team ability is a secret,
  // simultaneous camp decision. A chat would let players discuss camp-only
  // abilities ("open the Eye", "free X") and so leak their camp. Dead players
  // still get their dead-only side channel (it can't reveal a living camp).
  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-6 pb-12 pt-16 text-outreach-outline">
      <div className="w-full max-w-sm">{children}</div>
      {myPlayer?.dead && (
        <div className="mt-4 w-full max-w-sm">
          <DeadChat room={room} players={players} myPlayer={myPlayer} />
        </div>
      )}
    </main>
  );

  // Passive screen for dead / prison / hospital.
  if (myBallot === "passive" && myPlayer) {
    const label = myPlayer.dead
      ? "You're dead"
      : myPlayer.in_hospital
        ? "You're in hospital"
        : "You're in prison";
    return shell(
      <div className="text-center">
        {header}
        <p className="mt-2 text-2xl font-semibold">{label}</p>
        <p className="mt-2 text-outreach-outline/70">You take no part in this round.</p>
      </div>
    );
  }

  // Active, but my camp has nothing to decide (ability spent, or no
  // prisoners to free). Just wait.
  if (myBallot === "none") {
    return shell(
      <div className="text-center">
        {header}
        {timer}
        <p className="mt-4 text-xl font-semibold">Nothing to decide</p>
        <p className="mt-2 text-outreach-outline/75">
          Your camp has no action this round. Waiting for the others&hellip;
        </p>
      </div>
    );
  }

  // Already voted: waiting screen.
  if (myPlayer?.vote) {
    return shell(
      <div className="text-center">
        {header}
        {timer}
        <p className="mt-4 text-xl font-semibold">You voted.</p>
        <p className="mt-2 text-outreach-outline/75">Waiting for the others&hellip;</p>
      </div>
    );
  }

  // Vice ballot: use the Revealing Eye?
  if (myBallot === "eye") {
    return shell(
      <>
        <PhaseTip
          id="group_action"
          text="Just before the imprisonment vote, your camp gets one power, once per game — Vices open the Revealing Eye, Virtues free a prisoner. Make your choice and submit."
        />
        {header}
        {timer}
        <p className="mt-2 text-center text-sm text-outreach-outline/75">
          Vices only. Majority decides. Once per game.
        </p>
        <p className="mt-4 text-center text-base font-semibold">
          Use the Revealing Eye?
        </p>
        <p className="mt-1 text-center text-xs text-outreach-outline/70">
          It reveals how many Vices and Virtues are still active — to
          everyone.
        </p>
        <ul className="mt-5 flex flex-col gap-2">
          <ChoiceButton
            label="Yes — open the Eye"
            selected={selected === "eye_yes"}
            onClick={() => setSelected("eye_yes")}
          />
          <ChoiceButton
            label="No"
            variant="muted"
            selected={selected === "eye_no"}
            onClick={() => setSelected("eye_no")}
          />
        </ul>
        <SubmitButton onClick={submit} disabled={!selected || submitting} />
      </>
    );
  }

  // Virtue ballot: free a prisoner?
  return shell(
    <>
      <PhaseTip
        id="group_action"
        text="Just before the imprisonment vote, your camp gets one power, once per game — Vices open the Revealing Eye, Virtues free a prisoner. Make your choice and submit."
      />
      {header}
      {timer}
      <p className="mt-2 text-center text-sm text-outreach-outline/75">
        Virtues only. Most votes wins. Once per game.
      </p>
      <p className="mt-4 text-center text-base font-semibold">
        Free a prisoner?
      </p>
      <ul className="mt-5 flex flex-col gap-2">
        {prisoners.map((p) => (
          <ChoiceButton
            key={p.id}
            label={displayedName(p, room, players, myPlayer?.id)}
            selected={selected === p.id}
            onClick={() => setSelected(p.id)}
          />
        ))}
        <li className="mt-2 border-t border-outreach-outline/30 pt-2">
          <button
            onClick={() => setSelected("no_free")}
            className={
              "w-full rounded-lg px-4 py-3 text-left font-semibold transition-colors " +
              (selected === "no_free"
                ? "border-2 border-gold bg-gold text-home-bg"
                : "border border-outreach-outline/40 bg-outreach-outline text-cream hover:opacity-90")
            }
          >
            Don&rsquo;t free anyone
          </button>
        </li>
      </ul>
      <SubmitButton onClick={submit} disabled={!selected || submitting} />
    </>
  );
}

function ChoiceButton({
  label,
  variant = "action",
  selected,
  onClick,
}: {
  label: string;
  variant?: "action" | "muted";
  selected: boolean;
  onClick: () => void;
}) {
  const base = "w-full rounded-lg px-4 py-3 text-left font-medium transition-colors ";
  const unselected =
    variant === "muted"
      ? "border-2 border-outreach-outline/80 bg-outreach-outline text-cream hover:opacity-90"
      : "border-2 border-outreach-outline/60 bg-cream/70 text-home-bg hover:bg-cream";
  return (
    <li>
      <button
        onClick={onClick}
        className={
          base + (selected ? "border-2 border-gold bg-gold text-home-bg" : unselected)
        }
      >
        {label}
      </button>
    </li>
  );
}

function SubmitButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-6 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      Submit vote
    </button>
  );
}
