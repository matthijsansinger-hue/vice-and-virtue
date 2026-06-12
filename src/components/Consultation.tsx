"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";
import {
  heading,
  PhaseTimer,
  StatePanel,
  CornerFrame,
  ParchmentCard,
} from "@/components/ui/royal";
import {
  setVote,
  setReady,
  resolveConsultation,
  startRevoteServer,
  myVoters,
  CONSULTATION_SECONDS,
} from "@/lib/game";
import { supabase } from "@/lib/supabase";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { Centered } from "./Centered";
import { TruthfulnessAction } from "./abilities/TruthfulnessAction";
import { SacrificeAction } from "./abilities/SacrificeAction";
import { ConsultationChat } from "./ConsultationChat";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import { displayedName } from "@/lib/swaps";
import { playPrisonDoor } from "@/lib/sound";
import type { Room, Player } from "@/lib/types";

// The aggregate vote outcome, computed by the server (consultation_tally)
// so individual votes never reach the browser.
type TallyResult = {
  kind: "imprisoned" | "tie" | "skip_majority" | "no_votes";
  imprisoned_id: string | null;
  tied_ids: string[];
};

type EventNoticeData = { emblem: string; title: string; text: string };

// A centered "Proceed" notice with an emblem image — used for the
// Revealing Eye, a freed prisoner, and an imprisonment. Rendered as a
// floating overlay on top of the current consultation screen.
function EventNotice({
  emblem,
  title,
  text,
  onProceed,
}: EventNoticeData & { onProceed: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.88, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 22 }}
        className="relative w-full max-w-xs overflow-hidden rounded-2xl border-2 border-gold bg-home-bg p-6 text-center text-cream shadow-2xl"
      >
        <CornerFrame accent />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={emblem}
          alt=""
          className="relative mx-auto h-44 w-44 object-contain drop-shadow-xl"
        />
        <h2 className={`relative mt-3 text-xl font-semibold text-gold ${heading}`}>{title}</h2>
        <p className="relative mt-2 text-sm text-cream/85">{text}</p>
        <button
          onClick={onProceed}
          className={`relative mt-5 w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
        >
          Proceed
        </button>
      </motion.div>
    </motion.div>
  );
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
  const [resetSeen, setResetSeen] = useState(false);
  const autoSkippedRef = useRef(false);
  // How many pre-vote notices (Eye/freed) have been dismissed, and
  // whether the imprisonment notice has been acknowledged.
  const [preAck, setPreAck] = useState(0);
  // Guards the prison-door sound so it plays once per imprisonment.
  const doorPlayedRef = useRef<string | null>(null);
  // The server-computed tally (fetched once everyone has voted).
  const [tally, setTally] = useState<TallyResult | null>(null);
  // Voter ids for the imprisoned player, once Truthfulness has revealed.
  const [revealedVoterIds, setRevealedVoterIds] = useState<string[]>([]);
  // Active camp counts for the Eye banner (only once the Eye has fired).
  const [campCounts, setCampCounts] = useState<{
    vices: number;
    virtues: number;
  } | null>(null);
  // Vote-reveal potion: whether I armed it, and the ids currently voting for me.
  const [voteRevealArmed, setVoteRevealArmed] = useState(false);
  const [myVoterIds, setMyVoterIds] = useState<string[]>([]);

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

  const votedCount = voters.filter((p) => p.has_voted).length;
  const rawAllVoted = voters.length > 0 && voters.every((p) => p.has_voted);

  // Reset-seen guard: this phase is entered after votes are cleared,
  // but realtime can deliver the new phase to clients before the
  // vote=null writes land. Without this guard we'd show the result
  // screen instantly off stale group-action votes. We only trust
  // "everyone voted" once we've seen votes reset to null at least
  // once.
  useEffect(() => {
    if (voters.length > 0 && voters.every((p) => !p.has_voted)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps
  const allVoted = resetSeen && rawAllVoted;

  // Result-continue (majority-based): once the vote is tallied — and it's not
  // a first-round tie, which still needs the host to call a re-vote — a
  // majority pressing Continue starts a 10s countdown, then the host resolves
  // to the next day. Everyone (incl. dead/imprisoned) can continue from here.
  const continueEnabled =
    allVoted && !!tally && !(tally.kind === "tie" && !isRevote);
  const {
    remainingSec: continueSec,
    readyCount: continueReady,
    total: continueTotal,
  } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => resolveConsultation(room.id),
    enabled: continueEnabled,
    // Only the living (alive, free, non-hospitalized) drive the day-advance —
    // there's no timer fallback here, so AFK dead spectators must not be able
    // to hold the majority hostage. The safety guard guarantees ≥2 active.
    // (Dead/imprisoned still see the Continue button; it just doesn't count.)
  });

  // Once everyone has voted, fetch the aggregate tally from the server.
  // Cleared whenever voting reopens (e.g. a re-vote).
  useEffect(() => {
    if (!allVoted) {
      setTally(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("consultation_tally", { p_room_id: room.id })
      .then(({ data }) => {
        if (!cancelled && data) setTally(data as TallyResult);
      });
    return () => {
      cancelled = true;
    };
  }, [allVoted, room.id]);

  // The Eye banner's camp counts come from the server, and only once the
  // Eye has fired (else the RPC returns nothing) — camp sizes stay secret.
  useEffect(() => {
    if (!room.eye_revealed) {
      setCampCounts(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("count_active_camps", { p_room_id: room.id })
      .then(({ data }) => {
        if (!cancelled && data) {
          setCampCounts(data as { vices: number; virtues: number });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [room.eye_revealed, room.id, players]);

  // Vote-reveal potion: learn once whether I armed it this consultation.
  useEffect(() => {
    if (!myPlayer) return;
    let cancelled = false;
    supabase.rpc("my_potions", { p_player_id: myPlayer.id }).then(({ data }) => {
      if (!cancelled && data) {
        setVoteRevealArmed(!!(data as { vote_reveal?: boolean }).vote_reveal);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vote-reveal potion: while armed and the vote is still open, poll who is
  // voting to imprison me (votes are otherwise anonymous to everyone).
  useEffect(() => {
    if (!voteRevealArmed || !myPlayer || allVoted) return;
    const pid = myPlayer.id;
    let cancelled = false;
    async function poll() {
      const ids = await myVoters(pid);
      if (!cancelled) setMyVoterIds(ids);
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [voteRevealArmed, myPlayer?.id, allVoted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Truthfulness reveal: fetch the imprisoned player's voters from the
  // server (votes themselves never reach the browser).
  useEffect(() => {
    if (!room.vote_reveal) {
      setRevealedVoterIds([]);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("get_revealed_voters", { p_room_id: room.id })
      .then(({ data }) => {
        if (!cancelled && Array.isArray(data)) {
          setRevealedVoterIds(data as string[]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [room.vote_reveal, room.id]);

  // When the result resolves to an imprisonment, slam the prison doors —
  // once per imprisoned player (so a re-vote on a different player can
  // play again).
  useEffect(() => {
    if (tally?.kind === "imprisoned" && tally.imprisoned_id) {
      if (doorPlayedRef.current !== tally.imprisoned_id) {
        doorPlayedRef.current = tally.imprisoned_id;
        playPrisonDoor();
      }
    }
  }, [tally]);

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

  // The group chat is rendered on every consultation sub-screen.
  // Dead / imprisoned / hospitalized players see a read-only composer
  // (handled inside the component).
  const chatBlock = (
    <div className="mt-6 w-full max-w-sm">
      <ConsultationChat room={room} players={players} myPlayer={myPlayer} />
    </div>
  );

  // Shared "common clue" carried over from this day's minigame — the player
  // the most others read correctly — surfaced during the vote so the group
  // has a talking point. Camp isn't revealed; discuss to work it out.
  const clueTargetId = room.minigame_clue?.target_id ?? null;
  const clueTarget = clueTargetId
    ? players.find((p) => p.id === clueTargetId) ?? null
    : null;
  const clueBanner =
    clueTarget && room.minigame_clue?.target_id ? (
      <div
        className="mt-4 rounded-xl border-2 border-gold/70 px-4 py-2 text-center text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.15)]"
        style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
      >
        <span className={`text-[10px] uppercase tracking-widest text-home-bg/60 ${heading}`}>
          Common clue
        </span>
        <p className="mt-0.5 text-sm">
          <span className="font-semibold">
            {displayedName(clueTarget, room, players, myPlayer?.id)}
          </span>{" "}
          was read correctly by {room.minigame_clue.correct} of{" "}
          {room.minigame_clue.total} players.
        </p>
      </div>
    ) : null;

  // Vote-reveal potion: a private panel (only the buyer sees it) listing who
  // is currently voting to imprison them. Shown on the voting + waiting
  // screens — a burgundy warning plaque with the urgent pulse.
  const voteRevealBlock = voteRevealArmed ? (
    <div
      className="urgent-pulse mt-4 rounded-xl border-2 border-[#b3445c]/70 px-4 py-2.5 text-left text-cream"
      style={{
        background: "linear-gradient(165deg, rgba(128,0,32,.55) 0%, rgba(24,6,10,.94) 70%)",
      }}
    >
      <span className={`text-[10px] uppercase tracking-widest text-[#e6889a] ${heading}`}>
        Vote reveal &mdash; voting to imprison you
      </span>
      {myVoterIds.length === 0 ? (
        <p className="mt-0.5 text-sm italic text-cream/65">
          No one is voting for you yet.
        </p>
      ) : (
        <p className="mt-0.5 text-sm font-medium">
          {myVoterIds
            .map((id) => {
              const v = players.find((p) => p.id === id);
              return v ? displayedName(v, room, players, myPlayer?.id) : null;
            })
            .filter(Boolean)
            .join(", ")}
        </p>
      )}
    </div>
  ) : null;

  // Dead-only chat — rendered only when myPlayer.dead. Sits alongside
  // the public chat on the dead-passive screen.
  const deadChatBlock = myPlayer?.dead ? (
    <div className="mt-4 w-full max-w-sm">
      <DeadChat room={room} players={players} myPlayer={myPlayer} />
    </div>
  ) : null;

  // Banners for the pre-vote group actions. The Revealing Eye (Vices)
  // and a freeing (Virtues) can both happen in the same round, so each
  // shows independently. Everyone sees both. Cleared next day.
  const freed = room.group_action_freed_id
    ? players.find((p) => p.id === room.group_action_freed_id) ?? null
    : null;

  // The group-action events are shown as centered "Proceed" pop-ups that
  // OVERLAY the current screen (the vote screen, or the result screen),
  // rendered via the {groupActionBanner} slot each screen already has.
  // Pre-vote notices (Eye, then freeing) queue one after another; the
  // imprisonment notice shows on the result screen.
  const preNotices: EventNoticeData[] = [];
  if (room.eye_revealed) {
    preNotices.push({
      emblem: "/eye-emblem.png",
      title: "The Revealing Eye opens",
      text: campCounts
        ? `${campCounts.vices} Vices and ${campCounts.virtues} Virtues remain active.`
        : "Revealing the active camps…",
    });
  }
  if (freed) {
    preNotices.push({
      emblem: "/freed-emblem.png",
      title: "Freed from prison",
      text: `${displayedName(freed, room, players, myPlayer?.id)} walks free.`,
    });
  }

  // The Eye / freed pop-ups overlay the vote screen via the
  // {groupActionBanner} slot. Imprisonment is NOT a pop-up — it's shown
  // (with its emblem) on the result screen itself, below.
  const groupActionBanner =
    preAck < preNotices.length ? (
      <EventNotice
        emblem={preNotices[preAck].emblem}
        title={preNotices[preAck].title}
        text={preNotices[preAck].text}
        onProceed={() => setPreAck((x) => x + 1)}
      />
    ) : null;

  // Safety guard: not enough active players to keep playing.
  if (active.length <= 1) {
    return (
      <Centered className="consultation-council-bg text-home-bg">
        <p className="text-2xl font-semibold">Game over</p>
        <p className="mt-2 max-w-sm text-home-bg/75">
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

  async function triggerRevote(tiedIds: string[]) {
    setAdvancing(true);
    try {
      await startRevoteServer(room.id, tiedIds);
    } catch {
      setAdvancing(false);
    }
  }

  // ----- While voting is still in progress -----

  if (!allVoted) {
    // Dead: passive, can't vote — but can read the chat AND talk to
    // the other dead in their private chat.
    if (myPlayer?.dead) {
      return (
        <MotionConfig reducedMotion="user">
        <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 pb-12 pt-16 text-home-bg">
          {groupActionBanner}
          <StatePanel accentRgb="153,27,27" bg="rgba(47,33,18,.92)">
            <p className={`text-2xl font-bold text-red-200 ${heading}`}>You&rsquo;re dead</p>
            <p className="mt-2 text-cream/70">You cannot vote.</p>
            <p className="mt-4 text-sm text-cream/55">
              {votedCount}/{voters.length} voted
            </p>
          </StatePanel>
          {chatBlock}
          {deadChatBlock}
        </main>
        </MotionConfig>
      );
    }

    // In hospital: passive, can't vote — but can read the chat.
    if (myPlayer?.in_hospital) {
      return (
        <MotionConfig reducedMotion="user">
        <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 pb-12 pt-16 text-home-bg">
          {groupActionBanner}
          <StatePanel accentRgb="148,163,184" bg="rgba(47,33,18,.92)">
            <p className={`text-2xl font-bold text-slate-300 ${heading}`}>You&rsquo;re in hospital</p>
            <p className="mt-2 text-cream/70">You cannot vote this round.</p>
            <p className="mt-4 text-sm text-cream/55">
              {votedCount}/{voters.length} voted
            </p>
          </StatePanel>
          {chatBlock}
        </main>
        </MotionConfig>
      );
    }

    // Imprisoned: passive, can't vote — but can read the chat.
    if (myPlayer?.in_prison) {
      return (
        <MotionConfig reducedMotion="user">
        <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 pb-12 pt-16 text-home-bg">
          {groupActionBanner}
          <StatePanel accentRgb="148,163,184" bg="rgba(47,33,18,.92)">
            <p className={`text-2xl font-bold text-slate-300 ${heading}`}>You&rsquo;re in prison</p>
            <p className="mt-2 text-cream/70">You cannot vote this round.</p>
            <p className="mt-4 text-sm text-cream/55">
              {votedCount}/{voters.length} voted
            </p>
          </StatePanel>
          {chatBlock}
        </main>
        </MotionConfig>
      );
    }

    // Active player who hasn't voted yet: the voting UI.
    if (myPlayer && !myPlayer.vote) {
      return (
        <MotionConfig reducedMotion="user">
        <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 pb-12 pt-16 text-home-bg">
          {groupActionBanner}
          <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
            {/* Vote panel (left on desktop, centered on mobile). */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-sm lg:mx-0"
            >
            <PhaseTip
              id="consultation"
              text="Discuss as a group, then vote to send someone to prison (or skip). The most-voted player is jailed and out of the game."
            />
            <h1 className={`text-center text-xs uppercase tracking-[0.3em] text-home-bg/70 ${heading}`}>
              Day {room.day} &mdash; {isRevote ? "re-vote" : "consultation"}
            </h1>
            <PhaseTimer seconds={remainingSec} onLight className="mt-1" />
            <p className="mt-2 text-center text-sm text-home-bg/75">
              Vote to send a player to prison
            </p>

            {clueBanner}
            {voteRevealBlock}

            <ul className="mt-6 flex flex-col gap-2">
              {votableTargets.map((p) => (
                <li key={p.id}>
                  <VoteOption
                    label={displayedName(p, room, players, myPlayer?.id)}
                    selected={selected === p.id}
                    onClick={() => setSelected(p.id)}
                  />
                </li>
              ))}
              <li className="mt-3 border-t border-home-bg/20 pt-3">
                <button
                  onClick={() => setSelected("skip")}
                  className={
                    "w-full rounded-lg px-4 py-3 text-left font-semibold shadow-[0_2px_8px_rgba(0,0,0,.2)] transition-[background-color,color,border-color,box-shadow] duration-150 " +
                    (selected === "skip"
                      ? "border-2 border-gold bg-gold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.5)]"
                      : "border-2 border-outreach-outline/60 bg-outreach-outline text-cream hover:border-outreach-outline")
                  }
                >
                  Skip vote
                </button>
              </li>
            </ul>

            <motion.button
              onClick={submitVote}
              disabled={!selected || submitting}
              whileHover={!selected || submitting ? undefined : { scale: 1.02 }}
              whileTap={!selected || submitting ? undefined : { scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className={`mt-6 w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 ${heading}`}
            >
              {submitting ? "Submitting…" : "Submit vote"}
            </motion.button>

            <p className="mt-3 text-center text-xs text-home-bg/60">
              Votes are anonymous. {votedCount}/{voters.length} voted.
            </p>
              {sacrificeBlock}
            </motion.div>

            {/* Group chat (right on desktop, below on mobile). */}
            <ConsultationChat room={room} players={players} myPlayer={myPlayer} />
          </div>
        </main>
        </MotionConfig>
      );
    }

    // Active player who already voted: just waiting (chat continues).
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 pb-12 pt-16 text-home-bg">
        {groupActionBanner}
        <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
          <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center lg:mx-0">
            <StatePanel accentRgb="227,181,16" bg="rgba(47,33,18,.92)" pulse>
              <p className={`text-xl font-bold text-gold ${heading}`}>You voted.</p>
              <p className="mt-2 text-cream/70">
                Waiting for the other players&hellip;
              </p>
              <p className="mt-4 text-sm text-cream/55">
                {votedCount}/{voters.length} voted
              </p>
            </StatePanel>
            <div className="w-full text-left">
              {clueBanner}
              {voteRevealBlock}
              {sacrificeBlock}
            </div>
          </div>
          <ConsultationChat room={room} players={players} myPlayer={myPlayer} />
        </div>
      </main>
      </MotionConfig>
    );
  }

  // ----- All voted: tally + result + (host) advance -----
  // EVERYONE falls through here, including dead/imprisoned players, so
  // a dead-or-imprisoned host can still click "Continue".

  // The tally is fetched from the server once everyone voted; show a brief
  // loading state until it arrives.
  if (!tally) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 pb-12 pt-16 text-center text-home-bg">
        {groupActionBanner}
        <p className={`animate-pulse text-lg font-semibold ${heading}`}>
          Tallying the vote&hellip;
        </p>
        {chatBlock}
      </main>
      </MotionConfig>
    );
  }

  const imprisoned =
    tally.kind === "imprisoned" && tally.imprisoned_id
      ? players.find((p) => p.id === tally.imprisoned_id) ?? null
      : null;
  // First-round tie -> host can trigger a re-vote between the tied
  // candidates. In a re-vote round, no further re-votes; "still tied"
  // just means nobody imprisoned.
  const canTriggerRevote = tally.kind === "tie" && !isRevote;
  const tiedIds = tally.tied_ids;
  const isTruthfulness = myPlayer?.role === "truthfulness";
  const canRevealVotes =
    isTruthfulness &&
    !!myPlayer &&
    !myPlayer.dead &&
    !myPlayer.in_prison &&
    !myPlayer.in_hospital &&
    !!imprisoned &&
    !room.vote_reveal;

  return (
    <MotionConfig reducedMotion="user">
    <main className="flex min-h-screen flex-col items-center consultation-council-bg px-6 pb-12 pt-16 text-center text-home-bg">
      {groupActionBanner}
      <div className="w-full max-w-sm">
        <h1 className={`text-xs uppercase tracking-[0.3em] text-home-bg/70 ${heading}`}>
          Day {room.day} &mdash; result
        </h1>

        {imprisoned ? (
          // The verdict lands with weight: the emblem + name spring in,
          // synced with the prison-door slam.
          <motion.div
            initial={{ opacity: 0, scale: 0.82, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 20, delay: 0.1 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/imprisoned-emblem.png"
              alt=""
              className="mx-auto mt-4 h-40 w-40 object-contain drop-shadow-xl"
            />
            <p className={`mt-3 text-2xl font-bold ${heading}`}>
              {displayedName(imprisoned, room, players, myPlayer?.id)} has been
              imprisoned.
            </p>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className={`mt-4 text-2xl font-bold ${heading}`}>
              No one was imprisoned.
            </p>
            <p className="mt-2 text-sm text-home-bg/75">
              {tally.kind === "skip_majority"
                ? "The group chose to skip the vote."
                : tally.kind === "tie"
                  ? "The vote was tied."
                  : "No votes were cast."}
            </p>
          </motion.div>
        )}

        {(myPlayer?.dead || myPlayer?.in_prison || myPlayer?.in_hospital) && (
          <p className="mt-4 text-xs text-home-bg/50 italic">
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
          <div className="mt-6 w-full text-left">
            <ParchmentCard
              kicker={`Truthfulness — voters for ${displayedName(imprisoned, room, players, myPlayer?.id)}`}
            >
              <ul className="mt-3 flex flex-col gap-1">
                {revealedVoterIds.map((id) => {
                  const v = players.find((p) => p.id === id);
                  return v ? (
                    <li
                      key={id}
                      className="rounded bg-home-bg/5 px-3 py-2 font-medium"
                    >
                      {displayedName(v, room, players, myPlayer?.id)}
                    </li>
                  ) : null;
                })}
                {revealedVoterIds.length === 0 && (
                  <li className="text-sm text-home-bg/60 italic">
                    No one voted for {displayedName(imprisoned, room, players, myPlayer?.id)}.
                  </li>
                )}
              </ul>
            </ParchmentCard>
          </div>
        )}

        {canTriggerRevote ? (
          // First-round tie: the host decides whether to call a re-vote.
          isHost ? (
            <motion.button
              onClick={() => triggerRevote(tiedIds)}
              disabled={advancing}
              whileHover={advancing ? undefined : { scale: 1.02 }}
              whileTap={advancing ? undefined : { scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className={`mt-8 w-full rounded-xl bg-gold px-8 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 ${heading}`}
            >
              {advancing
                ? "Starting re-vote…"
                : `Re-vote between the ${tiedIds.length} tied players`}
            </motion.button>
          ) : (
            <p className="mt-8 text-sm text-home-bg/60">
              The vote was tied &mdash; waiting for the host to decide&hellip;
            </p>
          )
        ) : (
          // Otherwise everyone presses Continue; a majority starts a 10s
          // countdown into the next day.
          <div className="mt-8 flex flex-col items-center gap-2">
            {myPlayer?.ready ? (
              <p className="rounded-full border border-home-bg/25 bg-home-bg/10 px-4 py-2 text-sm text-home-bg/70">
                You&rsquo;re ready &mdash; waiting for the others (
                {continueReady}/{continueTotal})
              </p>
            ) : (
              <motion.button
                onClick={() => myPlayer && setReady(myPlayer.id, true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className={`w-full rounded-xl bg-gold px-8 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
              >
                Continue to day {room.day + 1} ({continueReady}/{continueTotal})
              </motion.button>
            )}
            {continueSec !== null && (
              <p className={`text-xs font-semibold text-home-bg/80 ${heading}`}>
                Most are ready &mdash; continuing in {continueSec}s
              </p>
            )}
          </div>
        )}
      </div>

      {chatBlock}

      {deadChatBlock}

      {sacrificeBlock}
    </main>
    </MotionConfig>
  );
}

// Vote rows use the consultation phase's own green accent (not gold):
// selected = the deep camp-action green with the light-green vote glow.
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
        "w-full rounded-lg px-4 py-3 text-left font-medium shadow-[0_2px_8px_rgba(0,0,0,.2)] transition-[background-color,color,border-color,box-shadow] duration-150 " +
        (selected
          ? "border-2 border-consult-phase-vote bg-consult-phase-bg text-cream shadow-[0_0_14px_rgba(154,245,147,.55)]"
          : "border-2 border-home-bg/50 bg-cream/80 text-home-bg hover:bg-cream")
      }
    >
      {label}
    </button>
  );
}
