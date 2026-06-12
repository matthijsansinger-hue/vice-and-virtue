"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { heading, CornerFrame, SoulCost, SoulEnergyText } from "@/components/ui/royal";
import { ROLES, type RoleDef } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { displayedName } from "@/lib/swaps";
import {
  startRoleAction,
  resolveRoleAction,
  endMinigame,
  startOutreach,
  startConsultation,
  endOutreach,
  endStore,
  resolveGroupAction,
  resolveConsultation,
  endGameOverview,
  endLoreIntro,
  endEventSummary,
  startNextDay,
  resolveMurderSuccession,
} from "@/lib/game";
import type { Room, Player, RoomPhase } from "@/lib/types";
import { RoleIcon } from "./RoleIcon";
import { SoulEnergyIcon } from "./CurrencyIcons";

// Maps a phase to one of the three day segments (or null = hide top bar):
// Reflection (role + minigame), Action (outreach + shop + team ability),
// Consultation (the imprisonment vote).
const PHASE_GROUP: Record<
  RoomPhase,
  "reflection" | "action" | "consultation" | null
> = {
  lobby: null,
  game_overview: null,
  role_select: null,
  role_overview: null,
  lore_intro: null,
  role_reveal: "reflection",
  role_action: "reflection",
  murder_succession: "reflection",
  event_summary: "reflection",
  minigame: "reflection",
  result: "reflection",
  outreach: "action",
  store: "action",
  group_action: "action",
  consultation: "consultation",
  new_day: "reflection",
  vice_victory_intro: null,
  virtue_victory_intro: null,
  game_over: null,
};

const SEGMENTS: {
  id: "reflection" | "action" | "consultation";
  label: string;
  short: string;
}[] = [
  { id: "reflection", label: "Reflection", short: "Reflect" },
  { id: "action", label: "Action", short: "Action" },
  { id: "consultation", label: "Consultation", short: "Consult" },
];

// Persistent top bar shown across all in-game phases. Contains:
//   - Day label (left)
//   - 3-segment phase progress (centre)
//   - Host force-skip button (right, host only)
//   - Player chip (right) — avatar + Soul Energy, tap to open a modal
//     with the full role description
export function TopBar({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const group = PHASE_GROUP[room.phase];
  if (!group) return null;

  const myRole: RoleDef | null = myPlayer?.role
    ? ROLES[myPlayer.role] ?? null
    : null;
  const isHost = myPlayer?.is_host ?? false;

  async function force() {
    if (busy) return;
    setBusy(true);
    try {
      switch (room.phase) {
        case "game_overview":
          await endGameOverview(room.id);
          break;
        case "lore_intro":
          await endLoreIntro(room.id, room.role_assign_mode);
          break;
        case "role_reveal":
          await startRoleAction(room.id);
          break;
        case "role_action":
          await resolveRoleAction(room.id);
          break;
        case "event_summary":
          await endEventSummary(room.id);
          break;
        case "minigame":
          await endMinigame(room.id);
          break;
        case "result":
          await startOutreach(room.id);
          break;
        case "outreach":
          await endOutreach(room.id);
          break;
        case "store":
          await endStore(room.id);
          break;
        case "group_action":
          await resolveGroupAction(room.id);
          break;
        case "consultation":
          await resolveConsultation(room.id);
          break;
        case "new_day":
          await startNextDay(room.id, room.day);
          break;
        case "murder_succession": {
          const { data } = await supabase.rpc("eligible_successors", {
            p_room_id: room.id,
          });
          const ids = Array.isArray(data) ? (data as string[]) : [];
          if (ids.length > 0) {
            await resolveMurderSuccession(room.id, ids[0]);
          }
          break;
        }
      }
    } catch (e) {
      // A failed transition (e.g. an unrun migration) used to fail
      // silently and look like a dead button — surface it instead.
      console.error("Force-skip failed:", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-2 border-b border-gold/30 bg-home-bg/85 px-3 py-2 shadow-[0_2px_12px_rgba(0,0,0,.3)] backdrop-blur">
        {/* Day */}
        <span className={`shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-gold ${heading}`}>
          Day {room.day}
        </span>

        {/* Phase progress — labelled so players learn the day's loop. The
            active segment's gold bar slides between segments (shared layoutId)
            as the day advances. */}
        <div className="flex flex-1 items-end gap-1.5">
          {SEGMENTS.map((s) => {
            const isActive = s.id === group;
            return (
              <div
                key={s.id}
                title={s.label}
                className="flex min-w-0 flex-1 flex-col items-center gap-1"
              >
                <span
                  className={
                    "w-full truncate text-center text-[9px] uppercase tracking-wide transition-colors " +
                    (isActive ? `font-semibold text-gold ${heading}` : "text-gold/40")
                  }
                >
                  {s.short}
                </span>
                <div className="relative h-1.5 w-full overflow-hidden rounded bg-gold/20">
                  {isActive && (
                    <motion.div
                      layoutId="topbar-segment-active"
                      className="absolute inset-0 rounded bg-gold shadow-[0_0_8px_rgba(227,181,16,.7)]"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Host force-skip */}
        {isHost && (
          <button
            onClick={force}
            disabled={busy}
            title="Skip the current timer / ready check / vote and advance to the next phase"
            className={`shrink-0 rounded-md border border-gold/60 px-2 py-1 text-[10px] font-semibold text-gold transition-colors hover:bg-gold/15 disabled:opacity-50 ${heading}`}
          >
            {busy ? "…" : "Skip"}
          </button>
        )}

        {/* Player chip (avatar + Soul Energy) */}
        {myPlayer && myRole && (
          <motion.button
            onClick={() => setExpanded(true)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-soul/40 bg-cream/10 px-2 py-1 transition-colors hover:bg-cream/20"
            title="Show role details"
          >
            <RoleIcon
              roleId={myRole.id}
              camp={myRole.camp}
              className="h-6 w-6"
            />
            <SoulEnergyIcon size={15} />
            <span className={`text-xs tabular-nums ${heading}`}>
              <SoulCost value={myPlayer.soul_energy} label="" />
            </span>
          </motion.button>
        )}
      </div>

      {/* Role-detail modal */}
      {expanded && myPlayer && myRole && (
        <RoleDetailModal
          role={myRole}
          name={displayedName(myPlayer, room, players, myPlayer?.id)}
          soulEnergy={myPlayer.soul_energy}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}

function RoleDetailModal({
  role,
  name,
  soulEnergy,
  onClose,
}: {
  role: RoleDef;
  name: string;
  soulEnergy: number;
  onClose: () => void;
}) {
  const isVice = role.camp === "vice";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border-2 border-gold p-6 text-home-bg shadow-2xl"
        style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
      >
        <CornerFrame colorClass="border-home-bg/25" />
        <p className={`relative text-center text-xs uppercase tracking-[0.3em] text-home-bg/50 ${heading}`}>
          Your role
        </p>
        <h1 className={`relative mt-2 text-center text-3xl font-bold ${heading}`}>{role.name}</h1>
        <p className="relative text-center text-sm text-home-bg/60">{name}</p>

        <div className="relative mt-3 flex items-center justify-center gap-2">
          <span
            className={
              `rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cream ${heading} ` +
              (isVice
                ? "bg-consultation-bg shadow-[0_0_10px_rgba(128,0,32,.5)]"
                : "bg-consultation-fg shadow-[0_0_10px_rgba(0,0,128,.5)]")
            }
          >
            {isVice ? "Vice" : "Virtue"}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-lg border border-soul-ink/40 bg-soul-ink/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide ${heading}`}>
            <SoulEnergyIcon size={14} />
            <SoulCost value={soulEnergy} onLight />
          </span>
        </div>

        <p className="relative mt-3 text-center text-sm font-semibold text-home-bg/80">
          Your camp wins when every {isVice ? "Virtue" : "Vice"} is imprisoned
          or dead.
        </p>

        <p className="relative mt-3 text-center text-sm leading-relaxed">
          <SoulEnergyText onLight>{role.description}</SoulEnergyText>
        </p>

        <p className={`relative mt-4 text-center text-[10px] uppercase tracking-widest text-home-bg/40 ${heading}`}>
          Tier {role.tier}
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
