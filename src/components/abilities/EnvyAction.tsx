"use client";

import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { MASK_CURSOR, MaskIcon } from "@/components/castle/tools";

// Envy: pick a player on the castle map with a masquerade mask (100 SE) to
// swap identities with for the round (queued as 'envy_swap').
const ENVY: MapTargetRole = {
  title: "Envy",
  tint: "#9df0c0",
  accent: "#3ddc84",
  button: ["#1f8a52", "#0c4227"],
  cursor: MASK_CURSOR,
  Icon: MaskIcon,
  prompt:
    "Pick someone to swap identities with for this round. Names swap for everyone else, and votes for either of you go to the other.",
  actions: [
    {
      verb: "Swap",
      doing: "swap identities",
      actionLabel: (name) => `Swap identities with ${name}`,
      cost: 100,
      action: "envy_swap",
      clip: clipForAbility("envy"),
      outcome: (name) => `You'll swap identities with ${name} for this round.`,
    },
  ],
};

export function EnvyAction(props: { myPlayer: Player; players: Player[]; room: Room }) {
  return <MapTargetAbility role={ENVY} {...props} />;
}
