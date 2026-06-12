"use client";

import { useEffect, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import {
  heading,
  PhaseTimer,
  StatePanel,
  CornerFrame,
} from "@/components/ui/royal";
import { setVote, resolveGroupAction, GROUP_ACTION_SECONDS } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import { ROLES } from "@/lib/roles";
import { displayedName } from "@/lib/swaps";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import type { Player, Room } from "@/lib/types";

// Dark wooden-sign fill for StatePanel on this light courtyard stage.
const SIGN_BG = "rgba(47,33,18,.92)";

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
    <h1 className={`text-center text-xs uppercase tracking-[0.3em] text-outreach-outline/80 ${heading}`}>
      Day {room.day} &mdash; group action
    </h1>
  );
  const timer = <PhaseTimer seconds={remainingSec} onLight className="mt-1" />;
  // A plain JSX-returning helper — NOT a component. Defining a component
  // inside render would give it a new type each tick and remount the dead
  // chat (wiping the input) on every timer update.
  //
  // NOTE: no public/camp chat here on purpose — the team ability is a secret,
  // simultaneous camp decision. A chat would let players discuss camp-only
  // abilities ("open the Eye", "free X") and so leak their camp. Dead players
  // still get their dead-only side channel (it can't reveal a living camp).
  const shell = (children: React.ReactNode) => (
    <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-6 pb-12 pt-16 text-outreach-outline">
        <div className="w-full max-w-sm">{children}</div>
        {myPlayer?.dead && (
          <div className="mt-4 w-full max-w-sm">
            <DeadChat room={room} players={players} myPlayer={myPlayer} />
          </div>
        )}
      </main>
    </MotionConfig>
  );

  // Passive screen for dead / prison / hospital.
  if (myBallot === "passive" && myPlayer) {
    const label = myPlayer.dead
      ? "You're dead"
      : myPlayer.in_hospital
        ? "You're in hospital"
        : "You're in prison";
    return shell(
      <div className="flex flex-col items-center text-center">
        {header}
        <div className="mt-4 flex w-full justify-center">
          <StatePanel
            accentRgb={myPlayer.dead ? "153,27,27" : "148,163,184"}
            bg={SIGN_BG}
          >
            <p className={`text-2xl font-bold ${heading} ${myPlayer.dead ? "text-red-200" : "text-slate-300"}`}>
              {label}
            </p>
            <p className="mt-2 text-cream/70">You take no part in this round.</p>
          </StatePanel>
        </div>
      </div>
    );
  }

  // Active, but my camp has nothing to decide (ability spent, or no
  // prisoners to free). Just wait.
  if (myBallot === "none") {
    return shell(
      <div className="flex flex-col items-center text-center">
        {header}
        {timer}
        <div className="mt-4 flex w-full justify-center">
          <StatePanel accentRgb="115,83,51" bg={SIGN_BG}>
            <p className={`text-xl font-bold text-cream ${heading}`}>Nothing to decide</p>
            <p className="mt-2 text-cream/70">
              Your camp has no action this round. Waiting for the others&hellip;
            </p>
          </StatePanel>
        </div>
      </div>
    );
  }

  // Already voted: waiting screen.
  if (myPlayer?.vote) {
    return shell(
      <div className="flex flex-col items-center text-center">
        {header}
        {timer}
        <div className="mt-4 flex w-full justify-center">
          <StatePanel accentRgb="227,181,16" bg={SIGN_BG} pulse>
            <p className={`text-xl font-bold text-gold ${heading}`}>You voted.</p>
            <p className="mt-2 text-cream/70">Waiting for the others&hellip;</p>
          </StatePanel>
        </div>
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
        <div className="mt-4">
          <BallotPlaque vice>
            <p className={`text-center text-[11px] uppercase tracking-widest text-[#e6889a] ${heading}`}>
              Vices only &middot; majority decides &middot; once per game
            </p>
            <p className={`mt-3 text-center text-lg font-semibold text-cream ${heading}`}>
              Use the Revealing Eye?
            </p>
            <p className="mt-1 text-center text-xs text-cream/70">
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
          </BallotPlaque>
        </div>
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
      <div className="mt-4">
        <BallotPlaque>
          <p className={`text-center text-[11px] uppercase tracking-widest text-[#9a9ce0] ${heading}`}>
            Virtues only &middot; most votes wins &middot; once per game
          </p>
          <p className={`mt-3 text-center text-lg font-semibold text-cream ${heading}`}>
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
            <li className="mt-2 border-t border-cream/20 pt-2">
              <button
                onClick={() => setSelected("no_free")}
                className={
                  "w-full rounded-lg px-4 py-3 text-left font-semibold shadow-[0_2px_8px_rgba(0,0,0,.25)] transition-[background-color,color,border-color,box-shadow] duration-150 " +
                  (selected === "no_free"
                    ? "border-2 border-gold bg-gold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.5)]"
                    : "border-2 border-cream/30 bg-black/30 text-cream hover:border-cream/50")
                }
              >
                Don&rsquo;t free anyone
              </button>
            </li>
          </ul>
          <SubmitButton onClick={submit} disabled={!selected || submitting} />
        </BallotPlaque>
      </div>
    </>
  );
}

// Camp-tinted ballot plaque: hellish burgundy for the Vice Eye, deep navy
// for the Virtue free-a-prisoner.
function BallotPlaque({
  vice,
  children,
}: {
  vice?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border-2 p-5 text-cream"
      style={{
        borderColor: vice ? "#9b2741" : "#3a49b8",
        background: vice
          ? "linear-gradient(165deg, rgba(128,0,32,.45) 0%, rgba(24,6,10,.94) 70%)"
          : "linear-gradient(165deg, rgba(0,0,128,.4) 0%, rgba(6,8,26,.94) 70%)",
        boxShadow: vice
          ? "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(128,0,32,.35)"
          : "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(0,0,128,.4)",
      }}
    >
      <CornerFrame colorClass={vice ? "border-[#e6889a]/45" : "border-[#9a9ce0]/45"} />
      <div className="relative">{children}</div>
    </div>
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
  const base =
    "w-full rounded-lg px-4 py-3 text-left font-medium shadow-[0_2px_8px_rgba(0,0,0,.25)] transition-[background-color,color,border-color,box-shadow] duration-150 ";
  const unselected =
    variant === "muted"
      ? "border-2 border-cream/30 bg-black/30 text-cream hover:border-cream/50"
      : "border-2 border-gold/40 bg-cream text-home-bg hover:border-gold";
  return (
    <li>
      <button
        onClick={onClick}
        className={
          base +
          (selected
            ? "border-2 border-gold bg-gold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.5)]"
            : unselected)
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
      className={`mt-6 w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 ${heading}`}
    >
      Submit vote
    </button>
  );
}
