"use client";

import { useState } from "react";
import { sociabilityMute } from "@/lib/game";
import type { Player } from "@/lib/types";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { SoulEnergyText } from "@/components/ui/royal";
import { AbilityPanel, ParchmentCard, CostLine } from "./ui";

const COST_PER_TARGET = 75;

// Sociability (virtue, Communicator) — migration 115.
//
// PASSIVE: the one-partner-per-cycle Outreach lock doesn't apply to her, so she
// may write to everyone every night (enforced in send_dm, not just here).
// ACTIVE: 75 SE per player to silence them for the rest of the day, several at
// once. A target holding a Communication potion is immune, and she is NOT told
// which one held — so the potion stays a real counter rather than a tell.
export function SociabilityAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { play } = useAbilityAnimation();

  const alreadyActed = myPlayer.acted_this_day;
  const cost = selectedIds.length * COST_PER_TARGET;
  const affordable = Math.floor(myPlayer.soul_energy / COST_PER_TARGET);
  const canAfford = cost > 0 && cost <= myPlayer.soul_energy;

  const targets = players.filter((p) => p.id !== myPlayer.id && !p.dead);

  function toggle(id: string) {
    setError(null);
    setSelectedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  async function commit() {
    if (!selectedIds.length || alreadyActed || busy || !canAfford) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sociabilityMute(myPlayer.id, selectedIds);
      if (!res.ok) {
        setError(
          res.reason === "insufficient_se"
            ? "Not enough Soul Energy for that many."
            : res.reason === "already_acted"
              ? "You already acted today."
              : "Those targets aren't valid."
        );
        return;
      }
      await play(clipForAbility("sociability"));
    } catch {
      setError("Couldn't do that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const passive = (
    <p className="mt-2 rounded-lg border border-soul/30 bg-soul/10 px-3 py-2 text-xs text-cream/85">
      <strong>Always on:</strong> the one-person Outreach limit doesn&rsquo;t
      apply to you. Write to everyone, every night.
    </p>
  );

  if (alreadyActed) {
    return (
      <ParchmentCard kicker="Sociability — done">
        <p className="mt-2">
          The words are taken. Anyone you silenced stays quiet for the rest of
          today.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Sociability">
      {passive}
      <p className="mt-3 text-sm text-cream/80">
        Silence players for the rest of the day &mdash; 75 each, as many as you
        can afford. They can still read; they just can&rsquo;t speak.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={cost || COST_PER_TARGET} />

      <p className="mt-3 text-xs text-cream/60">
        You can afford {affordable} of {targets.length}.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {targets.map((t) => {
          const sel = selectedIds.includes(t.id);
          return (
            <li key={t.id}>
              <button
                onClick={() => toggle(t.id)}
                disabled={busy}
                className={
                  "flex w-full items-center justify-between rounded-lg border px-4 py-2 text-left shadow-[0_2px_8px_rgba(0,0,0,.25)] transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-0.5 disabled:opacity-50 " +
                  (sel
                    ? "border-gold bg-gold text-home-bg shadow-[0_0_12px_rgba(227,181,16,.5)]"
                    : "border-gold bg-cream text-home-bg")
                }
              >
                <span>{t.name}</span>
                {sel && <span className="text-sm font-bold">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        onClick={commit}
        disabled={!selectedIds.length || !canAfford || busy}
        className="mt-3 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.35)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_22px_rgba(227,181,16,.55)] disabled:opacity-40"
      >
        {busy ? "Hushing…" : "Silence "}
        {!busy && (
          <>
            {selectedIds.length || "no"} player
            {selectedIds.length === 1 ? "" : "s"}
            {cost > 0 ? (
              <SoulEnergyText onLight>{` (${cost} SE)`}</SoulEnergyText>
            ) : null}
          </>
        )}
      </button>

      {selectedIds.length > 0 && !canAfford && (
        <p className="mt-2 text-sm text-red-300 italic">
          Not enough Soul Energy ({cost} needed).
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-300 italic">{error}</p>}
    </AbilityPanel>
  );
}
