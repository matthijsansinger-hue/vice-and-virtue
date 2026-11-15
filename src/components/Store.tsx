"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, MotionConfig, AnimatePresence } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  PhaseTimer,
  StatePanel,
  ParchmentCard,
  SoulCost,
  SoulEnergyText,
} from "@/components/ui/royal";
import { supabase } from "@/lib/supabase";
import { setReady, endStore, buyPotion, contributeRelease, STORE_SECONDS } from "@/lib/game";
import { CONTINUE_SECONDS, setContinueDeadline } from "@/lib/useMajorityAdvance";
import { displayedName } from "@/lib/swaps";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import { SacrificeAction } from "./abilities/SacrificeAction";
import { FanaticismShop } from "./abilities/FanaticismShop";
import { PotionBottle, type PotionId } from "./market/PotionBottle";
import { Bubble, Merchant, PriceTag, ShelfRow, StallFrame } from "./market/PotionStall";
import type { Player, Room } from "@/lib/types";
import { fireHostAdvance } from "@/lib/hostAdvance";
import { pacers } from "@/lib/bots";

// Dark wooden-sign fill for the passive-screen StatePanel — sits on the
// merchant's wood-desk backdrop.
const SIGN_BG = "rgba(47,33,18,.92)";

// Communal prison-release pool (migration 092): 100 SE a go, 500 frees them.
// Kept as constants so the progress bar's notches stay in step with the cost.
const RELEASE_GOAL = 500;
const RELEASE_STEP = 100;

// The Market (`store` phase), between Outreach and the consultation: a potion
// stall. Every potion stands on the shelves with its name, price and a Buy
// button; tapping a bottle has the merchant say what it does. Each active
// player privately spends Soul Energy on single-use, day-long potions. The
// merchant behind the counter also runs the communal prison release: tap him
// to chip in toward freeing someone from the dungeon.

type PotionDef = {
  id: PotionId;
  name: string;
  cost: number;
  blurb: string;
  timing: string;
  // Buying it asks who it's for.
  needsTarget?: boolean;
  // Only sold from this round (day) on.
  fromDay?: number;
  // Instant and repeatable (never "bought").
  repeatable?: boolean;
  // What the merchant says once it's bought (the target's name, if any).
  bought?: (target: string) => string;
};

// Three shelves: harm, information, the rest.
const SHELVES: PotionId[][] = [
  ["kill", "hospitalise", "protect"],
  ["camp_reveal", "eye", "vote_reveal"],
  ["minigame_mult", "comms", "iron_will"],
];

const POTIONS: Record<PotionId, PotionDef> = {
  kill: {
    id: "kill",
    name: "Kill",
    cost: 300,
    blurb: "Kills the player you choose.",
    timing: "Works when the shop closes. Protection can block it.",
    needsTarget: true,
    bought: (t) => `It's done. ${t} gets it when the shop closes, unless something protects them.`,
  },
  hospitalise: {
    id: "hospitalise",
    name: "Hospitalise",
    cost: 200,
    blurb: "Sends the player you choose to hospital for a day.",
    timing: "Works when the shop closes. Protection can block it.",
    needsTarget: true,
    bought: (t) => `${t} goes to hospital when the shop closes, unless something protects them.`,
  },
  protect: {
    id: "protect",
    name: "Protection",
    cost: 200,
    blurb:
      "Shields you from this shop's kills and hospitalising, and from Murder and Intoxication in the next reflection.",
    timing: "Lasts until the next reflection ends.",
    bought: () => "You're protected until the next reflection ends.",
  },
  camp_reveal: {
    id: "camp_reveal",
    name: "Camp reveal",
    cost: 200,
    blurb: "Shows you one player's camp: Vice or Virtue.",
    timing: "Works straight away. Only you see it.",
    needsTarget: true,
    repeatable: true,
  },
  eye: {
    id: "eye",
    name: "Revealing Eye",
    cost: 150,
    blurb: "Shows how many Vices and Virtues are still in play.",
    timing: "Works straight away. Only you see it.",
    repeatable: true,
  },
  vote_reveal: {
    id: "vote_reveal",
    name: "Vote reveal",
    cost: 100,
    blurb: "Shows you who votes to imprison you.",
    timing: "In this consultation.",
    bought: () => "In this consultation you'll see who votes to imprison you.",
  },
  minigame_mult: {
    id: "minigame_mult",
    name: "Quiz ×2",
    cost: 60,
    blurb: "Doubles the Soul Energy you earn in your next Quiz.",
    timing: "Your next Quiz.",
    bought: () => "Your next Quiz pays double.",
  },
  comms: {
    id: "comms",
    name: "Communication",
    cost: 100,
    blurb:
      "Lets you start a chat with every player in Outreach, not just one, and Sociability can't silence you.",
    timing: "Your next Outreach.",
    bought: () => "In your next Outreach you can start a chat with everyone.",
  },
  iron_will: {
    id: "iron_will",
    name: "Iron Will",
    cost: 200,
    blurb: "Your imprisonment vote counts double.",
    timing: "In this consultation. Sold from round 2.",
    fromDay: 2,
    bought: () => "Your vote counts double in this consultation.",
  },
};

type Armed = {
  minigame_mult: boolean;
  protect: boolean;
  kill: boolean;
  hospitalise: boolean;
  vote_reveal: boolean;
  iron_will: boolean;
  comms: boolean;
};
const NO_ARMED: Armed = {
  minigame_mult: false,
  protect: false,
  kill: false,
  hospitalise: false,
  vote_reveal: false,
  iron_will: false,
  comms: false,
};
const isArmedKey = (id: PotionId): id is keyof Armed => id in NO_ARMED;

// What the merchant is saying.
type Talk =
  | { kind: "hello" }
  | { kind: "about"; id: PotionId }
  | { kind: "pick"; id: PotionId }
  | { kind: "prison"; note?: string }
  | { kind: "said"; text: ReactNode; error?: boolean };

export function Store({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const advancedRef = useRef(false);

  const [armed, setArmed] = useState<Armed>(NO_ARMED);
  const [busy, setBusy] = useState<PotionId | null>(null);
  const [talk, setTalkState] = useState<Talk>({ kind: "hello" });
  const bubbleRef = useRef<HTMLDivElement>(null);
  // Camps revealed so far this store (camp-reveal is repeatable).
  const [revealed, setRevealed] = useState<{ name: string; camp: string }[]>([]);
  // Latest Revealing Eye result (active camp counts), shown only to the buyer.
  const [eyeResult, setEyeResult] = useState<{ vices: number; virtues: number } | null>(null);
  // Which prisoner a release contribution is in flight for.
  const [contributing, setContributing] = useState<string | null>(null);
  // How much SE *you* have put into each prisoner's pool. The pool itself is
  // communal and authoritative (it arrives on the players subscription); this
  // just lets the bar call out your own share of it.
  const [myContribution, setMyContribution] = useState<Record<string, number>>({});
  // The "+50 SE market bonus" toast, shown briefly when the store opens.
  const [showBonus, setShowBonus] = useState(true);

  // The merchant says something new; bring his bubble into view if it's off
  // screen (a Buy on the bottom shelf of a phone).
  function say(t: Talk) {
    setTalkState(t);
    requestAnimationFrame(() => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      bubbleRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  }

  // Auto-dismiss the +50 toast a few seconds after the store opens.
  useEffect(() => {
    const t = setTimeout(() => setShowBonus(false), 4500);
    return () => clearTimeout(t);
  }, []);

  const isHost = myPlayer?.is_host ?? false;
  const isActive =
    !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;
  const eligible = players.filter((p) => !p.dead && !p.in_prison && !p.in_hospital);
  // Who sets the pace: the humans (bots act instantly — lib/bots.ts).
  const pace = pacers(eligible);

  // Ticking clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at ? new Date(room.phase_ends_at).getTime() : null;
  const remainingSec = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : STORE_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  // Load my armed potions (so "bought" state survives a refresh mid-store).
  useEffect(() => {
    if (!myPlayer) return;
    let cancelled = false;
    supabase.rpc("my_potions", { p_player_id: myPlayer.id }).then(({ data }) => {
      if (cancelled || !data) return;
      const d = data as Partial<Armed>;
      setArmed({
        minigame_mult: d.minigame_mult ?? false,
        protect: d.protect ?? false,
        kill: d.kill ?? false,
        hospitalise: d.hospitalise ?? false,
        vote_reveal: d.vote_reveal ?? false,
        iron_will: d.iron_will ?? false,
        comms: d.comms ?? false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset-seen guard (same pattern as outreach / group action).
  useEffect(() => {
    if (pace.length > 0 && pace.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-mark ready when the timer runs out.
  useEffect(() => {
    if (expired && isActive && myPlayer && !myPlayer.ready) {
      setReady(myPlayer.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // Majority pressed Done → shorten the timer to a visible 10s countdown.
  const readyCount = pace.filter((p) => p.ready).length;
  const majority = resetSeen && pace.length > 0 && readyCount * 2 > pace.length;
  useEffect(() => {
    if (!isHost || !majority) return;
    if (endsAt !== null && endsAt - Date.now() <= (CONTINUE_SECONDS + 0.5) * 1000) {
      return;
    }
    void setContinueDeadline(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, majority, endsAt, room.id]);

  // Everyone done → advance immediately (don't wait out the countdown). Else the
  // host advances when the (possibly shortened) timer elapses, plus a short
  // grace so stragglers' auto-ready writes land first.
  const allReady = resetSeen && pace.length > 0 && pace.every((p) => p.ready);
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const timerExpired = endsAt !== null && now >= endsAt + 1500;
    if (allReady || timerExpired) {
      fireHostAdvance({
        ref: advancedRef,
        roomId: room.id,
        phase: room.phase,
        day: room.day,
        run: () => endStore(room.id),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, now, endsAt, room.id, allReady]);

  async function done() {
    if (!myPlayer || myPlayer.ready) return;
    await setReady(myPlayer.id, true);
  }

  const nameOf = (p: Player) => displayedName(p, room, players, myPlayer?.id);

  async function buy(potion: PotionDef, targetId?: string) {
    if (!myPlayer || busy) return;
    setBusy(potion.id);
    try {
      const res = await buyPotion(myPlayer.id, potion.id, targetId);
      if (!res.ok) {
        say({ kind: "said", text: buyError(res.error), error: true });
        return;
      }
      const target = targetId ? players.find((p) => p.id === targetId) : undefined;
      const tName = target ? nameOf(target) : "";
      if (potion.id === "eye" && res.vices != null && res.virtues != null) {
        setEyeResult({ vices: res.vices, virtues: res.virtues });
        say({ kind: "said", text: eyeLine(res.vices, res.virtues) });
      } else if (potion.id === "camp_reveal" && res.camp && target) {
        const camp = res.camp as string;
        setRevealed((prev) => [...prev, { name: tName, camp }]);
        say({
          kind: "said",
          text: (
            <>
              <strong>{tName}</strong> is a{" "}
              <strong className={camp === "vice" ? "text-consultation-bg" : "text-consultation-fg"}>
                {camp === "vice" ? "Vice" : "Virtue"}
              </strong>
              .
            </>
          ),
        });
      } else {
        if (isArmedKey(potion.id)) {
          const key = potion.id;
          setArmed((a) => ({ ...a, [key]: true }));
        }
        say({ kind: "said", text: potion.bought?.(tName) ?? `${potion.name} is yours.` });
      }
    } finally {
      setBusy(null);
    }
  }

  // Put 100 SE toward freeing a prisoner; the prisoner's pool + freed state come
  // back live via the realtime `players` subscription (migration 092).
  async function contribute(prisoner: Player) {
    if (!myPlayer || contributing) return;
    setContributing(prisoner.id);
    try {
      const res = await contributeRelease(myPlayer.id, prisoner.id);
      if (!res.ok) {
        say({ kind: "prison", note: buyError(res.error) });
        return;
      }
      setMyContribution((m) => ({ ...m, [prisoner.id]: (m[prisoner.id] ?? 0) + RELEASE_STEP }));
      const pool = res.pool ?? (prisoner.release_pool ?? 0) + RELEASE_STEP;
      say({
        kind: "prison",
        note: res.freed
          ? `${nameOf(prisoner)} walks free.`
          : `Thank you. ${Math.max(0, RELEASE_GOAL - pool)} more and ${nameOf(prisoner)} walks free.`,
      });
    } finally {
      setContributing(null);
    }
  }

  const header = (
    <div className="text-center">
      <p className={`text-xs uppercase tracking-[0.3em] text-gold/80 ${heading}`}>
        Day {room.day} &mdash; market
      </p>
      <PhaseTimer seconds={remainingSec} glow="rgba(227,181,16,.5)" className="mt-1" />
    </div>
  );

  // Passive screen for dead / prison / hospital.
  // Dead get the spectator view (routed before this). Hospital + prison fall
  // through to the normal market as read-only spectators (controls disabled).
  if (myPlayer?.dead) {
    return (
      <MotionConfig reducedMotion="user">
        <main className="flex min-h-screen flex-col items-center wood-desk-startscreen px-6 pb-12 pt-16 text-cream">
          <div className="w-full max-w-sm">
            <div className="text-center">{header}</div>
            <div className="mt-4 flex justify-center">
              <StatePanel accentRgb="153,27,27" bg={SIGN_BG}>
                <p className={`text-2xl font-bold text-red-200 ${heading}`}>You&rsquo;re dead</p>
                <p className="mt-2 text-cream/70">The game continues without you.</p>
              </StatePanel>
            </div>
          </div>
          <div className="mt-6 w-full max-w-sm">
            <DeadChat room={room} players={players} myPlayer={myPlayer} />
          </div>
        </main>
      </MotionConfig>
    );
  }

  const se = myPlayer?.soul_energy ?? 0;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer?.id);
  const prisoners = players.filter((p) => p.in_prison && !p.dead);

  // ----- What the merchant says -----
  function bubbleContent(): ReactNode {
    switch (talk.kind) {
      case "hello":
        return (
          <>
            <p>
              Every bottle lasts one day, and nobody sees what you buy. Tap a bottle and I&rsquo;ll
              tell you what it does.
            </p>
            {prisoners.length > 0 && (
              <p className="mt-1.5">
                Someone in the dungeon? Tap me and I&rsquo;ll tell you what it takes to get them out.
              </p>
            )}
          </>
        );
      case "about": {
        const p = POTIONS[talk.id];
        return (
          <>
            <p className={`font-semibold ${heading}`}>
              {p.name} <span className="ml-1 text-xs"><SoulCost value={p.cost} onLight /></span>
            </p>
            <p className="mt-0.5">
              <SoulEnergyText onLight>{p.blurb}</SoulEnergyText>
            </p>
            <p className="mt-1 text-xs text-[#3a2a18]/70">{p.timing}</p>
          </>
        );
      }
      case "pick": {
        const p = POTIONS[talk.id];
        return (
          <>
            <p className={`font-semibold ${heading}`}>Who is the {p.name.toLowerCase()} for?</p>
            <ul className="mt-2 grid grid-cols-2 gap-1.5">
              {targets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => buy(p, t.id)}
                    disabled={busy === p.id || se < p.cost}
                    className="w-full truncate rounded-lg border border-[#3b2615]/50 bg-white/60 px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold disabled:opacity-40"
                  >
                    {nameOf(t)}
                    {t.in_prison && <span className="ml-1 text-xs opacity-60">(prison)</span>}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setTalkState({ kind: "hello" })}
              className="mt-2 text-xs font-semibold underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              Never mind
            </button>
          </>
        );
      }
      case "prison":
        return (
          <>
            {prisoners.length === 0 ? (
              <p>Nobody&rsquo;s in the dungeon right now.</p>
            ) : (
              <>
                <p>
                  I can get someone out of the dungeon for {RELEASE_GOAL}. Anyone can chip in,{" "}
                  {RELEASE_STEP} at a time, and it carries over to the next market.
                </p>
                {talk.note && <p className="mt-1.5 font-semibold">{talk.note}</p>}
                <ul className="mt-2 flex flex-col gap-2">
                  {prisoners.map((p) => (
                    <PrisonerRow
                      key={p.id}
                      name={p.id === myPlayer?.id ? "You" : nameOf(p)}
                      pool={p.release_pool ?? 0}
                      mine={myContribution[p.id] ?? 0}
                      isMe={p.id === myPlayer?.id}
                      canGive={isActive && se >= RELEASE_STEP && contributing !== p.id}
                      busy={contributing === p.id}
                      onGive={() => contribute(p)}
                    />
                  ))}
                </ul>
              </>
            )}
            <button
              type="button"
              onClick={() => setTalkState({ kind: "hello" })}
              className="mt-2 text-xs font-semibold underline underline-offset-2 opacity-80 hover:opacity-100"
            >
              Back to the potions
            </button>
          </>
        );
      case "said":
        return <p className={talk.error ? "font-semibold text-[#9c1b38]" : ""}>{talk.text}</p>;
    }
  }

  // ----- One bottle on a shelf, and its tag -----
  const slot = (id: PotionId) => {
    const potion = POTIONS[id];
    const isArmed = isArmedKey(id) && armed[id];
    const lockedRound = !!potion.fromDay && room.day < potion.fromDay;
    const canAfford = se >= potion.cost;
    const isBusy = busy === id;
    const picking = talk.kind === "pick" && talk.id === id;

    const bottle = (
      <button
        key={id}
        type="button"
        onClick={() => setTalkState({ kind: "about", id })}
        aria-label={`What does ${potion.name} do?`}
        className={
          "group relative mx-auto flex cursor-pointer justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold " +
          (lockedRound ? "opacity-45 grayscale" : "")
        }
      >
        <span className="block transition-transform duration-200 motion-safe:group-hover:-translate-y-1">
          <PotionBottle id={id} className="h-[4.5rem] w-14 sm:h-24 sm:w-[4.5rem]" />
        </span>
        {isArmed && (
          <span
            aria-hidden
            className="absolute -right-1 top-1 rotate-12 rounded-sm bg-[#efe1c2] px-1 text-[10px] font-bold text-[#2f6b2f] shadow-[0_2px_4px_rgba(0,0,0,.5)]"
          >
            Yours
          </span>
        )}
      </button>
    );

    const button = lockedRound ? (
      <span className="block rounded-md border border-[#3a2a18]/30 py-1 text-[11px] font-semibold opacity-70">
        From round {potion.fromDay}
      </span>
    ) : isArmed ? (
      <span className="block rounded-md border border-[#2f6b2f]/50 bg-[#2f6b2f]/10 py-1 text-xs font-semibold text-[#2f6b2f]">
        Bought ✓
      </span>
    ) : (
      <button
        type="button"
        onClick={() =>
          potion.needsTarget ? say({ kind: "pick", id }) : buy(potion)
        }
        disabled={!isActive || !canAfford || isBusy}
        title={!canAfford ? "Not enough Soul Energy" : undefined}
        aria-label={`Buy ${potion.name} for ${potion.cost} Soul Energy`}
        className={`w-full cursor-pointer rounded-md bg-gold py-1 text-sm font-semibold text-home-bg shadow-[0_1px_0_#8a6a08,0_2px_6px_rgba(0,0,0,.35)] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3a2a18] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100 ${heading}`}
      >
        {isBusy ? "Buying…" : picking ? "Choose…" : "Buy"}
      </button>
    );

    const tag = (
      <PriceTag
        key={id}
        name={potion.name}
        dim={lockedRound}
        price={<SoulCost value={potion.cost} onLight className={canAfford ? "" : "opacity-60"} />}
      >
        {button}
      </PriceTag>
    );
    return { bottle, tag };
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center wood-desk-startscreen px-3 pb-10 pt-16 text-cream sm:px-4">
        {/* Market-entry bonus notification — everyone not in prison gets +50 SE. */}
        <AnimatePresence>
          {showBonus && (
            <motion.div
              initial={{ opacity: 0, y: -24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -24 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="glow-gold-pulse fixed left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-gold bg-home-bg/95 px-5 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,.5)]"
            >
              <span className={`text-lg font-bold text-gold ${heading}`}>+50</span>
              <span className="text-sm text-cream/90">
                <SoulEnergyText>Soul Energy</SoulEnergyText> &mdash; market bonus
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div className="w-full max-w-3xl" initial="hidden" animate="show" variants={staggerContainer}>
          <motion.div variants={fadeUp}>{header}</motion.div>

          <PhaseTip
            id="store"
            text="Before the vote, spend your Soul Energy on single-use potions that last one day. Each is bought privately — no one sees what you buy."
          />

          {!isActive && (
            <p className="mt-3 rounded-xl border border-gold/40 bg-black/25 px-3 py-2 text-center text-sm font-semibold text-cream/80">
              You&rsquo;re in {myPlayer?.in_hospital ? "hospital" : "prison"} &mdash; you can watch but
              can&rsquo;t buy this round.
            </p>
          )}

          {/* The stall. */}
          <motion.div variants={fadeUp} className="mt-4">
            <StallFrame
              top={
                <div className="flex items-start gap-3 pt-6 sm:gap-5">
                  <Merchant
                    onClick={() => say({ kind: "prison" })}
                    prisoners={prisoners.length}
                    active={talk.kind === "prison"}
                  />
                  <Bubble ref={bubbleRef}>{bubbleContent()}</Bubble>
                </div>
              }
              counter={
                <p className="text-sm text-cream">
                  <SoulEnergyText>Your Soul Energy</SoulEnergyText>: <SoulCost value={se} label="" />
                </p>
              }
            >
              {SHELVES.map((row, i) => {
                const slots = row.map(slot);
                return (
                  <ShelfRow
                    key={i}
                    bottles={slots.map((s) => s.bottle)}
                    tags={slots.map((s) => s.tag)}
                  />
                );
              })}
            </StallFrame>
          </motion.div>

          {/* What you found out this market (camp reveals + the Eye). */}
          {(revealed.length > 0 || eyeResult) && (
            <div className="mx-auto mt-4 max-w-md">
              <ParchmentCard kicker="What you found out">
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {revealed.map((r, i) => (
                    <li key={i}>
                      <span className="font-semibold">{r.name}</span> is a{" "}
                      <span
                        className={
                          "font-semibold " +
                          (r.camp === "vice" ? "text-consultation-bg" : "text-consultation-fg")
                        }
                      >
                        {r.camp === "vice" ? "Vice" : "Virtue"}
                      </span>
                      .
                    </li>
                  ))}
                  {eyeResult && <li>{eyeLine(eyeResult.vices, eyeResult.virtues)}</li>}
                </ul>
              </ParchmentCard>
            </div>
          )}

          {/* Fanaticism's shop tools: see who carries your bombs (50) + arm a
              detonation (150) that fires when the shop closes. */}
          {isActive && myPlayer?.role === "fanaticism" && myPlayer && (
            <motion.div variants={fadeUp} className="mx-auto mt-4 w-full max-w-md">
              <FanaticismShop myPlayer={myPlayer} />
            </motion.div>
          )}

          {/* Sacrifice can act in the shop too — resolves when the shop closes. */}
          {isActive && myPlayer?.role === "sacrifice" && myPlayer && (
            <motion.div variants={fadeUp} className="mx-auto mt-4 w-full max-w-md">
              <SacrificeAction myPlayer={myPlayer} players={players} room={room} mode="queued" />
            </motion.div>
          )}

          {/* Done / waiting — active shoppers only (spectators have no advance role). */}
          {isActive && (
            <motion.div variants={fadeUp} className="mx-auto mt-6 max-w-sm">
              {myPlayer?.ready ? (
                <div className="glow-gold-pulse w-full rounded-xl border-2 border-gold/50 bg-black/25 py-3 text-center font-semibold text-cream">
                  Done &mdash; waiting for the others
                  <p className="mt-1 text-xs font-normal text-cream/70">
                    You can keep shopping until the phase ends.
                  </p>
                </div>
              ) : (
                <motion.button
                  onClick={done}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
                >
                  Done
                </motion.button>
              )}
            </motion.div>
          )}
        </motion.div>
      </main>
    </MotionConfig>
  );
}

// One prisoner in the merchant's release list: how far their pool has got
// (communal; it updates live as anyone chips in) and a button to chip in.
function PrisonerRow({
  name,
  pool,
  mine,
  isMe,
  canGive,
  busy,
  onGive,
}: {
  name: string;
  pool: number;
  mine: number;
  isMe: boolean;
  canGive: boolean;
  busy: boolean;
  onGive: () => void;
}) {
  const have = Math.max(0, Math.min(RELEASE_GOAL, pool));
  const left = RELEASE_GOAL - have;
  const pct = (have / RELEASE_GOAL) * 100;
  const notches = Math.round(RELEASE_GOAL / RELEASE_STEP);
  return (
    <li className="rounded-lg border border-[#3b2615]/35 bg-white/50 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="shrink-0 text-xs font-semibold tabular-nums opacity-70">
          {have} / {RELEASE_GOAL}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={RELEASE_GOAL}
        aria-valuenow={have}
        aria-label={`Release progress for ${name}`}
        className="relative mt-1.5 h-2.5 overflow-hidden rounded-full bg-[#3b2615]/15 ring-1 ring-inset ring-[#3b2615]/20"
      >
        <motion.div
          className="h-full rounded-full bg-gold shadow-[0_0_8px_rgba(227,181,16,.65)]"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 170, damping: 26 }}
        />
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {Array.from({ length: notches - 1 }).map((_, i) => (
            <span
              key={i}
              className="absolute top-0 h-full w-px bg-[#3b2615]/25"
              style={{ left: `${((i + 1) / notches) * 100}%` }}
            />
          ))}
        </span>
      </div>
      <p className="mt-1 text-[11px] opacity-70">
        {left === 0 ? "Walking free" : `${left} to go`}
        {mine > 0 ? `. You gave ${mine}.` : ""}
      </p>
      {isMe ? (
        <p className="mt-1 text-xs italic opacity-70">
          You can&rsquo;t buy your own way out. Someone else has to pay it.
        </p>
      ) : (
        <button
          type="button"
          onClick={onGive}
          disabled={!canGive}
          className={`mt-1.5 w-full cursor-pointer rounded-md bg-gold py-1 text-sm font-semibold text-home-bg shadow-[0_1px_0_#8a6a08] transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3a2a18] disabled:cursor-not-allowed disabled:opacity-40 ${heading}`}
        >
          {busy ? "Chipping in…" : `Chip in ${RELEASE_STEP}`}
        </button>
      )}
    </li>
  );
}

function eyeLine(vices: number, virtues: number): string {
  return `${vices} ${vices === 1 ? "Vice" : "Vices"} and ${virtues} ${virtues === 1 ? "Virtue" : "Virtues"} are still in play.`;
}

function buyError(code: string | undefined): string {
  switch (code) {
    case "insufficient_se":
      return "You don't have enough Soul Energy for that.";
    case "already_bought":
      return "You already have that one.";
    case "bad_target":
      return "Pick someone who's still in the game.";
    case "inactive":
      return "You can't shop this round.";
    case "not_store":
      return "The market has closed.";
    case "not_round_2":
      return "I don't sell that until round 2.";
    case "not_prisoner":
      return "They're not in the dungeon any more.";
    default:
      return "That didn't go through. Try again.";
  }
}
