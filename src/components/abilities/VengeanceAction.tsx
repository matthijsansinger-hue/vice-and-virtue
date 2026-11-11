"use client";

import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { HAMMER_CURSOR, HammerIcon } from "@/components/castle/tools";

// Vengeance (normal role-action): hospitalise a player for one day, 150 SE,
// picked on the castle map with a hammer. Reuses the 'intox' action
// (protect-blockable, sends the target to hospital). Her revenge-while-
// imprisoned ability lives in VengeanceRevengeAction, shown by RoleAction only
// when she is in prison.
const VENGEANCE: MapTargetRole = {
  title: "Vengeance",
  tint: "#f6b48c",
  accent: "#f0782e",
  button: ["#c4521a", "#7a2e0a"],
  cursor: HAMMER_CURSOR,
  Icon: HammerIcon,
  prompt: "Pick someone to put in the hospital for a day. Justice can protect them.",
  actions: [
    {
      verb: "Hospitalise",
      cost: 150,
      action: "intox",
      clip: clipForAbility("vengeance", "hospitalise"),
      outcome: (name) =>
        `You'll put ${name} in the hospital when this phase ends, unless Justice protects them.`,
    },
  ],
};

export function VengeanceAction(props: { myPlayer: Player; players: Player[]; room: Room }) {
  return <MapTargetAbility role={VENGEANCE} {...props} />;
}
