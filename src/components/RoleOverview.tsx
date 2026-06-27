"use client";

import { useState } from "react";
import { motion, MotionConfig, AnimatePresence } from "framer-motion";
import { heading, staggerContainer, fadeUp, CornerFrame, SoulEnergyText } from "@/components/ui/royal";
import { setReady, endRoleOverview } from "@/lib/game";
import { useMajorityAdvance } from "@/lib/useMajorityAdvance";
import { ROLES, type RoleDef } from "@/lib/roles";
import { RoleIcon } from "./RoleIcon";
import { Walkthrough } from "./Walkthrough";
import type { Player, Room } from "@/lib/types";

const TIER_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

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
    .sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9));
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

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
          <RoleIcon roleId={role.id} camp={role.camp} tint={!isNeutral} className="h-16 w-16" />
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
                Tier {role.tier}
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
    <motion.section
      variants={fadeUp}
      className="relative overflow-hidden rounded-xl border-2 p-3"
      style={{
        borderColor: vice ? "#9b2741" : "#3a49b8",
        background: vice
          ? "linear-gradient(165deg, rgba(128,0,32,.35) 0%, rgba(22,6,10,.85) 70%)"
          : "linear-gradient(165deg, rgba(0,0,128,.3) 0%, rgba(6,8,26,.85) 70%)",
        boxShadow: vice
          ? "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(128,0,32,.35)"
          : "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(0,0,128,.4)",
      }}
    >
      <CornerFrame colorClass={vice ? "border-[#e6889a]/45" : "border-[#9a9ce0]/45"} />
      <h2
        className={`relative text-center text-sm font-semibold uppercase tracking-widest ${heading}`}
        style={{
          color: vice ? "#e6889a" : "#9a9ce0",
          textShadow: vice
            ? "0 0 12px rgba(230,136,154,.4)"
            : "0 0 12px rgba(154,156,224,.4)",
        }}
      >
        {title}
      </h2>
      {/* The cast cascades in row by row. */}
      <motion.ul variants={staggerContainer} className="relative mt-2 flex flex-col gap-1.5">
        {roles.map((r) => (
          <motion.li variants={fadeUp} key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r)}
              className="flex w-full items-center gap-2.5 rounded-lg bg-black/25 px-2.5 py-2 text-left transition-colors hover:bg-black/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <RoleIcon roleId={r.id} camp={r.camp} tint className="h-9 w-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-sm font-semibold">{r.name}</span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gold/80">
                    Tier {r.tier}
                  </span>
                </div>
                <p className="text-[11px] italic text-cream/45">Tap to see what they do</p>
              </div>
              <span aria-hidden className="shrink-0 pr-0.5 text-lg leading-none text-gold/40">
                ›
              </span>
            </button>
          </motion.li>
        ))}
        {roles.length === 0 && (
          <li className="py-2 text-center text-xs italic text-cream/50">
            No roles on this side.
          </li>
        )}
      </motion.ul>
    </motion.section>
  );
}
