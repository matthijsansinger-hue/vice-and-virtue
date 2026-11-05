"use client";

import { PowerAction } from "./PowerAction";
import type { Player } from "@/lib/types";

// Pride (2026-11-05, migration 142): two abilities, one a day.
//   200 — today's Outreach becomes a global chat only Pride can write in.
//   100 — Pride can't be imprisoned at today's consultation.
export function PrideAction({ myPlayer }: { myPlayer: Player }) {
  return (
    <PowerAction
      myPlayer={myPlayer}
      title="Pride"
      blurb="Take over today's Outreach: it becomes one global chat that everyone reads and only you can write in — nobody talks privately, and your messages show as “Pride”, never your name. Or make yourself untouchable: you can't be imprisoned at today's consultation."
      options={[
        {
          power: "pride_broadcast",
          label: "Take over Outreach",
          cost: 200,
          done: "Today's Outreach is yours: everyone will read what you write, and nobody else can speak.",
        },
        {
          power: "pride_shield",
          label: "Can't be imprisoned today",
          cost: 100,
          done: "Nobody can imprison you at today's consultation.",
        },
      ]}
    />
  );
}
