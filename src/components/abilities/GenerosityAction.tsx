"use client";

import { giftSoulEnergy, grantExtraLife } from "@/lib/game";
import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { GIFT_CURSOR, GiftIcon } from "@/components/castle/tools";

// Generosity (one ability per day): pick a player on the castle map with a
// gift box, then either gift them 100 Soul Energy (100) or grant them a
// lasting extra life (200) — both buttons in the same map menu.
const GENEROSITY: MapTargetRole = {
  title: "Generosity",
  tint: "#b9cdff",
  accent: "#6f9bff",
  button: ["#3a63c9", "#1a2f6b"],
  cursor: GIFT_CURSOR,
  Icon: GiftIcon,
  prompt: "Pick someone to give to: 100 Soul Energy, or an extra life.",
  actedLine: "You already gave today.",
  actions: [
    {
      verb: "Gift",
      doing: "gift Soul Energy",
      actionLabel: (name) => `Gift ${name} 100 Soul Energy`,
      hint: "They get 100 Soul Energy.",
      cost: 100,
      clip: clipForAbility("generosity"),
      perform: async (me, target) =>
        (await giftSoulEnergy(me.id, target.id))
          ? { ok: true }
          : { ok: false, message: "That gift didn't go through. Try again." },
      outcome: (name) => `You gave ${name} 100 Soul Energy.`,
    },
    {
      verb: "Extra life",
      doing: "grant an extra life",
      actionLabel: (name) => `Grant ${name} an extra life`,
      hint: "It absorbs one future kill or hospitalisation.",
      cost: 200,
      clip: clipForAbility("generosity", "life"),
      perform: async (me, target) =>
        (await grantExtraLife(me.id, target.id))
          ? { ok: true }
          : { ok: false, message: "The extra life didn't go through. Try again." },
      outcome: (name) => `You granted ${name} an extra life.`,
    },
  ],
};

export function GenerosityAction(props: { myPlayer: Player; players: Player[]; room: Room }) {
  return <MapTargetAbility role={GENEROSITY} {...props} />;
}
