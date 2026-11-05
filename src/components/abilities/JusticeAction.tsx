"use client";

import { PowerAction } from "./PowerAction";
import type { Player } from "@/lib/types";

// Justice (2026-11-05, migration 142): for 100 SE in the role phase, arm the
// day's verdict. If he is a prosecutor of today's defendant (he pressed or
// backed a charge against them) and votes Guilty, and the defendant is a Vice,
// the defendant goes to prison whatever the count.
export function JusticeAction({ myPlayer }: { myPlayer: Player; players?: Player[] }) {
  return (
    <PowerAction
      myPlayer={myPlayer}
      title="Justice"
      blurb="Arm today's verdict. If you're a prosecutor in today's trial — you pressed or backed a charge against the defendant — and you vote Guilty, a Vice defendant goes to prison whatever the rest of the court votes."
      options={[
        {
          power: "justice",
          label: "Arm today's verdict",
          cost: 100,
          done: "Your verdict is armed: prosecute, vote Guilty, and a Vice defendant goes to prison.",
        },
      ]}
    />
  );
}
