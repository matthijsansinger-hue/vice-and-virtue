"use client";

import { queueGreed } from "@/lib/game";
import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { PURSE_CURSOR, PurseIcon } from "@/components/castle/tools";

// Greed (vice, Obstructor) — migration 115. Pay 100 SE to rob a player, picked
// on the castle map with a coin purse, and collect at the END of the
// reflection: resolve_greed runs after resolve_role_action, so you take
// whatever the target DIDN'T spend on their own ability this turn. Robbing
// someone who just paid 300 for a kill potion gets you very little; robbing a
// hoarder empties them.
//
// The victim is told that something took their Soul Energy, but never who, so
// using it doesn't out you.
const GREED: MapTargetRole = {
  title: "Greed",
  tint: "#f2cf85",
  accent: "#e0a93c",
  button: ["#8f5f14", "#4a2f05"],
  cursor: PURSE_CURSOR,
  Icon: PurseIcon,
  prompt:
    "Rob someone for 100. You collect at the end of the reflection, so you get what they have left, not what they have now. Pick a saver.",
  actedLine:
    "Your hand is in a pocket. You'll take what's left once everyone has paid for tonight.",
  actions: [
    {
      verb: "Rob",
      doing: "rob someone",
      cost: 100,
      clip: clipForAbility("greed"),
      perform: async (me, target, name) => {
        const res = await queueGreed(me.id, target.id);
        if (res.ok) return { ok: true };
        if (res.reason === "insufficient_se")
          return { ok: false, message: "You don't have enough Soul Energy to rob anyone." };
        if (res.reason === "already_acted")
          return { ok: false, message: "You already acted today." };
        return { ok: false, avoid: true, message: `You can't rob ${name}. Pick someone else.` };
      },
      outcome: (name) =>
        `Your hand is in ${name}'s pocket. You'll take what's left once everyone has paid for tonight.`,
    },
  ],
};

export function GreedAction(props: { myPlayer: Player; players: Player[]; room: Room }) {
  return <MapTargetAbility role={GREED} {...props} />;
}
