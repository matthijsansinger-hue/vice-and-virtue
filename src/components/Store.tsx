"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig, AnimatePresence } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  PhaseTimer,
  StatePanel,
  CornerFrame,
  plaqueStyle,
  PlaqueLayers,
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
import type { Player, Room } from "@/lib/types";

// Dark wooden-sign fill for the passive-screen StatePanel — sits on the
// merchant's wood-desk backdrop.
const SIGN_BG = "rgba(47,33,18,.92)";

// The store sits between outreach and the consultation group action. Each
// active player privately spends Soul Energy on single-use, day-long potions.
//
//   * Camp reveal (200 SE) — instant: reveals one player's camp. Repeatable.
//   * Minigame x2  ( 60 SE) — doubles the Soul Energy you earn next minigame.
//   * Kill        (300 SE) — kills a target in the next reflection (protection
//                            blocks it).
//   * Hospitalise (200 SE) — hospitalises a target next reflection (protection
//                            blocks it).
//   * Protection  (200 SE) — shields YOU next reflection (blocks Murder, Intox,
//                            and incoming potion kills/hospitalise).
// Vote reveal is shown as "Soon" until its batch wires it.

type PotionId =
  | "kill"
  | "hospitalise"
  | "protect"
  | "camp_reveal"
  | "eye"
  | "minigame_mult"
  | "vote_reveal"
  | "iron_will";

type PotionDef = {
  id: PotionId;
  name: string;
  cost: number;
  blurb: string;
  timing: string;
  // false until the effect is wired in a later batch.
  active: boolean;
  // true if buying requires choosing another player.
  needsTarget?: boolean;
  // only sold from this round (day) onwards.
  fromDay?: number;
};

const POTIONS: PotionDef[] = [
  {
    id: "kill",
    name: "Kill potion",
    cost: 300,
    blurb: "Kill a chosen player.",
    timing: "When the shop closes · protection can block it",
    active: true,
    needsTarget: true,
  },
  {
    id: "hospitalise",
    name: "Hospitalise potion",
    cost: 200,
    blurb: "Send a player to hospital for a day.",
    timing: "When the shop closes · protection can block it",
    active: true,
    needsTarget: true,
  },
  {
    id: "protect",
    name: "Protection potion",
    cost: 200,
    blurb: "Shield yourself for a full cycle.",
    timing: "Blocks this shop's kills + next reflection's Murder/Intoxication",
    active: true,
  },
  {
    id: "camp_reveal",
    name: "Camp reveal potion",
    cost: 200,
    blurb: "Reveal one player's camp — Vice or Virtue.",
    timing: "Instant",
    active: true,
    needsTarget: true,
  },
  {
    id: "eye",
    name: "Revealing Eye",
    cost: 150,
    blurb: "See how many Vices and Virtues are still active.",
    timing: "Instant · only you see it",
    active: true,
  },
  {
    id: "minigame_mult",
    name: "Minigame multiplier (x2)",
    cost: 60,
    blurb: "Double the Soul Energy you earn.",
    timing: "Your next minigame",
    active: true,
  },
  {
    id: "vote_reveal",
    name: "Vote reveal potion",
    cost: 100,
    blurb: "See who votes to imprison you.",
    timing: "This consultation",
    active: true,
  },
  {
    id: "iron_will",
    name: "Iron will potion",
    cost: 200,
    blurb: "Your imprisonment vote counts double.",
    timing: "This consultation · from round 2 on",
    active: true,
    fromDay: 2,
  },
];

type Armed = {
  minigame_mult: boolean;
  protect: boolean;
  kill: boolean;
  hospitalise: boolean;
  vote_reveal: boolean;
  iron_will: boolean;
};
const NO_ARMED: Armed = {
  minigame_mult: false,
  protect: false,
  kill: false,
  hospitalise: false,
  vote_reveal: false,
  iron_will: false,
};

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
  const [error, setError] = useState<string | null>(null);
  // Which targetable potion's picker is open (kill / hospitalise / camp_reveal).
  const [picking, setPicking] = useState<PotionId | null>(null);
  // Camps revealed so far this store (camp-reveal is repeatable).
  const [revealed, setRevealed] = useState<{ name: string; camp: string }[]>(
    []
  );
  // Latest Revealing Eye result (active camp counts), shown only to the buyer.
  const [eyeResult, setEyeResult] = useState<{ vices: number; virtues: number } | null>(null);
  // Which prisoner a release contribution is in flight for.
  const [contributing, setContributing] = useState<string | null>(null);
  // The "+50 SE market bonus" toast, shown briefly when the store opens.
  const [showBonus, setShowBonus] = useState(true);

  // Auto-dismiss the +50 toast a few seconds after the store opens.
  useEffect(() => {
    const t = setTimeout(() => setShowBonus(false), 4500);
    return () => clearTimeout(t);
  }, []);

  const isHost = myPlayer?.is_host ?? false;
  const isActive =
    !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;
  const eligible = players.filter(
    (p) => !p.dead && !p.in_prison && !p.in_hospital
  );

  // Ticking clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : STORE_SECONDS;
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
      });
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset-seen guard (same pattern as outreach / group action).
  useEffect(() => {
    if (eligible.length > 0 && eligible.every((p) => !p.ready)) {
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
  const readyCount = eligible.filter((p) => p.ready).length;
  const majority =
    resetSeen && eligible.length > 0 && readyCount * 2 > eligible.length;
  useEffect(() => {
    if (!isHost || !majority) return;
    if (endsAt !== null && endsAt - Date.now() <= (CONTINUE_SECONDS + 0.5) * 1000) {
      return;
    }
    void setContinueDeadline(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, majority, endsAt, room.id]);

  // Everyone done → advance immediately (don't wait out the countdown). Else the
  // host advances to the group action when the (possibly shortened) timer
  // elapses, plus a short grace so stragglers' auto-ready writes land first.
  const allReady =
    resetSeen && eligible.length > 0 && eligible.every((p) => p.ready);
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const timerExpired = endsAt !== null && now >= endsAt + 1500;
    if (allReady || timerExpired) {
      advancedRef.current = true;
      endStore(room.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, now, endsAt, room.id, allReady]);

  async function done() {
    if (!myPlayer || myPlayer.ready) return;
    await setReady(myPlayer.id, true);
  }

  async function buy(potion: PotionDef, targetId?: string) {
    if (!myPlayer || busy) return;
    setBusy(potion.id);
    setError(null);
    try {
      const res = await buyPotion(myPlayer.id, potion.id, targetId);
      if (!res.ok) {
        setError(buyError(res.error));
        return;
      }
      const id = potion.id;
      if (id === "eye" && res.vices != null && res.virtues != null) {
        setEyeResult({ vices: res.vices, virtues: res.virtues });
      } else if (id === "camp_reveal" && res.camp && targetId) {
        const t = players.find((p) => p.id === targetId);
        setRevealed((prev) => [
          ...prev,
          {
            name: t ? displayedName(t, room, players, myPlayer?.id) : "?",
            camp: res.camp as string,
          },
        ]);
      } else if (id !== "camp_reveal" && id !== "eye") {
        // id is one of the Armed keys (kill / hospitalise / protect / mult).
        setArmed((a) => ({ ...a, [id]: true }));
      }
      setPicking(null);
    } finally {
      setBusy(null);
    }
  }

  // Put 100 SE toward freeing a prisoner; the prisoner's pool + freed state come
  // back live via the realtime `players` subscription (migration 092).
  async function contribute(prisonerId: string) {
    if (!myPlayer || contributing) return;
    setContributing(prisonerId);
    setError(null);
    try {
      const res = await contributeRelease(myPlayer.id, prisonerId);
      if (!res.ok) setError(buyError(res.error));
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
  const pickingDef = picking
    ? POTIONS.find((p) => p.id === picking) ?? null
    : null;
  const targets = players.filter(
    (p) => !p.dead && p.id !== myPlayer?.id
  );
  const prisoners = players.filter((p) => p.in_prison && !p.dead);

  return (
    <MotionConfig reducedMotion="user">
    <main className="flex min-h-screen flex-col items-center wood-desk-startscreen px-4 pb-10 pt-16 text-cream">
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

      <motion.div
        className="w-full max-w-3xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp}>{header}</motion.div>

        <PhaseTip
          id="store"
          text="Before the vote, spend your Soul Energy on single-use potions that last one day. Each is bought privately — no one sees what you buy."
        />

        {/* Soul Energy on hand. */}
        <motion.p variants={fadeUp} className="mt-3 text-center text-sm text-cream/80">
          <SoulEnergyText>Your Soul Energy</SoulEnergyText>: <SoulCost value={se} label="" />
        </motion.p>

        {error && (
          <p className="mt-2 text-center text-sm font-medium text-red-300">
            {error}
          </p>
        )}

        {!isActive && (
          <p className="mt-3 rounded-xl border border-gold/40 bg-black/25 px-3 py-2 text-center text-sm font-semibold text-cream/80">
            You&rsquo;re in {myPlayer?.in_hospital ? "hospital" : "prison"} &mdash; you can watch but can&rsquo;t buy this round.
          </p>
        )}

        {/* Potion grid — gilded shop plaques on the courtyard wall. Round-gated
            potions (e.g. Iron Will, from round 2) show greyed-out + locked until
            the round they unlock, so players know they're coming. */}
        <motion.div
          variants={staggerContainer}
          className={
            "mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" +
            (isActive ? "" : " pointer-events-none opacity-60")
          }
        >
          {POTIONS.map((potion) => {
            const isArmed =
              (potion.id === "minigame_mult" && armed.minigame_mult) ||
              (potion.id === "protect" && armed.protect) ||
              (potion.id === "kill" && armed.kill) ||
              (potion.id === "hospitalise" && armed.hospitalise) ||
              (potion.id === "vote_reveal" && armed.vote_reveal) ||
              (potion.id === "iron_will" && armed.iron_will);
            const canAfford = se >= potion.cost;
            const isBusy = busy === potion.id;
            // Not yet available this round (e.g. Iron Will before round 2).
            const lockedRound = !!potion.fromDay && room.day < potion.fromDay;

            return (
              <motion.div
                key={potion.id}
                variants={fadeUp}
                whileHover={lockedRound ? undefined : { y: -4 }}
                transition={{ type: "spring", stiffness: 380, damping: 24 }}
                className={
                  "group relative flex flex-col overflow-hidden rounded-xl border-2 p-4 text-cream " +
                  (isArmed
                    ? "glow-gold-pulse border-gold/70"
                    : potion.active && !lockedRound
                      ? "border-gold/35"
                      : "border-gold/20 opacity-70")
                }
                style={plaqueStyle(isArmed)}
              >
                <PlaqueLayers shine />
                <CornerFrame accent={isArmed} />
                <div className="relative flex items-start justify-between gap-2">
                  <h3 className={`font-semibold leading-tight ${heading}`}>{potion.name}</h3>
                  <span className="shrink-0 rounded-full border border-soul/50 bg-black/30 px-2 py-0.5 text-xs font-semibold">
                    <SoulCost value={potion.cost} />
                  </span>
                </div>
                <p className="relative mt-1 text-sm text-cream/80">
                  <SoulEnergyText>{potion.blurb}</SoulEnergyText>
                </p>
                <p className="relative mt-1 text-[11px] uppercase tracking-wide text-cream/55">
                  {potion.timing}
                </p>

                <div className="relative mt-3 flex-1" />

                {lockedRound ? (
                  <span className="relative mt-1 inline-flex items-center justify-center gap-1 rounded-lg border border-cream/20 px-3 py-2 text-center text-xs font-semibold text-cream/50">
                    <span aria-hidden>🔒</span> Unlocks in round {potion.fromDay}
                  </span>
                ) : !potion.active ? (
                  <span className="relative mt-1 inline-block rounded-lg border border-cream/20 px-3 py-2 text-center text-xs font-semibold text-cream/50">
                    Soon
                  </span>
                ) : isArmed ? (
                  <span className={`relative mt-1 inline-block rounded-lg border-2 border-gold/70 bg-gold/15 px-3 py-2 text-center text-sm font-semibold text-gold ${heading}`}>
                    Bought &mdash; active
                  </span>
                ) : potion.needsTarget ? (
                  <button
                    onClick={() => {
                      setError(null);
                      setPicking((v) => (v === potion.id ? null : potion.id));
                    }}
                    disabled={!canAfford || isBusy}
                    className="relative mt-1 w-full rounded-lg bg-gold py-2 text-sm font-semibold text-home-bg shadow-[0_0_10px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_16px_rgba(227,181,16,.5)] disabled:opacity-40"
                  >
                    {picking === potion.id ? (
                      "Choose below…"
                    ) : (
                      <>Buy (<SoulCost value={potion.cost} onLight />)</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => buy(potion)}
                    disabled={!canAfford || isBusy}
                    className="relative mt-1 w-full rounded-lg bg-gold py-2 text-sm font-semibold text-home-bg shadow-[0_0_10px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_16px_rgba(227,181,16,.5)] disabled:opacity-40"
                  >
                    {isBusy ? "Buying…" : <>Buy (<SoulCost value={potion.cost} onLight />)</>}
                  </button>
                )}
              </motion.div>
            );
          })}
        </motion.div>

        {/* Target picker for kill / hospitalise / camp-reveal. */}
        {pickingDef && (
          <div className="mt-4">
            <ParchmentCard kicker={pickerTitle(pickingDef.id)}>
              <p className="mt-1 text-xs text-home-bg/60">
                Costs <SoulCost value={pickingDef.cost} onLight />
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {targets.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => buy(pickingDef, p.id)}
                      disabled={busy === pickingDef.id || se < pickingDef.cost}
                      className="w-full rounded-lg border border-gold bg-cream px-3 py-2 text-left text-sm font-medium shadow-[0_2px_8px_rgba(0,0,0,.2)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,.25)] disabled:opacity-40 disabled:hover:translate-y-0"
                    >
                      {displayedName(p, room, players, myPlayer?.id)}
                      {p.in_prison && (
                        <span className="ml-1 text-xs text-home-bg/50">
                          (prison)
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setPicking(null)}
                className="mt-3 text-xs font-semibold text-home-bg/70 underline"
              >
                Cancel
              </button>
            </ParchmentCard>
          </div>
        )}

        {/* Revealed camps so far. */}
        {revealed.length > 0 && (
          <div className="mt-4">
            <ParchmentCard kicker="Camps revealed">
              <ul className="mt-2 flex flex-col gap-1">
                {revealed.map((r, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-semibold">{r.name}</span> is a{" "}
                    <span
                      className={
                        "font-semibold " +
                        (r.camp === "vice"
                          ? "text-consultation-bg"
                          : "text-consultation-fg")
                      }
                    >
                      {r.camp === "vice" ? "Vice" : "Virtue"}
                    </span>
                  </li>
                ))}
              </ul>
            </ParchmentCard>
          </div>
        )}

        {/* Revealing Eye result — only the buyer ever sees this. */}
        {eyeResult && (
          <div className="mt-4">
            <ParchmentCard kicker="Revealing Eye">
              <p className="mt-2 text-sm text-home-bg">
                <span className="font-semibold text-consultation-bg">
                  {eyeResult.vices} {eyeResult.vices === 1 ? "Vice" : "Vices"}
                </span>{" "}
                and{" "}
                <span className="font-semibold text-consultation-fg">
                  {eyeResult.virtues} {eyeResult.virtues === 1 ? "Virtue" : "Virtues"}
                </span>{" "}
                are still active.
              </p>
            </ParchmentCard>
          </div>
        )}

        {/* Free someone from prison — a communal 500-SE pool per prisoner. */}
        {prisoners.length > 0 && (
          <div className="mt-4">
            <ParchmentCard kicker="Free someone from prison">
              <p className="mt-1 text-xs text-home-bg/60">
                Put in 100 at a time — it&rsquo;s communal, so everyone&rsquo;s
                contributions add up. At 500 they walk free, and progress carries
                over between markets.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {prisoners.map((p) => {
                  const pool = Math.max(0, Math.min(500, p.release_pool ?? 0));
                  const left = Math.max(0, 500 - pool);
                  return (
                    <li
                      key={p.id}
                      className="rounded-lg border border-gold/40 bg-cream px-3 py-2 shadow-[0_2px_8px_rgba(0,0,0,.15)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-home-bg">
                          {displayedName(p, room, players, myPlayer?.id)}
                        </span>
                        <span className="text-xs font-semibold text-home-bg/70">
                          {left} SE left
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-home-bg/15">
                        <div
                          className="h-full rounded-full bg-gold"
                          style={{ width: `${(pool / 500) * 100}%` }}
                        />
                      </div>
                      <button
                        onClick={() => contribute(p.id)}
                        disabled={!isActive || se < 100 || contributing === p.id}
                        className="mt-2 w-full rounded-lg border border-gold bg-home-bg/5 px-3 py-1.5 text-sm font-medium text-home-bg transition hover:bg-home-bg/10 disabled:opacity-40"
                      >
                        {contributing === p.id ? (
                          "Contributing…"
                        ) : (
                          <>
                            Contribute <SoulCost value={100} onLight />
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
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
            <SacrificeAction
              myPlayer={myPlayer}
              players={players}
              room={room}
              mode="queued"
            />
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

function pickerTitle(id: PotionId): string {
  switch (id) {
    case "kill":
      return "Who do you want to kill?";
    case "hospitalise":
      return "Who do you want to hospitalise?";
    case "camp_reveal":
      return "Whose camp do you want revealed?";
    default:
      return "Choose a target";
  }
}

function buyError(code: string | undefined): string {
  switch (code) {
    case "insufficient_se":
      return "Not enough Soul Energy.";
    case "already_bought":
      return "You already have that potion.";
    case "bad_target":
      return "Pick a valid player.";
    case "inactive":
      return "You can't shop this round.";
    case "not_store":
      return "The store is closed.";
    case "not_round_2":
      return "That potion isn't sold until round 2.";
    case "not_prisoner":
      return "That player isn't in prison anymore.";
    default:
      return "Couldn't buy that. Try again.";
  }
}
