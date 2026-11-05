"use client";

import { PowerAction } from "./PowerAction";
import type { Player } from "@/lib/types";

// Diligence (2026-11-05, migration 142): for 100 SE in the role phase, he sees
// in today's courtroom whether every exhibit and counterproof is genuine or
// forged, the moment it's filed.
export function DiligenceAction({ myPlayer }: { myPlayer: Player }) {
  return (
    <PowerAction
      myPlayer={myPlayer}
      title="Diligence"
      blurb="Scrutinise today's trial: every piece of proof and counterproof filed in the courtroom shows you whether it is genuine or forged, the moment it's filed. Nobody else knows you can see it."
      options={[
        {
          power: "diligence",
          label: "Scrutinise today's trial",
          cost: 100,
          done: "In today's courtroom you'll see which proof is genuine and which is forged.",
        },
      ]}
    />
  );
}
