"use client";

import { useEffect, useState } from "react";
import { convertPlayer, relinquishFollower, myFollowerCount } from "@/lib/game";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player, Room } from "@/lib/types";
import {
  MapRoleButton,
  MapTargetAbility,
  type MapTargetRole,
} from "@/components/castle/MapTargetAbility";
import { FLAME_CURSOR, FlameIcon } from "@/components/castle/tools";

const CONVERT_COST = 250;
const RELINQUISH_COST = 100;

const WRATH: MapTargetRole = {
  title: "Wrath",
  tint: "#dcb0ff",
  accent: "#c05cff",
  button: ["#7a26b0", "#330d4f"],
  cursor: FLAME_CURSOR,
  Icon: FlameIcon,
  // Conversion only lands on an active target (the server rejects dead /
  // imprisoned / hospitalised), so the rest are dimmed.
  canTarget: (p) => !p.in_prison && !p.in_hospital,
  prompt:
    "Pick someone to corrupt into your Worshipper. It only takes hold on a Virtue who isn't S-tier, but your offering is spent either way.",
  actions: [
    {
      verb: "Corrupt",
      doing: "corrupt someone",
      cost: CONVERT_COST,
      // The corruption clip is played by AbilityOutcomeWatcher only if it
      // takes hold (resolved at end of role-action), not on tap.
      clip: null,
      perform: async (me, target, name) =>
        (await convertPlayer(me.id, target.id)).ok
          ? { ok: true }
          : { ok: false, avoid: true, message: `You can't corrupt ${name}. Pick someone else.` },
      outcome: (name) =>
        `Your corruption is set on ${name}. It takes hold when this phase ends, and you'll be told whether it worked.`,
    },
  ],
};

// Wrath (one ability per day): corrupt a Virtue into a Vice Worshipper bound to
// you as a follower (250 — charged even if the target wasn't a Virtue), picked
// on the castle map with a flame; OR give up one of your living followers for
// a lasting extra life (100) — untargeted, so it's a button under the map.
export function WrathAction({
  myPlayer,
  players,
  room,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
}) {
  const { play } = useAbilityAnimation();
  const [busy, setBusy] = useState(false);
  const [doneLine, setDoneLine] = useState<string | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    myFollowerCount(myPlayer.id).then((n) => {
      if (alive) setFollowers(n);
    });
    return () => {
      alive = false;
    };
  }, [myPlayer.id]);

  async function relinquish() {
    if (busy) return;
    setBusy(true);
    try {
      if (await relinquishFollower(myPlayer.id)) {
        setDoneLine("You consumed a follower's life for a lasting extra life.");
        setFollowers((n) => (n === null ? n : Math.max(0, n - 1)));
        await play(clipForAbility("wrath", "relinquish"));
      }
    } finally {
      setBusy(false);
    }
  }

  const below =
    myPlayer.acted_this_day || doneLine || followers === null ? null : followers < 1 ? (
      <p className="text-center text-xs text-cream/60">
        Once you have followers, you can give one up here for a lasting extra life.
      </p>
    ) : (
      <MapRoleButton
        role={WRATH}
        label="Relinquish a follower"
        cost={RELINQUISH_COST}
        onClick={relinquish}
        disabled={busy || myPlayer.soul_energy < RELINQUISH_COST}
        hint={`You have ${followers} follower${followers === 1 ? "" : "s"}. One dies, and you gain a lasting extra life.`}
      />
    );

  return (
    <MapTargetAbility
      role={WRATH}
      myPlayer={myPlayer}
      players={players}
      room={room}
      doneLine={doneLine}
      below={below}
    />
  );
}
