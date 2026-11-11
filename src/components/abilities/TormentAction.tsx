"use client";

import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { QUILL_CURSOR, QuillIcon } from "@/components/castle/tools";

// Torment: pick a player on the castle map with an inky quill (100 SE). In
// that day's Outreach every name on their screen becomes an ink blot (queued
// as 'torment'; see lib/ink.ts).
const TORMENT: MapTargetRole = {
  title: "Torment",
  tint: "#e6e0fb",
  accent: "#ece6ff",
  button: ["#2b3a7a", "#111737"],
  cursor: QUILL_CURSOR,
  Icon: QuillIcon,
  prompt:
    "Pick someone. In today's Outreach every name on their screen becomes an ink blot, so they won't know who they're writing to.",
  actions: [
    {
      verb: "Torment",
      cost: 100,
      action: "torment",
      clip: clipForAbility("torment"),
      outcome: (name) => `In today's Outreach, every name on ${name}'s screen will be an ink blot.`,
    },
  ],
};

export function TormentAction(props: { myPlayer: Player; players: Player[]; room: Room }) {
  return <MapTargetAbility role={TORMENT} {...props} />;
}
