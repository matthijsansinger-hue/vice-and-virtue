"use client";

import { useState } from "react";
import { convertPlayer, armTiebreak } from "@/lib/game";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player, Room } from "@/lib/types";
import {
  MapRoleButton,
  MapTargetAbility,
  type MapTargetRole,
} from "@/components/castle/MapTargetAbility";
import { ARROW_CURSOR, ArrowIcon } from "@/components/castle/tools";

const CONVERT_COST = 250;
const TIEBREAK_COST = 100;

const LOVE: MapTargetRole = {
  title: "Love",
  tint: "#ffb3c8",
  accent: "#ff5c8a",
  button: ["#d02f5f", "#6d0f2c"],
  cursor: ARROW_CURSOR,
  Icon: ArrowIcon,
  // Conversion only lands on an active target (the server rejects dead /
  // imprisoned / hospitalised), so the rest are dimmed.
  canTarget: (p) => !p.in_prison && !p.in_hospital,
  prompt:
    "Pick someone to turn into a Virtue Seeker. It only takes hold on a Vice who isn't S-tier, but your offering is spent either way.",
  actions: [
    {
      verb: "Turn",
      doing: "turn someone",
      cost: CONVERT_COST,
      // The turn clip is played by AbilityOutcomeWatcher only if it takes
      // hold (resolved at end of role-action), not on tap.
      clip: null,
      perform: async (me, target, name) =>
        (await convertPlayer(me.id, target.id)).ok
          ? { ok: true }
          : { ok: false, avoid: true, message: `You can't turn ${name}. Pick someone else.` },
      outcome: (name) =>
        `Your appeal to ${name} is set. It takes hold when this phase ends, and you'll be told whether it worked.`,
    },
  ],
};

// Love (one ability per day): turn a Vice into a Virtue Seeker (250 — charged
// even if the target wasn't a Vice), picked on the castle map with Cupid's
// arrow; OR arm the deciding vote (100): in this day's consultation, a tie you
// vote in breaks to your chosen target — untargeted, so a button under the map.
export function LoveAction({
  myPlayer,
  players,
  room,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
}) {
  const { play } = useAbilityAnimation();
  const [busy, setBusy] = useState(false);
  const [doneLine, setDoneLine] = useState<string | null>(null);

  async function armVote() {
    if (busy) return;
    setBusy(true);
    try {
      if (await armTiebreak(myPlayer.id)) {
        setDoneLine(
          "You've armed the deciding vote. If today's vote ties and you voted for one of the tied players, your choice is imprisoned."
        );
        await play(clipForAbility("love", "tiebreak"));
      }
    } finally {
      setBusy(false);
    }
  }

  const below =
    myPlayer.acted_this_day || doneLine ? null : (
      <MapRoleButton
        role={LOVE}
        label="Arm the deciding vote"
        cost={TIEBREAK_COST}
        onClick={armVote}
        disabled={busy || myPlayer.soul_energy < TIEBREAK_COST}
        hint="If today's vote ties and you voted for one of the tied players, your choice is imprisoned."
      />
    );

  return (
    <MapTargetAbility
      role={LOVE}
      myPlayer={myPlayer}
      players={players}
      room={room}
      doneLine={doneLine}
      below={below}
    />
  );
}
