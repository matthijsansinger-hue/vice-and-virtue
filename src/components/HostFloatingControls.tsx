"use client";

import { useState } from "react";
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
import { ROLES } from "@/lib/roles";
import type { Room, Player } from "@/lib/types";

// A small floating control fixed to the bottom-right of the screen,
// only visible to the host. Lets them skip past whatever timer / ready
// check / vote count is currently gating progress.
export function HostFloatingControls({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [busy, setBusy] = useState(false);

  const isHost = myPlayer?.is_host ?? false;
  if (!isHost) return null;
  // Lobby has its own controls; game-over has nothing left to advance.
  if (room.phase === "lobby" || room.phase === "game_over") return null;

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
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={force}
        disabled={busy}
        title="Skip the current timer / ready check / vote and advance to the next phase"
        className="rounded-full border border-gold/60 bg-home-bg/80 px-3 py-2 text-xs font-semibold text-gold shadow-lg backdrop-blur transition-opacity hover:bg-home-bg disabled:opacity-50"
      >
        {busy ? "Advancing…" : "Force next phase (host)"}
      </button>
    </div>
  );
}
