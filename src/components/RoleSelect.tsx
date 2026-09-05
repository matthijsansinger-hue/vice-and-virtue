"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { IconLock } from "@tabler/icons-react";
import { heading, staggerContainer, fadeUp, CornerFrame, PhaseTimer, SoulEnergyText } from "@/components/ui/royal";
import {
  selectRole,
  getTeamSelections,
  rolesSelectReady,
  resolveRoleSelect,
  ROLE_SELECT_SECONDS,
  type TeamSelections,
} from "@/lib/game";
import { ROLES, type RoleDef, ROLE_CLASSES, type RoleClass } from "@/lib/roles";
import {
  DEFAULT_UNLOCKED_ROLES,
  getMyEconomy,
  roleUnlockCost,
  LE_ABBR,
} from "@/lib/economy";
import { PhaseTip } from "./PhaseTip";
import type { Player, Room } from "@/lib/types";

// The role_select phase ('choose' rooms): every player was dealt a camp + a
// class and picks their role within it, 30 seconds on the clock. A click is a
// TENTATIVE pick — camp-mates see it instantly (anonymously, by class) in the
// team panel so the camp can coordinate — and "Lock in" makes it final. On
// expiry the host resolves: stragglers get their tentative pick, else a random
// role of their class. Desktop shows the team panel on the left; mobile at the
// bottom. Roles you haven't UNLOCKED (the 8 new 1000-LP roles; guests own only
// the default 12) show greyed with a lock — the server enforces the same rule.
export function RoleSelect({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [sel, setSel] = useState<TeamSelections>(null);
  const [busy, setBusy] = useState(false);
  // Roles this player owns (default 12 ∪ account unlocks; guests = the 12).
  const [owned, setOwned] = useState<Set<string>>(
    () => new Set(DEFAULT_UNLOCKED_ROLES)
  );
  const advancedRef = useRef(false);
  // The Anomaly's "locked in" confirmation. Its role is auto-assigned, so this
  // is a local confirmation that mirrors the camps' lock-in (and sets up the
  // flow for when multiple anomaly roles are pickable here later).

  const isHost = myPlayer?.is_host ?? false;
  const myId = myPlayer?.id ?? null;

  // Load my unlocked roles (no-op for guests — getMyEconomy returns null).
  useEffect(() => {
    let cancelled = false;
    getMyEconomy()
      .then((e) => {
        if (!cancelled && e) setOwned(new Set(e.unlockedRoles));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    : ROLE_SELECT_SECONDS;

  // Poll my camp's selection state. Selections live in player_secrets (no
  // realtime), so a short poll is the sync channel; the phase change itself
  // arrives via the room realtime/poll and unmounts this screen.
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    async function poll() {
      const s = await getTeamSelections(myId!);
      if (!cancelled && s) setSel(s);
    }
    poll();
    const t = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [myId]);

  // Host: resolve when everyone has locked (poll), or when the timer expires
  // (plus a short grace so last-second locks land).
  useEffect(() => {
    if (!isHost) return;
    let cancelled = false;
    async function check() {
      if (cancelled || advancedRef.current) return;
      const expired = endsAt !== null && Date.now() >= endsAt + 1500;
      const allLocked = await rolesSelectReady(room.id);
      if (cancelled || advancedRef.current) return;
      if (allLocked || expired) {
        advancedRef.current = true;
        resolveRoleSelect(room.id).catch(() => {
          advancedRef.current = false;
        });
      }
    }
    check();
    const t = setInterval(check, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [isHost, endsAt, room.id]);

  async function pick(roleId: string) {
    if (!myId || !sel || sel.locked || busy) return;
    // Optimistic: show my tentative pick immediately.
    setSel({ ...sel, choice: roleId });
    await selectRole(myId, roleId, false);
  }

  async function lockIn() {
    if (!myId || !sel || !sel.choice || sel.locked || busy) return;
    setBusy(true);
    try {
      const ok = await selectRole(myId, sel.choice, true);
      if (ok) setSel({ ...sel, locked: true });
    } finally {
      setBusy(false);
    }
  }

  // Loading: the deal hasn't been fetched yet.
  if (!sel) {
    return (
      <main className="constellations-bg flex min-h-screen flex-col items-center justify-center bg-reflection-bg px-6 text-cream">
        <p
          className={`animate-pulse text-2xl font-semibold ${heading}`}
          style={{ textShadow: "0 0 24px rgba(118,120,237,.55)" }}
        >
          Dealing the cards&hellip;
        </p>
      </main>
    );
  }

  // The Anomaly (neutral). With more than one anomaly (migration 118) this is a
  // real pick, on the same timed screen as the camps: choose which anomaly to
  // play and lock in. The Wandering Soul is free so the seat always has a legal
  // option; other anomalies must be unlocked, and show greyed with a lock.
  if (sel.camp === "neutral") {
    const anomalies = Object.values(ROLES).filter((r) => r.anomaly);
    const pickableAnomalies = anomalies.filter((r) => owned.has(r.id)).length;
    return (
      <MotionConfig reducedMotion="user">
      <main className="constellations-bg flex min-h-screen flex-col items-center bg-reflection-bg px-4 pb-10 pt-10 text-cream">
        <motion.div
          className="w-full max-w-2xl"
          initial="hidden"
          animate="show"
          variants={staggerContainer}
        >
          {/* Header — mirrors the camps' chooser (badge + timer). */}
          <motion.div variants={fadeUp} className="text-center">
            <p className={`text-sm uppercase tracking-[0.3em] text-soul ${heading}`}>
              You are the Anomaly
            </p>
            <div className="mt-2.5 flex items-center justify-center">
              <span className={`rounded-lg bg-soul px-3 py-1 text-sm font-semibold uppercase tracking-wide text-[#06363f] shadow-[0_0_12px_rgba(125,224,240,.6)] ${heading}`}>
                Anomaly &middot; Neutral
              </span>
            </div>
            <PhaseTimer seconds={remainingSec} className="mt-2" />
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-4 rounded-xl border-2 border-soul/40 bg-[#0d1c20]/70 p-4 text-center"
          >
            <p className="text-sm text-cream/80">
              You belong to no camp and win alone. Choose which anomaly you play.
            </p>
          </motion.div>

          {/* Pick your anomaly. */}
          <section className="mt-5">
            <motion.div
              variants={staggerContainer}
              className="mx-auto grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3"
            >
              {anomalies.map((r) => (
                <RoleOption
                  key={r.id}
                  role={r}
                  unlocked={owned.has(r.id)}
                  selected={sel.choice === r.id}
                  locked={sel.locked}
                  onPick={() => pick(r.id)}
                />
              ))}
            </motion.div>
            {pickableAnomalies < anomalies.length && (
              <p className="mt-2 text-center text-xs text-cream/50">
                Locked anomalies can be unlocked in the Roles tab for{" "}
                {roleUnlockCost()} {LE_ABBR}.
              </p>
            )}

            <motion.div variants={fadeUp} className="mx-auto mt-5 max-w-sm">
              {sel.locked ? (
                <div className="glow-gold-pulse rounded-xl border-2 border-soul/60 bg-soul/15 py-3 text-center font-semibold text-soul">
                  Locked in &mdash; waiting for the others
                </div>
              ) : (
                <motion.button
                  onClick={lockIn}
                  disabled={!sel.choice || busy}
                  whileHover={!sel.choice || busy ? undefined : { scale: 1.02 }}
                  whileTap={!sel.choice || busy ? undefined : { scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className={`w-full rounded-xl bg-soul py-3 font-semibold text-[#06363f] shadow-[0_0_16px_rgba(125,224,240,.3)] transition-shadow hover:shadow-[0_0_26px_rgba(125,224,240,.5)] disabled:opacity-40 ${heading}`}
                >
                  {busy
                    ? "Locking…"
                    : sel.choice
                      ? `Lock in ${ROLES[sel.choice]?.name ?? ""}`
                      : "Pick an anomaly first"}
                </motion.button>
              )}
            </motion.div>
          </section>
        </motion.div>
      </main>
      </MotionConfig>
    );
  }

  const isVice = sel.camp === "vice";
  // All roles of my camp + CLASS: unlocked ones are pickable, locked ones show
  // greyed with a lock (unlock them in the Roles tab — every role costs the same).
  const options = Object.values(ROLES).filter(
    (r) => r.camp === sel.camp && r.roleClass === sel.roleClass
  );
  const pickableCount = options.filter((r) => owned.has(r.id)).length;

  const teamPanel = (
    <section
      className="relative overflow-hidden rounded-xl border-2 border-[#7678ed]/40 bg-[#190f2e]/85 p-3"
      style={{ boxShadow: "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(118,120,237,.18)" }}
    >
      <CornerFrame colorClass="border-[#7678ed]/60" />
      <h2 className={`relative text-xs font-semibold uppercase tracking-widest text-[#a9aaf0] ${heading}`}>
        Your team&rsquo;s picks
      </h2>
      <p className="relative mt-1 text-[11px] leading-snug text-cream/55">
        Anonymous &mdash; you see your camp&rsquo;s roles forming, not who plays
        them.
      </p>
      <ul className="relative mt-2 flex flex-col gap-1.5">
        {sel.team.map((slot, i) => {
          const role = slot.choice ? ROLES[slot.choice] : null;
          return (
            <li
              key={i}
              className={
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors duration-300 " +
                (slot.me
                  ? "border border-[#7678ed]/50 bg-[#7678ed]/20"
                  : "border border-transparent bg-cream/5")
              }
            >
              <span className="shrink-0 rounded bg-gold/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-home-bg">
                {slot.roleClass
                  ? ROLE_CLASSES[slot.roleClass as RoleClass]?.label ?? slot.roleClass
                  : "Filler"}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {role ? role.name : <span className="text-cream/45 italic">Choosing…</span>}
                {slot.me && <span className="ml-1 text-xs text-gold">(you)</span>}
              </span>
              <span
                className={
                  "shrink-0 text-[10px] font-semibold uppercase tracking-wide transition-colors duration-300 " +
                  (slot.locked ? "text-green-300" : "text-cream/45")
                }
              >
                {slot.locked ? "Locked" : slot.choice ? "Considering" : "…"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <MotionConfig reducedMotion="user">
    <main className="constellations-bg flex min-h-screen flex-col items-center bg-reflection-bg px-4 pb-10 pt-10 text-cream">
      <motion.div
        className="w-full max-w-5xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <PhaseTip
          id="role_select"
          text="You've been dealt a camp and a class — pick which role you'll play within it. Your camp sees what roles are forming (not who picks them), so you can build a strong composition. Lock in before the timer ends."
        />

        {/* Header: camp + tier + timer. */}
        <motion.div variants={fadeUp} className="text-center">
          <p className={`text-sm uppercase tracking-[0.3em] text-gold ${heading}`}>
            Choose your role
          </p>
          <div className="mt-2.5 flex items-center justify-center gap-2">
            <span
              className={
                `rounded-lg px-3 py-1 text-sm font-semibold uppercase tracking-wide text-cream ${heading} ` +
                (isVice
                  ? "bg-consultation-bg shadow-[0_0_12px_rgba(128,0,32,.6)]"
                  : "bg-consultation-fg shadow-[0_0_12px_rgba(0,0,128,.6)]")
              }
            >
              {isVice ? "Vice" : "Virtue"}
            </span>
            <span
              className={`rounded-lg border border-gold/60 bg-black/30 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-gold ${heading}`}
            >
              {sel.roleClass
                ? ROLE_CLASSES[sel.roleClass as RoleClass].label
                : "Filler"}
            </span>
          </div>
          {/* The clock is the stake of this screen — big, enchanted, and
              red-heartbeat in the last 10 seconds. */}
          <PhaseTimer seconds={remainingSec} className="mt-2" />
        </motion.div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[18rem_1fr] lg:items-start">
          {/* Desktop: team panel on the left. */}
          <motion.div variants={fadeUp} className="hidden lg:block">
            {teamPanel}
          </motion.div>

          {/* My role options. */}
          <section>
            <motion.div
              variants={staggerContainer}
              className="mx-auto grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3"
            >
              {options.map((r) => (
                <RoleOption
                  key={r.id}
                  role={r}
                  unlocked={owned.has(r.id)}
                  selected={sel.choice === r.id}
                  locked={sel.locked}
                  onPick={() => pick(r.id)}
                />
              ))}
            </motion.div>
            {pickableCount === 1 && options.length > 1 && (
              <p className="mt-2 text-center text-xs text-cream/50">
                Locked roles can be unlocked in the Roles tab for{" "}
                {roleUnlockCost()} {LE_ABBR}.
              </p>
            )}

            {/* Lock in / locked state. */}
            <motion.div variants={fadeUp} className="mx-auto mt-5 max-w-sm">
              {sel.locked ? (
                <div className="glow-gold-pulse rounded-xl border-2 border-gold/60 bg-gold/15 py-3 text-center font-semibold text-gold">
                  Locked in &mdash; waiting for the others
                </div>
              ) : (
                <motion.button
                  onClick={lockIn}
                  disabled={!sel.choice || busy}
                  whileHover={!sel.choice || busy ? undefined : { scale: 1.02 }}
                  whileTap={!sel.choice || busy ? undefined : { scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-40 ${heading}`}
                >
                  {busy
                    ? "Locking…"
                    : sel.choice
                      ? `Lock in ${ROLES[sel.choice]?.name ?? ""}`
                      : "Pick a role first"}
                </motion.button>
              )}
            </motion.div>
          </section>
        </div>

        {/* Mobile: team panel at the bottom. */}
        <motion.div variants={fadeUp} className="mt-5 lg:hidden">
          {teamPanel}
        </motion.div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}

function RoleOption({
  role,
  unlocked,
  selected,
  locked,
  onPick,
}: {
  role: RoleDef;
  unlocked: boolean;
  selected: boolean;
  locked: boolean;
  onPick: () => void;
}) {
  const vice = role.camp === "vice";
  if (!unlocked) {
    return (
      <motion.div
        variants={fadeUp}
        className="relative block overflow-hidden rounded-lg border-2 opacity-70"
        style={{ borderColor: vice ? "#9b2741" : "#3a49b8" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/cards/${role.id}.png`} alt={role.name} className="block w-full opacity-60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 px-1 text-center backdrop-grayscale">
          <IconLock size={22} className="text-cream/90" aria-hidden />
          <span className="text-[11px] font-semibold text-cream">{role.name}</span>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-cream/60">
            Locked &mdash; unlock in Roles
          </span>
        </div>
      </motion.div>
    );
  }
  const inert = locked && !selected;
  return (
    <motion.button
      type="button"
      variants={fadeUp}
      onClick={onPick}
      disabled={inert}
      whileHover={inert || locked ? undefined : { y: -4, scale: 1.03 }}
      whileTap={inert || locked ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 24 }}
      className={
        "relative block overflow-hidden rounded-lg border-2 text-left " +
        (selected ? "glow-gold-pulse ring-2 ring-gold" : "") +
        (inert ? " opacity-40" : "")
      }
      style={{ borderColor: selected ? "#e3b510" : vice ? "#9b2741" : "#3a49b8" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/cards/${role.id}.png`} alt={role.name} className="block w-full" />
      <div
        className="absolute inset-x-0 bottom-0 px-2 pb-1.5 pt-6"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,.9), rgba(0,0,0,0))",
        }}
      >
        <div className="text-xs font-semibold leading-tight text-cream">{role.name}</div>
        <div className="text-[10px] leading-snug text-cream/80"><SoulEnergyText>{role.ability}</SoulEnergyText></div>
      </div>
      {selected && (
        <motion.span
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 24 }}
          className="absolute right-1.5 top-1.5 rounded bg-gold px-1.5 py-0.5 text-[9px] font-bold uppercase text-home-bg shadow-[0_0_10px_rgba(227,181,16,.6)]"
        >
          {locked ? "Locked" : "Picked"}
        </motion.span>
      )}
    </motion.button>
  );
}
