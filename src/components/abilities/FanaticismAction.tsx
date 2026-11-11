"use client";

import { useEffect, useState } from "react";
import { plantBomb, fanaticState } from "@/lib/game";
import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { BOMB_CURSOR, BombIcon } from "@/components/castle/tools";

const PLANT_COST = 50;

// Fanaticism, role-action (migration 072): plant a bomb on a player on the
// castle map (50 SE, up to 2 per game). It lands straight away; from tomorrow
// the holder must pass it on. Nobody in the Dungeon or Infirmary can take one.
// Two bombs per game (rooms.bombs_planted); fanatic_state counts them.
// Checking carriers + detonating happen in the shop phase (FanaticismShop).
export function FanaticismAction({
  myPlayer,
  players,
  room,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
}) {
  const [counts, setCounts] = useState<{ remaining: number; active: number } | null>(null);
  // Bumped after a plant, so the counts are read again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    fanaticState(myPlayer.id).then((s) => {
      if (!alive || !s.ok) return;
      setCounts({ remaining: s.remaining ?? 0, active: s.active ?? 0 });
    });
    return () => {
      alive = false;
    };
  }, [myPlayer.id, version]);

  const role: MapTargetRole = {
    title: "Fanaticism",
    tint: "#ffe08a",
    accent: "#ffcf3a",
    button: ["#3d3550", "#16111f"],
    cursor: BOMB_CURSOR,
    Icon: BombIcon,
    canTarget: (p) => !p.in_prison && !p.in_hospital,
    prompt:
      "Plant a bomb on someone outside the Dungeon and Infirmary. From tomorrow they must pass it on each day; you can detonate it in the shop.",
    actions: [
      {
        verb: "Plant",
        doing: "plant a bomb",
        actionLabel: (name) => `Plant a bomb on ${name}`,
        cost: PLANT_COST,
        clip: clipForAbility("fanaticism", "plant"),
        perform: async (me, target, name) => {
          const res = await plantBomb(me.id, target.id);
          if (res.ok) {
            setVersion((v) => v + 1);
            return { ok: true };
          }
          return {
            ok: false,
            avoid: true,
            message:
              res.reason === "already_holding"
                ? `${name} already carries a bomb. Pick someone else.`
                : `The bomb couldn't be planted on ${name}. Pick someone else.`,
          };
        },
        outcome: (name) => `You planted a bomb on ${name}. From tomorrow they must pass it on.`,
      },
    ],
  };

  const inPlay = !counts
    ? ""
    : counts.active === 0
      ? "None are in play yet."
      : counts.active === 1
        ? "1 is in play."
        : `${counts.active} are in play.`;
  const status =
    counts && counts.remaining > 0
      ? `You can plant ${counts.remaining} more bomb${counts.remaining === 1 ? "" : "s"} this game. ${inPlay}`
      : counts
        ? inPlay
        : null;
  const unavailable =
    counts && counts.remaining < 1
      ? "You've planted both your bombs. Check on them or detonate one in the shop."
      : null;

  return (
    <MapTargetAbility
      role={role}
      myPlayer={myPlayer}
      players={players}
      room={room}
      status={status}
      unavailable={unavailable}
    />
  );
}
