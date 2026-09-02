"use client";

import { useEffect, useState } from "react";
import { vengeanceRevengeTargets, queueVengeanceRevenge } from "@/lib/game";
import type { Player } from "@/lib/types";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { SoulEnergyText } from "@/components/ui/royal";
import { AbilityPanel, ParchmentCard, CostLine } from "./ui";

const COST_PER_TARGET = 150;

// Shown by RoleAction when Vengeance is imprisoned. She sees EVERY player who
// voted to jail her (the room remembers them for the whole game) and may take
// as many of them as she can pay for — 150 SE each, picked in one go
// (migration 113). Justice protect can still spare any individual target, and
// extra lives still absorb, since it resolves through the normal kill pass.
//
// The jailer list comes from the server and is gated on vv_is_me, so nobody
// else can read it — or work out who Vengeance is by asking.
export function VengeanceRevengeAction({ myPlayer }: { myPlayer: Player }) {
  const [targets, setTargets] = useState<
    { id: string; name: string }[] | null
  >(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { play } = useAbilityAnimation();
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const cost = selectedIds.length * COST_PER_TARGET;
  const affordable = Math.floor(myPlayer.soul_energy / COST_PER_TARGET);
  const canAfford = cost > 0 && cost <= myPlayer.soul_energy;

  useEffect(() => {
    let cancelled = false;
    vengeanceRevengeTargets(myPlayer.id).then((t) => {
      if (!cancelled) setTargets(t);
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer.id]);

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
      const res = await queueVengeanceRevenge(myPlayer.id, selectedIds);
      if (!res.ok) {
        setError(
          res.reason === "insufficient_se"
            ? "Not enough Soul Energy for that many."
            : res.reason === "already_acted"
              ? "You already acted today."
              : "Those targets are no longer valid."
        );
        return;
      }
      await play(clipForAbility("vengeance", "revenge"));
    } catch {
      setError("Couldn't queue that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Queued state. pending_target holds a JSON array of ids (same shape as
  // Sacrifice); older single-id rows are tolerated so a mid-game upgrade
  // doesn't render blank.
  // 'kill' is also accepted: a revenge queued before migration 113 deployed
  // used that action, and Vengeance has no other kill of her own, so a game in
  // flight during the deploy still shows its queued panel instead of blanking.
  if (
    alreadyActed &&
    (myPlayer.pending_action === "vengeance_kill" ||
      myPlayer.pending_action === "kill") &&
    myPlayer.pending_target
  ) {
    const nameOf = (id: string) =>
      targets?.find((x) => x.id === id)?.name ?? "your target";
    let names: string[];
    try {
      names = (JSON.parse(myPlayer.pending_target) as string[]).map(nameOf);
    } catch {
      names = [nameOf(myPlayer.pending_target)];
    }
    return (
      <ParchmentCard kicker="Vengeance — queued">
        <p className="mt-2">
          You will take <strong>{names.join(", ")}</strong> &mdash; Justice&rsquo;s
          protect can still spare {names.length > 1 ? "any of them" : "them"}.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <AbilityPanel title="Vengeance — imprisoned">
      <p className="mt-2 text-sm text-cream/80">
        You are behind bars, but you remember every hand that put you here.
        Spend 150 per jailer &mdash; take as many as you can afford. Justice
        protect can still save any one of them.
      </p>
      <CostLine have={myPlayer.soul_energy} cost={cost || COST_PER_TARGET} />

      {targets === null ? (
        <p className="mt-4 text-sm text-cream/60 italic">Checking&hellip;</p>
      ) : targets.length === 0 ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          None of your jailers are still alive.
        </p>
      ) : alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : (
        <>
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
            {busy ? "Sealing…" : "Take "}
            {!busy && (
              <>
                {selectedIds.length || "no"} jailer
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
          {error && (
            <p className="mt-2 text-sm text-red-300 italic">{error}</p>
          )}
        </>
      )}
    </AbilityPanel>
  );
}
