"use client";

import { useState, type ReactNode } from "react";
import { instantSacrificeServer, queueAction } from "@/lib/game";
import type { Room, Player } from "@/lib/types";
import { heading, CornerFrame, SoulCost, SoulEnergyText } from "@/components/ui/royal";
import { AbilityPanel, ParchmentCard } from "./ui";

// Sacrifice acts in two contexts:
//   - mode="queued" (role-action): queued, resolved at end of phase, Justice
//     protect can spare any of you.
//   - mode="instant" (consultation): immediate, no protect.
// The first target is free; each additional target costs 200 SE (charged when
// the sacrifice is committed). Cannot be used while imprisoned.
const EXTRA_COST = 200;

export function SacrificeAction({
  myPlayer,
  players,
  room,
  mode,
}: {
  myPlayer: Player;
  players: Player[];
  room: Room;
  mode: "queued" | "instant";
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);
  const extraCost = Math.max(0, selectedIds.length - 1) * EXTRA_COST;
  const canAfford = myPlayer.soul_energy >= extraCost;
  const nameOf = (id: string) =>
    players.find((p) => p.id === id)?.name ?? "?";

  function toggle(id: string) {
    setSelectedIds((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
    );
  }

  async function confirm() {
    if (selectedIds.length === 0 || alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      if (mode === "queued") {
        await queueAction(
          myPlayer.id,
          extraCost,
          myPlayer.soul_energy,
          "sacrifice",
          JSON.stringify(selectedIds)
        );
      } else {
        await instantSacrificeServer(room.id, myPlayer.id, selectedIds);
      }
    } finally {
      setBusy(false);
    }
  }

  // Cannot use while imprisoned.
  if (myPlayer.in_prison) {
    return (
      <AbilityPanel title="Sacrifice">
        <p className="mt-4 text-sm text-cream/60 italic">
          You cannot sacrifice while imprisoned.
        </p>
      </AbilityPanel>
    );
  }

  // Queued "already queued" display.
  if (
    mode === "queued" &&
    alreadyActed &&
    myPlayer.pending_action === "sacrifice" &&
    myPlayer.pending_target
  ) {
    let names: string[] = [];
    try {
      names = (JSON.parse(myPlayer.pending_target) as string[]).map(nameOf);
    } catch {
      names = [nameOf(myPlayer.pending_target)];
    }
    return (
      <ParchmentCard kicker="Sacrifice — queued">
        <p className="mt-2">
          You will die together with <strong>{names.join(", ")}</strong> at the
          end of this phase.
        </p>
        <p className="mt-2 text-xs text-home-bg/60">
          Protection can spare any of you.
        </p>
      </ParchmentCard>
    );
  }

  // Confirm step — the point of no return reads hellish burgundy in both
  // contexts.
  if (confirming) {
    const names = selectedIds.map(nameOf);
    return (
      <SacrificePanel grim>
        <p className="mt-2 text-sm text-cream/80">
          You and <strong>{names.join(", ")}</strong> will all die{" "}
          {mode === "queued" ? "at the end of this phase" : "right now"}. This
          cannot be undone.
          {extraCost > 0 && (
            <span className="mt-1 block text-xs text-cream/60">
              Extra kills cost <SoulCost value={extraCost} />.
            </span>
          )}
          {mode === "instant" && (
            <span className="mt-1 block text-xs text-cream/60">
              No Justice protect can block this (acted outside role-action).
            </span>
          )}
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={confirm}
            disabled={busy}
            className="flex-1 rounded-lg bg-consultation-bg py-2 font-semibold text-cream shadow-[0_0_12px_rgba(128,0,32,.55)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_18px_rgba(128,0,32,.75)] disabled:opacity-50"
          >
            {busy ? "Confirming…" : "Yes, sacrifice"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="flex-1 rounded-lg border border-gold py-2 font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </SacrificePanel>
    );
  }

  // Pick step (multi-select).
  return (
    <SacrificePanel grim={mode === "instant"}>
      <p className="mt-2 text-sm text-cream/80">
        Pick the players to die with you
        {mode === "queued" ? " at the end of this phase" : " immediately"}. The
        first is free; each extra costs <SoulCost value={EXTRA_COST} />.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        <SoulEnergyText>Soul Energy</SoulEnergyText>: <SoulCost value={myPlayer.soul_energy} label="" /> &middot;
        extra cost: <SoulCost value={extraCost} label="" />
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already acted today.
        </p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {targets.map((p) => {
              const sel = selectedIds.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => toggle(p.id)}
                    className={
                      "flex w-full items-center justify-between rounded-lg border px-4 py-2 text-left shadow-[0_2px_8px_rgba(0,0,0,.25)] transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-0.5 " +
                      (sel
                        ? "border-gold bg-gold text-home-bg shadow-[0_0_12px_rgba(227,181,16,.5)]"
                        : "border-gold bg-cream text-home-bg")
                    }
                  >
                    <span>
                      {p.name}
                      {p.in_prison && (
                        <span className="ml-2 text-xs opacity-60">
                          (in prison)
                        </span>
                      )}
                    </span>
                    {sel && <span className="text-sm font-bold">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            onClick={() => setConfirming(true)}
            disabled={selectedIds.length === 0 || !canAfford}
            className="mt-3 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg shadow-[0_0_14px_rgba(227,181,16,.35)] transition-[opacity,box-shadow] hover:opacity-90 hover:shadow-[0_0_22px_rgba(227,181,16,.55)] disabled:opacity-40"
          >
            Sacrifice with {selectedIds.length} player
            {selectedIds.length === 1 ? "" : "s"}
            {extraCost > 0 ? <SoulEnergyText onLight>{` (${extraCost} SE)`}</SoulEnergyText> : ""}
          </button>
          {selectedIds.length > 1 && !canAfford && (
            <p className="mt-2 text-sm text-red-300 italic">
              Not enough Soul Energy for {selectedIds.length - 1} extra kill
              {selectedIds.length - 1 === 1 ? "" : "s"}.
            </p>
          )}
        </>
      )}
    </SacrificePanel>
  );
}

// Sacrifice renders in two stages (Reflection purple when queued, the cream
// consultation room when instant), so it keeps its own plaque: enchanted
// purple normally, a hellish dark burgundy when `grim` (instant pick /
// the confirm step).
function SacrificePanel({ grim, children }: { grim?: boolean; children: ReactNode }) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-xl border-2 p-5 text-cream " +
        (grim ? "border-[#b3445c]/60" : "border-[#7678ed]/40")
      }
      style={{
        background: grim ? "rgba(58,8,20,.92)" : "rgba(25,15,46,.85)",
        boxShadow: grim
          ? "0 6px 18px rgba(0,0,0,.4), 0 0 16px rgba(128,0,32,.4)"
          : "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(118,120,237,.18)",
      }}
    >
      <CornerFrame colorClass={grim ? "border-[#e6889a]/50" : "border-[#7678ed]/60"} />
      <p
        className={`relative text-sm uppercase tracking-widest ${heading} ${
          grim ? "text-[#e6889a]" : "text-[#a9aaf0]"
        }`}
      >
        Sacrifice
      </p>
      <div className="relative">{children}</div>
    </div>
  );
}
