"use client";

import { useEffect, useRef, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  heading,
  staggerContainer,
  fadeUp,
  CornerFrame,
  PhaseTimer,
  StatePanel,
  SoulFlame,
  SoulEnergyText,
} from "@/components/ui/royal";
import { ROLES } from "@/lib/roles";
import { setReady, resolveRoleAction, ROLE_ACTION_SECONDS } from "@/lib/game";
import { CONTINUE_SECONDS, setContinueDeadline } from "@/lib/useMajorityAdvance";
import { CertaintyAction } from "./abilities/CertaintyAction";
import { WanderingSoulAction } from "./abilities/WanderingSoulAction";
import { GameMasterAction } from "./abilities/GameMasterAction";
import { EmpathyAction } from "./abilities/EmpathyAction";
import { MurderAction } from "./abilities/MurderAction";
import { GreedAction } from "./abilities/GreedAction";
import { SociabilityAction } from "./abilities/SociabilityAction";
import { JusticeAction } from "./abilities/JusticeAction";
import { IntoxicationAction } from "./abilities/IntoxicationAction";
import { VengeanceAction } from "./abilities/VengeanceAction";
import { SacrificeAction } from "./abilities/SacrificeAction";
import { WorshipperSeekerAction } from "./abilities/WorshipperSeekerAction";
import { VengeanceRevengeAction } from "./abilities/VengeanceRevengeAction";
import { EnvyAction } from "./abilities/EnvyAction";
import { TormentAction } from "./abilities/TormentAction";
import { DeterminationAction } from "./abilities/DeterminationAction";
import { GenerosityAction } from "./abilities/GenerosityAction";
import { GamblingAction } from "./abilities/GamblingAction";
import { PrideAction } from "./abilities/PrideAction";
import { DiligenceAction } from "./abilities/DiligenceAction";
import { WrathAction } from "./abilities/WrathAction";
import { LoveAction } from "./abilities/LoveAction";
import { FanaticismAction } from "./abilities/FanaticismAction";
import { BombPassPanel } from "./abilities/BombPassPanel";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import type { Room, Player } from "@/lib/types";

const IMPLEMENTED_ABILITIES = new Set([
  "game_master",
  "greed",
  "sociability",
  "certainty",
  "empathy",
  "murder",
  "justice",
  "intoxication",
  "vengeance",
  "sacrifice",
  // Truthfulness's action lives in the consultation result screen, not
  // here, but we still want a friendly explainer instead of the generic
  // "not implemented" placeholder.
  "truthfulness",
  "vice_worshipper",
  "virtue_seeker",
  "envy",
  "torment",
  // New-role abilities, batch 1 (migration 066).
  "determination",
  "generosity",
  "gambling",
  "pride",
  "diligence",
  // New-role abilities, batch 2 (migration 067).
  "wrath",
  "love",
  // New-role abilities, batch 3 (migration 068).
  "fanaticism",
  // Anomaly role (migration 094).
  "wandering_soul",
]);

export function RoleAction({
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

  const isHost = myPlayer?.is_host ?? false;
  const active = players.filter(
    (p) => !p.in_prison && !p.dead && !p.in_hospital
  );

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : ROLE_ACTION_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  useEffect(() => {
    if (active.length > 0 && active.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      expired &&
      myPlayer &&
      !myPlayer.in_prison &&
      !myPlayer.dead &&
      !myPlayer.in_hospital &&
      !myPlayer.ready
    ) {
      setReady(myPlayer.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // Majority pressed Done → shorten the timer to a visible 10s countdown so
  // everyone sees the phase is about to end, instead of waiting the full
  // window. (Won't extend a timer already under 10s.)
  const readyCount = active.filter((p) => p.ready).length;
  const majority =
    resetSeen && active.length > 0 && readyCount * 2 > active.length;
  useEffect(() => {
    if (!isHost || !majority) return;
    if (endsAt !== null && endsAt - Date.now() <= (CONTINUE_SECONDS + 0.5) * 1000) {
      return;
    }
    void setContinueDeadline(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, majority, endsAt, room.id]);

  // Everyone acted → advance immediately (don't wait out the countdown). Else
  // the host advances when the (possibly shortened) timer elapses, plus a short
  // grace so stragglers' auto-ready writes land first.
  const allReady =
    resetSeen && active.length > 0 && active.every((p) => p.ready);
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    const timerExpired = endsAt !== null && now >= endsAt + 1500;
    if (allReady || timerExpired) {
      advancedRef.current = true;
      resolveRoleAction(room.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, now, endsAt, room.id, allReady]);

  async function done() {
    if (!myPlayer || myPlayer.ready) return;
    await setReady(myPlayer.id, true);
  }

  // Dead: passive screen, no action. The dead chat is embedded so the
  // dead can still talk to each other while the living play.
  if (myPlayer?.dead) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center constellations-bg px-6 py-12 text-cream">
        <StatePanel accentRgb="153,27,27">
          <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
            Day {room.day}
          </p>
          <p className={`mt-2 text-3xl font-bold text-red-200 ${heading}`}>
            You&rsquo;re dead
          </p>
          <p className="mt-2 text-cream/70">The game continues without you.</p>
        </StatePanel>
        <div className="mt-6 w-full max-w-sm">
          <DeadChat room={room} players={players} myPlayer={myPlayer} />
        </div>
      </main>
      </MotionConfig>
    );
  }

  // Two roles keep acting from a cell, both intentional exceptions: Vengeance
  // (her revenge IS the jailed ability) and the Game Master (whose whole plan is
  // to keep the game running, and who can buy himself out). Everyone else in
  // hospital/prison falls through to the normal role-action screen as a
  // read-only spectator (the ability is disabled below).
  if (
    myPlayer?.in_prison &&
    (myPlayer.role === "vengeance" || myPlayer.role === "game_master")
  ) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col items-center constellations-bg px-4 pb-8 pt-16 text-cream">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <div className="text-center">
            <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
              Day {room.day} &mdash; imprisoned
            </p>
            <p className="mt-2 text-sm text-cream/80">
              <span className={`inline-flex items-center gap-1 rounded-full border border-soul/50 bg-black/30 px-2.5 py-0.5 font-semibold text-soul shadow-[0_0_10px_rgba(125,224,240,.25)] ${heading}`}>
                {myPlayer.soul_energy} <SoulFlame />
              </span>
            </p>
          </div>
          <div className="mt-6">
            {myPlayer.role === "vengeance" ? (
              <VengeanceRevengeAction myPlayer={myPlayer} />
            ) : (
              <GameMasterAction
                myPlayer={myPlayer}
                players={players}
                day={room.day}
              />
            )}
          </div>
        </motion.div>
      </main>
      </MotionConfig>
    );
  }

  const role = myPlayer?.role ? ROLES[myPlayer.role] : undefined;
  const myCamp = role?.camp ?? null;
  // Whether the viewer can act (hospital + non-Vengeance prison spectate
  // read-only — the ability is disabled and Done is hidden).
  const canAct = !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;

  if (myPlayer?.ready) {
    return (
      <MotionConfig reducedMotion="user">
      <main className="constellations-bg flex min-h-screen flex-col items-center justify-center px-6 text-cream">
        <StatePanel accentRgb="227,181,16" pulse>
          <p className={`text-2xl font-bold text-gold ${heading}`}>Done!</p>
          <p className="mt-2 text-cream/70">
            Waiting for the other players&hellip;
          </p>
        </StatePanel>
      </main>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <main className="flex min-h-screen flex-col items-center constellations-bg px-4 pb-8 pt-16 text-cream">
      <motion.div
        className="w-full max-w-4xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        <div className="mx-auto max-w-2xl">
        <PhaseTip
          id="role_action"
          text="Use your role's power here — it costs Soul Energy. No power to use, or saving up? Tap Done to skip. You earn more Soul Energy in the minigame."
        />
        <motion.div variants={fadeUp} className="text-center">
          <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
            Day {room.day} &mdash; role action
          </p>
          <PhaseTimer seconds={remainingSec} className="mt-1" />
          <p className="mt-2 flex items-center justify-center gap-2 text-sm text-cream/80">
            <span className="font-semibold">{role?.name ?? "Your role"}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border border-soul/50 bg-black/30 px-2.5 py-0.5 font-semibold text-soul shadow-[0_0_10px_rgba(125,224,240,.25)] ${heading}`}>
              {myPlayer?.soul_energy ?? 0} <SoulFlame />
            </span>
          </p>
          <p className="mt-1 text-xs text-cream/60">
            <SoulEnergyText>Use your ability secretly — or skip. Abilities cost Soul Energy.</SoulEnergyText>
          </p>
        </motion.div>
        </div>

        {/* Ability (left) + info rail (right) on desktop; stacks on mobile. */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem] lg:items-start">
          {/* Your action + Done. */}
          <motion.div variants={fadeUp}>
        {/* Anyone (whatever their role) carrying a Fanaticism bomb must pass
            it this reflection — shown above their own ability. */}
        {myPlayer?.bomb_must_pass && (
          <BombPassPanel myPlayer={myPlayer} players={players} />
        )}
        <div className={canAct ? "" : "pointer-events-none opacity-60"}>
          {role?.id === "game_master" && myPlayer && (
            <GameMasterAction
              myPlayer={myPlayer}
              players={players}
              day={room.day}
            />
          )}
          {role?.id === "wandering_soul" && myPlayer && (
            <WanderingSoulAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "certainty" && myPlayer && (
            <CertaintyAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "empathy" && myPlayer && (
            <EmpathyAction
              myPlayer={myPlayer}
              players={players}
              day={room.day}
            />
          )}
          {role?.id === "murder" && myPlayer && (
            <MurderAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "greed" && myPlayer && (
            <GreedAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "sociability" && myPlayer && (
            <SociabilityAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "justice" && myPlayer && (
            <JusticeAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "intoxication" && myPlayer && (
            <IntoxicationAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "vengeance" && myPlayer && (
            <VengeanceAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "sacrifice" && myPlayer && (
            <SacrificeAction
              myPlayer={myPlayer}
              players={players}
              room={room}
              mode="queued"
            />
          )}
          {role?.id === "truthfulness" && (
            <div
              className="relative overflow-hidden rounded-xl border-2 border-[#7678ed]/40 bg-[#190f2e]/85 p-5 text-cream"
              style={{ boxShadow: "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(118,120,237,.18)" }}
            >
              <CornerFrame colorClass="border-[#7678ed]/60" />
              <p className={`relative text-sm uppercase tracking-widest text-[#a9aaf0] ${heading}`}>
                Truthfulness
              </p>
              <p className="relative mt-2 text-sm text-cream/80">
                Your ability is used during the consultation phase, after a
                player has been imprisoned. Tap Done to continue.
              </p>
            </div>
          )}
          {(role?.id === "vice_worshipper" ||
            role?.id === "virtue_seeker") &&
            myPlayer && (
              <WorshipperSeekerAction myPlayer={myPlayer} players={players} />
            )}
          {role?.id === "envy" && myPlayer && (
            <EnvyAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "torment" && myPlayer && (
            <TormentAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "determination" && myPlayer && (
            <DeterminationAction myPlayer={myPlayer} />
          )}
          {role?.id === "generosity" && myPlayer && (
            <GenerosityAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "gambling" && myPlayer && (
            <GamblingAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "pride" && myPlayer && (
            <PrideAction myPlayer={myPlayer} />
          )}
          {role?.id === "diligence" && <DiligenceAction />}
          {role?.id === "wrath" && myPlayer && (
            <WrathAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "love" && myPlayer && (
            <LoveAction myPlayer={myPlayer} players={players} />
          )}
          {role?.id === "fanaticism" && myPlayer && (
            <FanaticismAction myPlayer={myPlayer} players={players} />
          )}
          {role && !IMPLEMENTED_ABILITIES.has(role.id) && (
            <div
              className="relative overflow-hidden rounded-xl border-2 border-[#7678ed]/40 bg-[#190f2e]/85 p-5 text-cream"
              style={{ boxShadow: "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(118,120,237,.18)" }}
            >
              <CornerFrame colorClass="border-[#7678ed]/60" />
              <p className={`relative text-sm uppercase tracking-widest text-[#a9aaf0] ${heading}`}>
                {role.name}
              </p>
              <p className="relative mt-2 text-sm text-cream/80">
                Your ability isn&rsquo;t implemented yet. Tap Done to continue.
              </p>
            </div>
          )}
        </div>

            {canAct ? (
              <>
                <motion.button
                  onClick={done}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  className={`mt-6 w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] ${heading}`}
                >
                  {myPlayer && !myPlayer.acted_this_day
                    ? "Skip ability & continue"
                    : "Done"}
                </motion.button>
                <p className="mt-2 text-center text-xs text-cream/50">
                  Pressing this without using your ability counts as skipping it.
                </p>
              </>
            ) : (
              <div className="mt-6 rounded-xl border-2 border-gold/40 bg-black/25 py-3 text-center text-sm font-semibold text-cream/80">
                You&rsquo;re in {myPlayer?.in_hospital ? "hospital" : "prison"} &mdash; you can watch but can&rsquo;t act this round.
              </div>
            )}
          </motion.div>

          {/* Info rail: camp goal, who's left, and camp broadcasts. On mobile
              this sits below the action. */}
          <motion.aside variants={fadeUp} className="flex flex-col gap-4">
            {myCamp && (
              <div
                className="relative overflow-hidden rounded-xl border-2 border-[#7678ed]/40 bg-[#190f2e]/85 p-4"
                style={{ boxShadow: "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(118,120,237,.18)" }}
              >
                <CornerFrame colorClass="border-[#7678ed]/60" />
                <p className={`relative text-xs uppercase tracking-widest text-[#a9aaf0] ${heading}`}>
                  {myCamp === "neutral" ? "Your fate" : "Your camp"}
                </p>
                {myCamp === "neutral" ? (
                  <>
                    <p className={`relative mt-1 font-semibold ${heading}`} style={{ color: "#cdbfe6" }}>
                      The Wandering Soul
                    </p>
                    <p className="relative mt-1 text-sm text-cream/75">
                      You win by escaping — name every living player&rsquo;s camp here
                      to break free and end the game.
                    </p>
                  </>
                ) : (
                  <>
                    <p
                      className={`relative mt-1 font-semibold ${heading}`}
                      style={{ color: myCamp === "vice" ? "#e6889a" : "#9a9ce0" }}
                    >
                      {myCamp === "vice" ? "Vice" : "Virtue"}
                    </p>
                    <p className="relative mt-1 text-sm text-cream/75">
                      You win when every {myCamp === "vice" ? "Virtue" : "Vice"} is
                      imprisoned or dead.
                    </p>
                  </>
                )}
                <p className="relative mt-3 text-xs text-cream/60">
                  {active.length} player{active.length === 1 ? "" : "s"} still in
                  play
                </p>
              </div>
            )}
          </motion.aside>
        </div>
      </motion.div>
    </main>
    </MotionConfig>
  );
}
