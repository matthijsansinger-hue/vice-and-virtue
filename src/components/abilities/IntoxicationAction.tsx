"use client";

import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { FIST_CURSOR, FistIcon } from "@/components/castle/tools";

// Intoxication: hospitalise a player for one day, 125 SE, picked on the castle
// map with a fist. Queued as 'intox'; Justice's protect blocks it.
const INTOXICATION: MapTargetRole = {
  title: "Intoxication",
  tint: "#c7e58f",
  accent: "#9bd23c",
  button: ["#4f7d1e", "#28470e"],
  cursor: FIST_CURSOR,
  Icon: FistIcon,
  prompt:
    "Pick someone to put in the hospital for a day. They can't act until tomorrow. Justice can protect them.",
  actions: [
    {
      verb: "Hospitalise",
      cost: 125,
      action: "intox",
      clip: clipForAbility("intoxication"),
      outcome: (name) =>
        `You'll put ${name} in the hospital when this phase ends, unless Justice protects them.`,
    },
  ],
};

export function IntoxicationAction(props: { myPlayer: Player; players: Player[]; room: Room }) {
  return <MapTargetAbility role={INTOXICATION} {...props} />;
}
