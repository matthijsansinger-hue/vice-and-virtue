"use client";

import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { KNIFE_CURSOR, KnifeIcon } from "@/components/castle/tools";

// Murder picks a victim on the castle map with a dagger. The kill is queued
// and resolves at the end of the role-action phase (protection can block it).
const MURDER: MapTargetRole = {
  title: "Murder",
  tint: "#eea6b1",
  accent: "#c8203c",
  button: ["#d42a45", "#8c0f25"],
  cursor: KNIFE_CURSOR,
  Icon: KnifeIcon,
  prompt: "Pick someone in the castle to kill. It happens when this phase ends.",
  actions: [
    {
      verb: "Kill",
      cost: 200,
      action: "kill",
      clip: clipForAbility("murder"),
      outcome: (name) => `You'll kill ${name} when this phase ends.`,
    },
  ],
};

export function MurderAction(props: { myPlayer: Player; players: Player[]; room: Room }) {
  return <MapTargetAbility role={MURDER} {...props} />;
}
