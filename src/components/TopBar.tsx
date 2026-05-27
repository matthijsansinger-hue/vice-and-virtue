"use client";

import { useState } from "react";
import { ROLES, type RoleDef } from "@/lib/roles";
import { displayedName } from "@/lib/swaps";
import {
  startRoleAction,
  endRoleAction,
  endMinigame,
  startOutreach,
  startConsultation,
  endOutreach,
  endConsultation,
  chooseMurderSuccessor,
} from "@/lib/game";
import type { Room, Player, RoomPhase } from "@/lib/types";

// Maps a phase to one of the three day segments (or null = hide top bar).
const PHASE_GROUP: Record<
  RoomPhase,
  "reflection" | "outreach" | "consultation" | null
> = {
  lobby: null,
  role_reveal: "reflection",
  role_action: "reflection",
  murder_succession: "reflection",
  minigame: "reflection",
  result: "reflection",
  outreach: "outreach",
  consultation: "consultation",
  game_over: null,
};

const SEGMENTS: { id: "reflection" | "outreach" | "consultation"; label: string }[] = [
  { id: "reflection", label: "Reflection" },
  { id: "outreach", label: "Outreach" },
  { id: "consultation", label: "Consultation" },
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
        case "role_reveal":
          await startRoleAction(room.id);
          break;
        case "role_action":
          await endRoleAction(room.id);
          break;
        case "minigame":
          await endMinigame(room.id);
          break;
        case "result":
          if (room.outreach_enabled) {
            await startOutreach(room.id);
          } else {
            await startConsultation(room.id);
          }
          break;
        case "outreach":
          await endOutreach(room.id);
          break;
        case "consultation":
          await endConsultation(room.id, players, room.day);
          break;
        case "murder_succession": {
          const candidate = players.find(
            (p) =>
              p.id !== room.pending_murder_death &&
              p.role &&
              ROLES[p.role]?.camp === "vice" &&
              !p.dead &&
              !p.in_prison &&
              !p.in_hospital
          );
          if (candidate) {
            await chooseMurderSuccessor(room.id, candidate.id);
          }
          break;
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-2 border-b border-gold/30 bg-home-bg/85 px-3 py-2 backdrop-blur">
        {/* Day */}
        <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-gold">
          Day {room.day}
        </span>

        {/* Phase progress */}
        <div className="flex flex-1 items-center gap-1">
          {SEGMENTS.map((s) => (
            <div
              key={s.id}
              title={s.label}
              className={
                "h-1.5 flex-1 rounded transition-colors " +
                (s.id === group ? "bg-gold" : "bg-gold/20")
              }
            />
          ))}
        </div>

        {/* Host force-skip */}
        {isHost && (
          <button
            onClick={force}
            disabled={busy}
            title="Skip the current timer / ready check / vote and advance to the next phase"
            className="shrink-0 rounded border border-gold/60 px-2 py-1 text-[10px] font-semibold text-gold transition-colors hover:bg-cream/10 disabled:opacity-50"
          >
            {busy ? "…" : "Skip"}
          </button>
        )}

        {/* Player chip (avatar + Soul Energy) */}
        {myPlayer && myRole && (
          <button
            onClick={() => setExpanded(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-cream/10 px-2 py-1 transition-colors hover:bg-cream/20"
            title="Show role details"
          >
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-cream " +
                (myRole.camp === "vice"
                  ? "bg-consultation-bg"
                  : "bg-consultation-fg")
              }
            >
              {myRole.name.charAt(0)}
            </span>
            <span className="text-xs font-semibold tabular-nums text-cream">
              {myPlayer.soul_energy}
            </span>
          </button>
        )}
      </div>

      {/* Role-detail modal */}
      {expanded && myPlayer && myRole && (
        <RoleDetailModal
          role={myRole}
          name={displayedName(myPlayer, room, players)}
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
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border-2 border-gold bg-cream p-6 text-home-bg"
      >
        <p className="text-center text-xs uppercase tracking-widest text-home-bg/50">
          Your role
        </p>
        <h1 className="mt-2 text-center text-3xl font-semibold">{role.name}</h1>
        <p className="text-center text-sm text-home-bg/60">{name}</p>

        <div className="mt-3 flex items-center justify-center gap-2">
          <span
            className={
              "rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cream " +
              (isVice ? "bg-consultation-bg" : "bg-consultation-fg")
            }
          >
            {isVice ? "Vice" : "Virtue"}
          </span>
          <span className="rounded border border-home-bg/30 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
            {soulEnergy} SE
          </span>
        </div>

        <p className="mt-5 text-center text-sm leading-relaxed">
          {role.description}
        </p>

        <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-home-bg/40">
          Tier {role.tier}
        </p>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          Close
        </button>
      </div>
    </div>
  );
}
