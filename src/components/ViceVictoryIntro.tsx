"use client";

import { VictoryScreen } from "./VictoryScreen";
import type { Player, Room } from "@/lib/types";

// The Vices won: the "Vice Victory" art (2026-11-22), then each player's own
// Continue goes straight to their match results — see VictoryScreen.
export function ViceVictoryIntro(props: { room: Room; players: Player[]; myPlayer: Player | null }) {
  return <VictoryScreen camp="vice" {...props} />;
}
