"use client";

import { useEffect, useState } from "react";
import { vengeanceRevengeTargets, queueVengeanceRevenge } from "@/lib/game";
import type { Player, Room } from "@/lib/types";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { MapMultiPick, type MapMultiRole } from "@/components/castle/MapMultiPick";
import { HAMMER_CURSOR, HammerIcon } from "@/components/castle/tools";

const COST_PER_TARGET = 150;

const REVENGE: MapMultiRole = {
  title: "Vengeance",
  tint: "#f6b48c",
  accent: "#f0782e",
  button: ["#c4521a", "#7a2e0a"],
  cursor: HAMMER_CURSOR,
  Icon: HammerIcon,
  costPer: COST_PER_TARGET,
  pickVerb: "Take revenge",
  unpickVerb: "Spare them",
  menuNote: "Voted to jail you.",
  commitLabel: (n) => `Take ${n || "no"} jailer${n === 1 ? "" : "s"}`,
  busyLabel: "Sealing…",
  outcome: (names, n) =>
    `You'll take ${names} when this phase ends, unless Justice protects ${n > 1 ? "any of them" : "them"}.`,
  actedLine: "You already acted today.",
  clip: clipForAbility("vengeance", "revenge"),
};

// Shown by RoleAction when Vengeance is imprisoned. On the castle map she
// stands in the Dungeon; EVERY player who voted to jail her (the room
// remembers them for the whole game) stands out, everyone else is dimmed.
// She may take as many jailers as she can pay for — 150 SE each, picked one by
// one with the hammer and sealed in one go (migration 113). Justice protect
// can still spare any individual target, and extra lives still absorb, since
// it resolves through the normal kill pass.
//
// The jailer list comes from the server and is gated on vv_is_me, so nobody
// else can read it — or work out who Vengeance is by asking.
export function VengeanceRevengeAction({
  myPlayer,
  players,
  room,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
}) {
  const [jailers, setJailers] = useState<{ id: string; name: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    vengeanceRevengeTargets(myPlayer.id).then((t) => {
      if (!cancelled) setJailers(t);
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer.id]);

  const jailerIds = new Set((jailers ?? []).map((j) => j.id));

  // Queued: pending_target holds a JSON array of ids (same shape as
  // Sacrifice); an older single id is tolerated. 'kill' is also accepted: a
  // revenge queued before migration 113 deployed used that action.
  let queuedIds: string[] = [];
  if (
    myPlayer.acted_this_day &&
    (myPlayer.pending_action === "vengeance_kill" || myPlayer.pending_action === "kill") &&
    myPlayer.pending_target
  ) {
    try {
      const parsed = JSON.parse(myPlayer.pending_target);
      queuedIds = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      queuedIds = [myPlayer.pending_target];
    }
  }

  const n = jailers?.length ?? 0;
  return (
    <MapMultiPick
      role={REVENGE}
      myPlayer={myPlayer}
      players={players}
      room={room}
      prompt={`You remember every hand that put you here. Your ${n === 1 ? "jailer stands" : `${n} jailers stand`} out on the map: take as many as you can pay for, ${COST_PER_TARGET} Soul Energy each.`}
      canTarget={(p) => jailerIds.has(p.id)}
      dimUnpickable
      queuedIds={queuedIds}
      blockedLine={
        jailers === null
          ? "Finding your jailers…"
          : jailers.length === 0
            ? "None of your jailers are still alive."
            : null
      }
      commit={async (ids) => {
        const res = await queueVengeanceRevenge(myPlayer.id, ids);
        if (res.ok) return { ok: true };
        return {
          ok: false,
          message:
            res.reason === "insufficient_se"
              ? "Not enough Soul Energy for that many."
              : res.reason === "already_acted"
                ? "You already acted today."
                : "Those targets are no longer valid.",
        };
      }}
    />
  );
}
