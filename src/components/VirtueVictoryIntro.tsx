"use client";

import { VictoryScreen } from "./VictoryScreen";
import type { Player, Room } from "@/lib/types";

// The Virtues won: the "Virtue Victory" art (2026-11-22), then each player's
// own Continue goes straight to their match results — see VictoryScreen.
export function VirtueVictoryIntro(props: { room: Room; players: Player[]; myPlayer: Player | null }) {
  return <VictoryScreen camp="virtue" {...props} />;
}
