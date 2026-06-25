"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { getRole } from "@/lib/roles";
import type { Player } from "@/lib/types";
import { RoleIcon } from "../RoleIcon";
import { AbilityPanel, ParchmentCard, CostLine, TargetList } from "./ui";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";

const CERTAINTY_COST = 125;

// Certainty: pick a single player, reveal their specific role (and
// the camp it belongs to). Flat cost of 125 Soul Energy. Self is
// excluded from the picker.
export function CertaintyAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [pickedTarget, setPickedTarget] = useState<Player | null>(null);
  const [revealedRole, setRevealedRole] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { play } = useAbilityAnimation();

  const alreadyUsed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= CERTAINTY_COST;

  async function pickTarget(target: Player) {
    if (alreadyUsed || busy || !canAfford) return;
    setBusy(true);
    try {
      // The reveal happens in the database (reveal_role): it verifies we
      // are Certainty, spends the SE, and returns only the target's role.
      const { data, error } = await supabase.rpc("reveal_role", {
        p_player_id: myPlayer.id,
        p_target_id: target.id,
      });
      if (!error && data) {
        const roleId = data as string;
        // Card-flip reveal of the chosen target's actual role card, then the
        // inline result card below it.
        await play("certainty", {
          params: {
            role: roleId,
            roleName: getRole(roleId)?.name ?? "Unknown",
            targetName: target.name,
          },
        });
        setPickedTarget(target);
        setRevealedRole(roleId);
      }
    } finally {
      setBusy(false);
    }
  }

  // Result view: show the target's specific role + camp.
  if (pickedTarget) {
    const role = getRole(revealedRole);
    const isVice = role?.camp === "vice";
    return (
      <ParchmentCard kicker={`Certainty — ${pickedTarget.name}`}>
        {role ? (
          <div className="mt-3 flex items-center gap-3">
            <RoleIcon
              roleId={role.id}
              camp={role.camp}
              className="h-12 w-12"
            />
            <span>
              <span className="block text-xs uppercase tracking-wide text-home-bg/60">
                Their role
              </span>
              <span className="block text-2xl font-semibold leading-tight">
                {role.name}
              </span>
              <span className="block text-xs text-home-bg/60">
                {isVice ? "Vice" : "Virtue"} &middot; Tier {role.tier}
              </span>
            </span>
          </div>
        ) : (
          <p className="mt-3 text-sm text-home-bg/60 italic">
            Could not determine their role.
          </p>
        )}
      </ParchmentCard>
    );
  }

  // Picker view: choose a player to inspect.
  const targets = players.filter((p) => p.id !== myPlayer.id);

  return (
    <AbilityPanel title="Certainty">
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to reveal their exact role.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={CERTAINTY_COST} />

      {alreadyUsed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Certainty today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <TargetList targets={targets} onPick={pickTarget} disabled={busy} />
      )}
    </AbilityPanel>
  );
}
