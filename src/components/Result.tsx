"use client";

import { useEffect } from "react";
import Link from "next/link";
import { motion, MotionConfig, type Variants } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  ParchmentCard,
  SoulCost,
  SoulEnergyText,
} from "@/components/ui/royal";
import { rankPlayers } from "@/lib/scoring";
import { setReady, startOutreach } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { awardAchievement } from "@/lib/achievements";
import { displayedName } from "@/lib/swaps";
import { DiligenceResult } from "./abilities/DiligenceResult";
import type { Room, Player } from "@/lib/types";

// Turns 1, 2, 3... into "1st", "2nd", "3rd"...
function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

// Gold / silver / bronze medal discs for the top three ranks; everyone
// else gets a plain numeral.
const MEDAL_STYLES: Record<number, { bg: string; ring: string; text: string }> = {
  1: { bg: "linear-gradient(160deg,#ffe9a3,#e3b510 55%,#9a7407)", ring: "#e3b510", text: "#4e3624" },
  2: { bg: "linear-gradient(160deg,#f3f3f3,#bfc4cc 55%,#7d838d)", ring: "#c0c5cd", text: "#2f3338" },
  3: { bg: "linear-gradient(160deg,#f0b984,#cd7f32 55%,#8a4f1b)", ring: "#cd7f32", text: "#3a2210" },
};

function RankBadge({ rank }: { rank: number }) {
  const medal = MEDAL_STYLES[rank];
  if (!medal) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-sm font-semibold text-home-bg/60">
        {rank}
      </span>
    );
  }
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{
        background: medal.bg,
        color: medal.text,
        boxShadow: `0 0 0 2px ${medal.ring}55, 0 0 8px ${medal.ring}66`,
      }}
    >
      {rank}
    </span>
  );
}

// Stagger for scoreboard rows — quick top-to-bottom cascade.
const boardContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } },
};

// The scoreboard shown after the minigame.
export function Result({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  // Majority press Continue → 10s countdown → host advances to outreach.
  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => startOutreach(room.id),
  });
  const iAmActive =
    !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;

  const ranked = rankPlayers(players);
  const mine = ranked.find((r) => r.player.id === myPlayer?.id) ?? null;

  // The player named in the shared "common clue" (most-read this round).
  const clueTargetId = room.minigame_clue?.target_id ?? null;
  const clueTarget = clueTargetId
    ? players.find((p) => p.id === clueTargetId) ?? null
    : null;

  // "Sharpest Eye" badge: finished first in the minigame.
  useEffect(() => {
    if (mine?.rank === 1 && myPlayer?.user_id) {
      void awardAchievement("minigame_first");
    }
  }, [mine?.rank, myPlayer?.user_id]);
  const deadCount = players.filter((p) => p.dead).length;
  const imprisonedCount = players.filter(
    (p) => p.in_prison && !p.dead
  ).length;
  const hospitalCount = players.filter(
    (p) => p.in_hospital && !p.dead && !p.in_prison
  ).length;

  // Outreach is a mandatory phase — always go there next.
  const nextPhaseLabel = "outreach";

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-6 pb-12 pt-16 text-cream">
      <motion.div
        className="w-full max-w-4xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.h1
          variants={fadeUp}
          className={`text-center text-base uppercase tracking-[0.3em] text-gold ${heading}`}
        >
          Day {room.day} &mdash; results
        </motion.h1>

        <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
          {/* Summary column: shared clue + your result. */}
          <motion.div variants={fadeUp} className="flex flex-col gap-4">
        {/* Shared clue: the player the most others read correctly this round.
            A common talking point for the upcoming imprisonment vote. The
            camp itself is NOT revealed — discuss to work it out. */}
        {clueTarget && room.minigame_clue?.target_id ? (
          <ParchmentCard kicker="Common clue" center>
            <p className={`mt-1 text-xl font-semibold ${heading}`}>
              {displayedName(clueTarget, room, players, myPlayer?.id)}
            </p>
            <p className="mt-1 text-sm text-home-bg/70">
              {room.minigame_clue.correct} of {room.minigame_clue.total} players
              read this player&rsquo;s alignment correctly this round &mdash;
              talk it out before the vote.
            </p>
          </ParchmentCard>
        ) : (
          <ParchmentCard kicker="Common clue" center>
            <p className="mt-1 text-sm text-home-bg/70">
              No clear read this round &mdash; nobody was confidently
              identified.
            </p>
          </ParchmentCard>
        )}

        {mine && (
          <ParchmentCard kicker="You finished" center>
            <p
              className={`mt-1 text-4xl font-bold ${heading}`}
              style={
                MEDAL_STYLES[mine.rank]
                  ? { color: "#9a7407", textShadow: "0 0 14px rgba(227,181,16,.45)" }
                  : undefined
              }
            >
              {ordinal(mine.rank)}
            </p>
            <p className="mt-3 text-sm text-home-bg/60"><SoulEnergyText onLight>Soul Energy earned</SoulEnergyText></p>
            <p className="text-2xl font-semibold">
              <SoulCost value={mine.soulEnergy} label="" onLight />
              <span className="ml-2 text-base font-normal text-home-bg/60">
                (total {mine.player.soul_energy})
              </span>
            </p>
          </ParchmentCard>
        )}

        {/* Players who sat the round out (prison / hospital / dead) get
            an explainer instead of a personal scoreboard card, so they
            understand why they have no rank. They still see the full
            scoreboard below. */}
        {!mine && myPlayer && (
          <ParchmentCard
            kicker={
              myPlayer.dead
                ? "You're dead"
                : myPlayer.in_prison
                  ? "You're in prison"
                  : myPlayer.in_hospital
                    ? "You're in hospital"
                    : "You didn't play this round"
            }
            center
          >
            <p className="mt-1 text-sm text-home-bg/70">
              You sat this minigame out, so you didn&rsquo;t earn Soul
              Energy. The scoreboard below shows everyone who did.
            </p>
          </ParchmentCard>
        )}

        {/* Diligence: pay to count this round's correct reads (only if you
            actually played the minigame this round). */}
        {myPlayer?.role === "diligence" && mine && (
          <DiligenceResult myPlayer={myPlayer} />
        )}

          </motion.div>

          {/* Scoreboard column. */}
          <motion.div variants={fadeUp}>
            <h2 className={`text-sm uppercase tracking-widest text-gold ${heading}`}>
              Scoreboard
            </h2>
            <motion.ul variants={boardContainer} className="mt-2 flex flex-col gap-2">
          {ranked.map(({ player, rank, soulEnergy }) => {
            const isMe = player.id === myPlayer?.id;
            return (
              <motion.li
                key={player.id}
                variants={fadeUp}
                className={
                  "flex items-center justify-between rounded-xl px-4 py-3 text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.3)] " +
                  (isMe
                    ? "border-2 border-gold shadow-[0_3px_10px_rgba(0,0,0,.3),0_0_12px_rgba(227,181,16,.4)]"
                    : "border border-gold/40")
                }
                style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <RankBadge rank={rank} />
                  <span className="min-w-0 truncate">
                    {displayedName(player, room, players, myPlayer?.id)}
                    {isMe && (
                      <span className="ml-2 text-xs text-home-bg/50">
                        (you)
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">
                  <SoulCost value={soulEnergy} label="" onLight />
                  <span className="ml-1 text-xs font-normal text-home-bg/60">
                    ({player.soul_energy})
                  </span>
                </span>
              </motion.li>
            );
          })}
        </motion.ul>

            {(imprisonedCount > 0 || deadCount > 0 || hospitalCount > 0) && (
              <p className="mt-3 text-center text-xs text-cream/60">
                {[
                  deadCount > 0 && `${deadCount} dead`,
                  imprisonedCount > 0 && `${imprisonedCount} in prison`,
                  hospitalCount > 0 && `${hospitalCount} in hospital`,
                ]
                  .filter(Boolean)
                  .join(", ")}{" "}
                (not scoring this round).
              </p>
            )}
          </motion.div>
        </div>

        {/* Continue + back link, centered under both layouts. */}
        <motion.div
          variants={fadeUp}
          className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-2"
        >
          {iAmActive ? (
            myPlayer?.ready ? (
              <p className="rounded-full border border-gold/30 bg-black/25 px-4 py-2 text-center text-sm text-cream/70">
                You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
                {total})
              </p>
            ) : (
              <motion.button
                onClick={() => myPlayer && setReady(myPlayer.id, true)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
              >
                Continue to {nextPhaseLabel} ({readyCount}/{total})
              </motion.button>
            )
          ) : (
            <p className="text-center text-sm text-cream/60">
              Waiting for the others to continue&hellip;
            </p>
          )}
          {remainingSec !== null && (
            <p className={`text-center text-xs font-semibold text-gold ${heading}`}>
              Most are ready &mdash; continuing in {remainingSec}s
            </p>
          )}

          <div className="mt-4 text-center">
            <Link href="/" className="text-xs text-cream/40 underline">
              Back to start
            </Link>
          </div>
        </motion.div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}
