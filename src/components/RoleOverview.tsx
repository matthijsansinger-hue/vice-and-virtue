"use client";

import { useState } from "react";
import { motion, MotionConfig, AnimatePresence } from "framer-motion";
import { heading, staggerContainer, fadeUp, CornerFrame, SoulEnergyText } from "@/components/ui/royal";
import { setReady, endRoleOverview } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { ROLES, type RoleDef, ROLE_CLASSES, CLASS_PAIRS } from "@/lib/roles";
import { RoleIcon } from "./RoleIcon";
import { CampBanner } from "./CampBanner";
import { Walkthrough } from "./Walkthrough";
import type { Player, Room } from "@/lib/types";

// Classes in canonical order, for sorting rosters. Fillers/anomalies sort last.
const CLASS_RANK: Record<string, number> = Object.fromEntries(
  CLASS_PAIRS.flatMap(([v, t], i) => [
    [v, i],
    [t, i],
  ])
);

// The role_overview phase: after role selection resolves (or, later, after a
// random deal), everyone sees the full cast of THIS game — every role in play,
// sorted Vice | Virtue — before the lore intro. Majority-continue advances.
export function RoleOverview({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const pool = (room.role_pool ?? [])
    .map((id) => ROLES[id])
    .filter((r): r is RoleDef => !!r)
    .sort(
      (a, b) =>
        (a.roleClass ? CLASS_RANK[a.roleClass] : 9) -
        (b.roleClass ? CLASS_RANK[b.roleClass] : 9)
    );
  const vices = pool.filter((r) => r.camp === "vice");
  const virtues = pool.filter((r) => r.camp === "virtue");
  const soul = pool.find((r) => r.camp === "neutral"); // the Wandering Soul, if present

  const { remainingSec, readyCount, total } = useMajorityAdvance({
    room,
    players,
    myPlayer,
    advance: () => endRoleOverview(room.id),
  });

  // Tapping any role in the cast opens its full information card.
  const [openRole, setOpenRole] = useState<RoleDef | null>(null);

  // The day-cycle walkthrough — a quick refresher on how a day works before the
  // first one — is shown to everyone here (matching the game overview).

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-4 pb-12 pt-10 text-cream">
      <motion.div
        className="w-full max-w-3xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <motion.div variants={fadeUp} className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-cream/60">
            The cast is set
          </p>
          <h1 className={`mt-1 text-3xl font-bold tracking-wide text-gold ${heading}`}>
            The roles in this game
          </h1>
          <p className="mt-1 text-sm text-cream/70">
            These — and only these — walk the castle. Tap a role to study it.
          </p>
        </motion.div>

        <motion.div variants={fadeUp} className="mt-6">
          <Walkthrough endNote="The cast for this game is below ↓" />
        </motion.div>

        {/* The two camp banners, side by side on every screen. */}
        <div className="mx-auto mt-6 grid max-w-[40rem] grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:gap-5">
          <CampColumn title="Vices" camp="vice" roles={vices} onSelect={setOpenRole} />
          <CampColumn title="Virtues" camp="virtue" roles={virtues} onSelect={setOpenRole} />
        </div>

        {/* The neutral anomaly, when present (odd player counts). */}
        {soul && (
          <motion.div variants={fadeUp} className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setOpenRole(soul)}
              className="flex items-center gap-3 rounded-xl border-2 border-soul/50 bg-[#0d1c20]/80 px-4 py-2.5 text-left transition-colors hover:bg-[#0d1c20] focus:outline-none focus-visible:ring-2 focus-visible:ring-soul/60"
              style={{ boxShadow: "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(125,224,240,.3)" }}
            >
              <RoleIcon roleId={soul.id} camp="neutral" className="h-10 w-10 shrink-0" />
              <div className="min-w-0">
                <p className={`text-[11px] font-semibold uppercase tracking-widest text-soul ${heading}`}>
                  Anomaly
                </p>
                <p className="text-sm font-semibold text-cream">{soul.name}</p>
              </div>
            </button>
          </motion.div>
        )}

        {/* Majority-continue. */}
        <motion.div
          variants={fadeUp}
          className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-2"
        >
          {myPlayer?.ready ? (
            <p className="rounded-full border border-gold/30 bg-black/25 px-4 py-2 text-sm text-cream/70">
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
              Continue ({readyCount}/{total})
            </motion.button>
          )}
          {remainingSec !== null && (
            <p className={`text-xs font-semibold text-gold ${heading}`}>
              Most are ready &mdash; continuing in {remainingSec}s
            </p>
          )}
        </motion.div>
      </motion.div>

      {/* Tapped-role information card. */}
      <AnimatePresence>
        {openRole && (
          <RoleInfoModal role={openRole} onClose={() => setOpenRole(null)} />
        )}
      </AnimatePresence>
    </main>
    </MotionConfig>
  );
}

// Full role-information card, opened by tapping a role in the cast. Mirrors
// the parchment role-detail modal from the TopBar (camp badge, tier, ability
// description) but for any role on the board, not just your own.
function RoleInfoModal({
  role,
  onClose,
}: {
  role: RoleDef;
  onClose: () => void;
}) {
  const isVice = role.camp === "vice";
  const isNeutral = role.camp === "neutral";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border-2 border-gold p-6 text-home-bg shadow-2xl"
        style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
      >
        <CornerFrame colorClass="border-home-bg/25" />
        <div className="relative flex flex-col items-center">
          <RoleIcon roleId={role.id} camp={role.camp} className="h-16 w-16" />
          <h1 className={`mt-2 text-center text-3xl font-bold ${heading}`}>
            {role.name}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={
                `rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wide ${heading} ` +
                (isNeutral
                  ? "bg-soul text-[#06363f] shadow-[0_0_10px_rgba(125,224,240,.5)]"
                  : isVice
                    ? "bg-consultation-bg text-cream shadow-[0_0_10px_rgba(128,0,32,.5)]"
                    : "bg-consultation-fg text-cream shadow-[0_0_10px_rgba(0,0,128,.5)]")
              }
            >
              {isNeutral ? "Anomaly" : isVice ? "Vice" : "Virtue"}
            </span>
            {!isNeutral && (
              <span className={`rounded-lg border border-home-bg/25 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-home-bg/70 ${heading}`}>
                {role.roleClass ? ROLE_CLASSES[role.roleClass].label : "Filler"}
              </span>
            )}
            <span className={`rounded-lg border border-home-bg/25 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-home-bg/70 ${heading}`}>
              <SoulEnergyText onLight>{role.cost}</SoulEnergyText>
            </span>
          </div>
        </div>

        <p className="relative mt-4 text-center text-sm leading-relaxed">
          <SoulEnergyText onLight>{role.description}</SoulEnergyText>
        </p>

        <button
          onClick={onClose}
          className={`relative mt-6 w-full rounded-xl bg-gold py-2 font-semibold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.3)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_22px_rgba(227,181,16,.5)] ${heading}`}
        >
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}

function CampColumn({
  title,
  camp,
  roles,
  onSelect,
}: {
  title: string;
  camp: "vice" | "virtue";
  roles: RoleDef[];
  onSelect: (r: RoleDef) => void;
}) {
  const vice = camp === "vice";
  return (
    <motion.section variants={fadeUp} className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
      <CampBanner camp={camp}>
        <h2
          className={`text-center text-sm font-semibold uppercase tracking-widest sm:text-base ${heading}`}
          style={{ color: vice ? "#ffd9b8" : "#d8e7f2" }}
        >
          {title}
        </h2>
        {/* The cast cascades in row by row. */}
        <motion.ul variants={staggerContainer} className="mt-2 flex flex-col gap-1.5">
          {roles.map((r) => (
            <motion.li variants={fadeUp} key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                className="flex w-full items-center gap-2 rounded-lg bg-black/45 px-1.5 py-1.5 text-left transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 sm:gap-2.5 sm:px-2.5 sm:py-2"
              >
                <RoleIcon roleId={r.id} camp={r.camp} className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold sm:text-sm">{r.name}</span>
                  <span className="block truncate text-[9px] font-semibold uppercase tracking-wide text-gold sm:text-[10px]">
                    {r.roleClass ? ROLE_CLASSES[r.roleClass].label : "Filler"}
                  </span>
                </div>
                <span aria-hidden className="hidden shrink-0 pr-0.5 text-lg leading-none text-gold/60 sm:block">
                  ›
                </span>
              </button>
            </motion.li>
          ))}
          {roles.length === 0 && (
            <li className="py-2 text-center text-xs italic text-cream/80">
              No roles on this side.
            </li>
          )}
        </motion.ul>
      </CampBanner>
    </motion.section>
  );
}
