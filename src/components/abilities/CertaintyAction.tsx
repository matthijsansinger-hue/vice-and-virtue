"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { getRole, ROLE_CLASSES } from "@/lib/roles";
import type { Player, Room } from "@/lib/types";
import { RoleIcon } from "../RoleIcon";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { MapTargetAbility, type MapTargetRole } from "@/components/castle/MapTargetAbility";
import { LENS_CURSOR, LensIcon } from "@/components/castle/tools";

const CERTAINTY_COST = 125;

// Certainty: pick a single player on the castle map with a magnifying glass,
// reveal their specific role (and its camp). Flat 125 Soul Energy. The dead
// can be read too, so her map shows them as ghosts in the Chapel. After the
// reveal the target wears their role's head instead of the glass.
export function CertaintyAction({
  myPlayer,
  players,
  room,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const { play } = useAbilityAnimation();
  const def = getRole(revealed);
  const campWord = def
    ? def.camp === "vice"
      ? "a Vice"
      : def.camp === "virtue"
        ? "a Virtue"
        : "in neither camp"
    : "";

  const role: MapTargetRole = {
    title: "Certainty",
    tint: "#c4e7ff",
    accent: "#8fd3ff",
    button: ["#2f7fb3", "#123a57"],
    cursor: LENS_CURSOR,
    Icon: LensIcon,
    prompt: "Pick someone to see their exact role. The dead lie in the Chapel, and you can read theirs too.",
    actedLine: "You already used Certainty today.",
    actions: [
      {
        verb: "Reveal",
        doing: "reveal a role",
        actionLabel: (name) => `Reveal ${name}'s role`,
        cost: CERTAINTY_COST,
        // The card-flip clip needs the revealed role, so perform plays it.
        clip: null,
        perform: async (me, target, name) => {
          // The reveal happens in the database (reveal_role): it verifies we
          // are Certainty, spends the SE, and returns only the target's role.
          const { data, error } = await supabase.rpc("reveal_role", {
            p_player_id: me.id,
            p_target_id: target.id,
          });
          if (error || !data) {
            return { ok: false, message: `Couldn't read ${name}'s role. Try again.` };
          }
          const roleId = data as string;
          setRevealed(roleId);
          await play("certainty", {
            params: {
              role: roleId,
              roleName: getRole(roleId)?.name ?? "Unknown",
              targetName: name,
            },
          });
          return { ok: true };
        },
        outcome: (name) =>
          def ? `${name} is the ${def.name}, ${campWord}.` : `You read ${name}'s role.`,
      },
    ],
  };

  return (
    <MapTargetAbility
      role={role}
      myPlayer={myPlayer}
      players={players}
      room={room}
      showDead
      markIcon={
        def ? <RoleIcon roleId={def.id} camp={def.camp} className="h-full w-full" /> : undefined
      }
      status={
        def ? (
          <span className="mt-1 flex items-center gap-2">
            <RoleIcon roleId={def.id} camp={def.camp} className="h-9 w-9" />
            <span>
              <span className="block text-sm font-semibold text-cream">{def.name}</span>
              <span className="block">
                {def.camp === "vice" ? "Vice" : def.camp === "virtue" ? "Virtue" : "Anomaly"}
                {def.roleClass ? `, ${ROLE_CLASSES[def.roleClass].label}` : ""}
              </span>
            </span>
          </span>
        ) : undefined
      }
    />
  );
}
