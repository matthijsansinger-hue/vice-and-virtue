"use client";

import { heading } from "@/components/ui/royal";
import { CastleMap } from "./CastleMap";
import type { Player, Room } from "@/lib/types";

// The castle map to look at, for everyone in the role action whose ability
// isn't on the map (Justice, Empathy, …), for those who are done and waiting,
// and for the dead. Nobody can be tapped. Same scatter as the role maps
// (room + day + viewer), so prisoners stand in the Dungeon and the
// hospitalised in the Infirmary, as on every castle map.

// Roles whose own ability already shows the castle map.
export const MAP_ROLES = new Set([
  "murder",
  "vengeance",
  "intoxication",
  "fanaticism",
  "torment",
  "greed",
  "envy",
  "wrath",
  "generosity",
  "sociability",
  "certainty",
  "love",
]);

export function CastleView({
  room,
  players,
  myPlayerId,
  className = "",
}: {
  room: Room;
  players: Player[];
  myPlayerId: string | null;
  className?: string;
}) {
  return (
    <section className={className} aria-label="The castle tonight">
      <h2 className={`text-center text-sm font-semibold text-[#cdbfe6] ${heading}`}>The castle tonight</h2>
      <p className="mt-0.5 text-center text-xs text-cream/60">
        Prisoners are in the Dungeon, the hospitalised in the Infirmary.
      </p>
      <div className="mt-3">
        <CastleMap
          room={room}
          players={players}
          myPlayerId={myPlayerId}
          accent="#b9a7e3"
          canPick={() => false}
          dimOthers={false}
          label="Castle map: where everyone is tonight"
        />
      </div>
    </section>
  );
}
