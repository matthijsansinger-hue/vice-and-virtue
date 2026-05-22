"use client";

import { useEffect, useRef } from "react";
import { getRole } from "@/lib/roles";
import { setReady, startMinigame } from "@/lib/game";
import { RoleCard } from "./RoleCard";
import { Centered } from "./Centered";
import type { Room, Player } from "@/lib/types";

export function RoleReveal({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const advancedRef = useRef(false);

  const isHost = myPlayer?.is_host ?? false;
  const readyCount = players.filter((p) => p.ready).length;
  const allReady = players.length > 0 && players.every((p) => p.ready);

  // The host moves everyone into the minigame once all players are ready.
  useEffect(() => {
    if (isHost && allReady && !advancedRef.current) {
      advancedRef.current = true;
      startMinigame(room.id);
    }
  }, [isHost, allReady, room.id]);

  if (!myPlayer) {
    return <Centered>This game is already in progress.</Centered>;
  }

  const myRole = getRole(myPlayer.role);
  if (!myRole) {
    return <Centered>Assigning your role&hellip;</Centered>;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-home-bg px-6 text-cream">
      <RoleCard role={myRole} />

      {myPlayer.ready ? (
        <p className="text-sm text-cream/70">
          You&rsquo;re ready &mdash; waiting for the others ({readyCount}/
          {players.length})
        </p>
      ) : (
        <button
          onClick={() => setReady(myPlayer.id, true)}
          className="rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          I&rsquo;m ready
        </button>
      )}
    </main>
  );
}
