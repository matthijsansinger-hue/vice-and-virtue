"use client";

import { useBlockedIds } from "@/lib/blocks";
import { displayedName } from "@/lib/swaps";
import type { Player, Room } from "@/lib/types";

// A compact "Blocked: name ✕" strip for unblocking mid-game, where the
// lobby isn't reachable. Renders nothing when you've blocked no one. `dark`
// styles it for dark panels (e.g. the dead chat).
export function BlockedStrip({
  room,
  players,
  myPlayerId,
  dark = false,
  className = "",
}: {
  room: Room;
  players: Player[];
  myPlayerId?: string;
  dark?: boolean;
  className?: string;
}) {
  const { blocked, unblock } = useBlockedIds(room.id);
  const list = players.filter((p) => blocked.has(p.id));
  if (list.length === 0) return null;

  const labelClass = dark ? "text-cream/60" : "text-home-bg/50";
  const chipClass = dark
    ? "border-cream/40 text-cream/80 hover:bg-cream/10"
    : "border-home-bg/30 text-home-bg/70 hover:bg-home-bg/10";

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      <span className={`text-[10px] uppercase tracking-wide ${labelClass}`}>
        Blocked:
      </span>
      {list.map((p) => (
        <button
          key={p.id}
          onClick={() => unblock(p.id)}
          title={`Unblock ${p.name}`}
          className={`rounded border px-2 py-0.5 text-[11px] ${chipClass}`}
        >
          {displayedName(p, room, players, myPlayerId)} ✕
        </button>
      ))}
    </div>
  );
}
