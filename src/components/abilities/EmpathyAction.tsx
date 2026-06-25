"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { revealCamp } from "@/lib/game";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player } from "@/lib/types";
import {
  AbilityPanel,
  ParchmentCard,
  CostLine,
  TargetList,
  AbilityOption,
  BackButton,
} from "./ui";
import { SoulEnergyText } from "@/components/ui/royal";

const VOTERS_COST = 150;
const CAMP_COST = 100;

// Empathy has two abilities (one use per day):
//   * Reveal who voted for each player in the last consultation (150 SE).
//   * Reveal a single player's camp — Vice or Virtue (100 SE).
export function EmpathyAction({
  myPlayer,
  players,
  day,
}: {
  myPlayer: Player;
  players: Player[];
  day: number;
}) {
  const [mode, setMode] = useState<"voters" | "camp" | null>(null);
  const { play } = useAbilityAnimation();
  const [revealedData, setRevealedData] = useState<
    { target_id: string; voter_ids: string[] }[] | null
  >(null);
  const [campResult, setCampResult] = useState<{
    name: string;
    camp: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const alreadyUsed = myPlayer.acted_this_day;
  const nameOf = (id: string) =>
    players.find((p) => p.id === id)?.name ?? "?";

  async function revealVoters() {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc("reveal_votes_empathy", {
        p_player_id: myPlayer.id,
      });
      await play(clipForAbility("empathy"));
      setRevealedData(
        (data as { target_id: string; voter_ids: string[] }[]) ?? []
      );
    } finally {
      setBusy(false);
    }
  }

  async function revealOneCamp(target: Player) {
    if (busy) return;
    setBusy(true);
    try {
      const camp = await revealCamp(myPlayer.id, target.id);
      await play(clipForAbility("empathy"));
      if (camp) setCampResult({ name: target.name, camp });
    } finally {
      setBusy(false);
    }
  }

  // Result: vote map.
  if (revealedData) {
    return (
      <ParchmentCard kicker="Empathy — last consultation">
        {revealedData.length === 0 ? (
          <p className="mt-3 text-sm text-home-bg/60 italic">
            No one received any votes in the last consultation.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {revealedData.map(({ target_id, voter_ids }) => (
              <li
                key={target_id}
                className="rounded-lg border border-home-bg/10 bg-home-bg/5 px-3 py-2"
              >
                <p className="text-sm font-semibold">
                  Voters for {nameOf(target_id)}
                </p>
                <p className="mt-1 text-sm text-home-bg/80">
                  {voter_ids.map(nameOf).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ParchmentCard>
    );
  }

  // Result: one player's camp.
  if (campResult) {
    return (
      <ParchmentCard kicker={`Empathy — ${campResult.name}`}>
        <p className="mt-3 text-2xl font-semibold">
          {campResult.camp === "vice" ? "Vice" : "Virtue"}
        </p>
        <p className="mt-1 text-xs text-home-bg/60">Their camp.</p>
      </ParchmentCard>
    );
  }

  if (alreadyUsed) {
    return (
      <AbilityPanel title="Empathy">
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Empathy today.
        </p>
      </AbilityPanel>
    );
  }

  // Mode chooser.
  if (mode === null) {
    return (
      <AbilityPanel title="Empathy">
        <p className="mt-2 text-sm text-cream/80">
          Choose your ability for today.
        </p>
        <CostLine have={myPlayer.soul_energy} />
        <div className="mt-4 flex flex-col gap-2">
          <AbilityOption
            onClick={() => setMode("voters")}
            disabled={day === 1 || myPlayer.soul_energy < VOTERS_COST}
            cost={VOTERS_COST}
          >
            Reveal who voted for each player last consultation
          </AbilityOption>
          <AbilityOption
            onClick={() => setMode("camp")}
            disabled={myPlayer.soul_energy < CAMP_COST}
            cost={CAMP_COST}
          >
            Reveal one player&rsquo;s camp
          </AbilityOption>
        </div>
        {day === 1 && (
          <p className="mt-2 text-xs text-cream/60 italic">
            Vote reveal is available from day 2.
          </p>
        )}
      </AbilityPanel>
    );
  }

  if (mode === "voters") {
    return (
      <AbilityPanel title="Empathy">
        <p className="mt-2 text-sm text-cream/80">
          Reveal, for every player, who voted to imprison them last
          consultation.
        </p>
        <div className="mt-4">
          <AbilityOption
            onClick={revealVoters}
            disabled={busy || myPlayer.soul_energy < VOTERS_COST}
            cost={VOTERS_COST}
          >
            <span className="font-semibold">
              {busy ? "Revealing…" : "Reveal votes"}
            </span>
          </AbilityOption>
        </div>
        <BackButton onClick={() => setMode(null)} disabled={busy} />
      </AbilityPanel>
    );
  }

  // mode === "camp": pick a target.
  const targets = players.filter((p) => p.id !== myPlayer.id);
  return (
    <AbilityPanel title="Empathy">
      <p className="mt-2 text-sm text-cream/80">
        <SoulEnergyText>Pick a player to reveal their camp (100 SE).</SoulEnergyText>
      </p>
      <TargetList targets={targets} onPick={revealOneCamp} disabled={busy} />
      <BackButton onClick={() => setMode(null)} disabled={busy} />
    </AbilityPanel>
  );
}
