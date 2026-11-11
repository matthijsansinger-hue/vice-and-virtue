"use client";

import { sociabilityMute } from "@/lib/game";
import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapMultiPick, type MapMultiRole } from "@/components/castle/MapMultiPick";
import { BELL_CURSOR, BellIcon } from "@/components/castle/tools";

const COST_PER_TARGET = 75;

const SOCIABILITY: MapMultiRole = {
  title: "Sociability",
  tint: "#f4b8ec",
  accent: "#e46bd6",
  button: ["#a33496", "#4f1048"],
  cursor: BELL_CURSOR,
  Icon: BellIcon,
  costPer: COST_PER_TARGET,
  pickVerb: "Silence",
  unpickVerb: "Let them speak",
  commitLabel: (n) => `Silence ${n || "no"} player${n === 1 ? "" : "s"}`,
  busyLabel: "Hushing…",
  outcome: (names) =>
    `You silenced ${names}. They stay quiet for the rest of today, unless something protected them.`,
  actedLine: "The words are taken. Anyone you silenced stays quiet for the rest of today.",
  clip: clipForAbility("sociability"),
};

// Sociability (virtue, Communicator) — migration 115.
//
// PASSIVE: the one-partner-per-cycle Outreach lock doesn't apply to her, so she
// may write to everyone every night (enforced in send_dm, not just here).
// ACTIVE: 75 SE per player to silence them for the rest of the day, several at
// once, chosen on the castle map with the bell. A target holding a
// Communication potion is immune, and she is NOT told which one held — so the
// potion stays a real counter rather than a tell (the map marks whom she
// chose, never who was actually silenced).
export function SociabilityAction({
  myPlayer,
  players,
  room,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
}) {
  return (
    <MapMultiPick
      role={SOCIABILITY}
      myPlayer={myPlayer}
      players={players}
      room={room}
      intro={
        <p className="mt-2 rounded-lg border border-soul/30 bg-soul/10 px-3 py-2 text-xs text-cream/85">
          <strong>Always on:</strong> the one-person Outreach limit doesn&rsquo;t
          apply to you. Write to everyone, every night.
        </p>
      }
      prompt={`Silence people for the rest of the day, ${COST_PER_TARGET} each, as many as you can afford. They can still read; they just can't speak.`}
      commit={async (ids) => {
        const res = await sociabilityMute(myPlayer.id, ids);
        if (res.ok) return { ok: true };
        return {
          ok: false,
          message:
            res.reason === "insufficient_se"
              ? "Not enough Soul Energy for that many."
              : res.reason === "already_acted"
                ? "You already acted today."
                : "Those players can't be silenced. Choose again.",
        };
      }}
    />
  );
}
