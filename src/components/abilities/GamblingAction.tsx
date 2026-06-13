"use client";

import { useEffect, useState } from "react";
import { gamblingRoll, gamblingPickTarget, type GambleKind } from "@/lib/game";
import type { Player } from "@/lib/types";

const COST = 100;

// Gambling: roll one die (100 SE); the face decides the ability. Faces 4 and 6
// (hospitalise / kill someone) prompt for a target AFTER the roll. The roll is
// server-authoritative and charges SE immediately, so it can't be retried for a
// better outcome — a true gamble. One roll per day.
export function GamblingAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    roll: number;
    kind: GambleKind;
    needsTarget: boolean;
  } | null>(null);
  const [picked, setPicked] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= COST;
  const targets = players.filter((p) => !p.dead && p.id !== myPlayer.id);
  const PENDING_KEY = `vv_gambling_pick_${myPlayer.id}`;

  // If you rolled a 4/6 and refreshed before naming a target, restore the
  // target prompt so the roll isn't wasted (the server still owes the pick).
  useEffect(() => {
    if (!alreadyActed || result) return;
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { roll: number; kind: GambleKind };
        setResult({ roll: p.roll, kind: p.kind, needsTarget: true });
      }
    } catch {
      /* ignore */
    }
  }, [alreadyActed, result, PENDING_KEY]);

  async function roll() {
    if (busy || alreadyActed || !canAfford) return;
    setBusy(true);
    try {
      const res = await gamblingRoll(myPlayer.id);
      if (res.ok && typeof res.roll === "number" && res.kind) {
        const needsTarget = !!res.needs_target;
        setResult({ roll: res.roll, kind: res.kind, needsTarget });
        if (needsTarget) {
          try {
            localStorage.setItem(
              PENDING_KEY,
              JSON.stringify({ roll: res.roll, kind: res.kind })
            );
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmTarget() {
    if (busy || !target || !result) return;
    setBusy(true);
    try {
      const res = await gamblingPickTarget(myPlayer.id, target);
      if (res.ok) {
        setPickedName(
          players.find((p) => p.id === target)?.name ?? "Your target"
        );
        setPicked(true);
        try {
          localStorage.removeItem(PENDING_KEY);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // ---- Final summary (no target needed, or target already named) ----------
  if (result && (!result.needsTarget || picked)) {
    let line: React.ReactNode;
    switch (result.kind) {
      case "self_hospital":
        line = (
          <>
            You&rsquo;re hospitalised yourself and will sit out the coming
            reflection (an extra life can absorb it).
          </>
        );
        break;
      case "no_minigame":
        line = (
          <>Too rattled to focus &mdash; you score nothing in this round&rsquo;s minigame.</>
        );
        break;
      case "minigame_mult":
        line = (
          <>A hot streak &mdash; your Soul Energy from this round&rsquo;s minigame is doubled.</>
        );
        break;
      case "extra_life":
        line = <>Fortune favours you &mdash; you gain a lasting extra life.</>;
        break;
      case "hospital":
        line = (
          <>
            <strong>{pickedName}</strong> will be sent to hospital at the end of
            this phase (protection can still save them).
          </>
        );
        break;
      case "kill":
        line = (
          <>
            <strong>{pickedName}</strong> will be killed at the end of this phase
            (protection can still save them).
          </>
        );
        break;
    }
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Gambling &mdash; the dice
        </p>
        <p className="mt-2 text-center text-5xl font-bold">{result.roll}</p>
        <p className="mt-3 text-center text-sm">
          You rolled a <strong>{result.roll}</strong>. {line}
        </p>
      </div>
    );
  }

  // ---- Roll of 4 / 6: choose a target -------------------------------------
  if (result && result.needsTarget && !picked) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">
          Gambling &mdash; the dice
        </p>
        <p className="mt-2 text-center text-5xl font-bold text-cream">
          {result.roll}
        </p>
        <p className="mt-3 text-sm text-cream/80">
          {result.kind === "kill"
            ? "A killing roll. Choose someone to kill — protection can still save them."
            : "Choose someone to send to hospital — protection can still save them."}
        </p>
        <ul className="mt-4 flex flex-col gap-2">
          {targets.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setTarget(p.id)}
                className={
                  "w-full rounded-lg px-4 py-2 text-left transition-colors " +
                  (target === p.id
                    ? "border-2 border-gold bg-gold text-home-bg"
                    : "border border-gold/40 bg-cream/90 text-home-bg hover:bg-cream")
                }
              >
                {p.name}
                {p.in_prison && (
                  <span className="ml-2 text-xs opacity-60">(in prison)</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={confirmTarget}
          disabled={busy || !target}
          className="mt-4 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? "Confirming…"
            : result.kind === "kill"
              ? "Kill them"
              : "Send them to hospital"}
        </button>
      </div>
    );
  }

  // ---- Idle: roll the die -------------------------------------------------
  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Gambling</p>
      <p className="mt-2 text-sm text-cream/80">
        Roll the die and take what fate gives — the face decides:
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-cream/70">
        <li>
          <span className="font-semibold text-cream">1</span> &middot; you&rsquo;re hospitalised yourself
        </li>
        <li>
          <span className="font-semibold text-cream">2</span> &middot; you score nothing in the minigame
        </li>
        <li>
          <span className="font-semibold text-cream">3</span> &middot; your minigame Soul Energy is doubled
        </li>
        <li>
          <span className="font-semibold text-cream">4</span> &middot; hospitalise a player of your choice
        </li>
        <li>
          <span className="font-semibold text-cream">5</span> &middot; gain a lasting extra life
        </li>
        <li>
          <span className="font-semibold text-cream">6</span> &middot; kill a player of your choice
        </li>
      </ul>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy: <span className="font-semibold">{myPlayer.soul_energy}</span>{" "}
        &middot; cost: {COST} &middot; spent whatever you roll
      </p>

      {alreadyActed ? (
        <p className="mt-4 text-sm text-cream/60 italic">
          You already rolled today.
        </p>
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <button
          onClick={roll}
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Rolling…" : "Roll the die (100 SE)"}
        </button>
      )}
    </div>
  );
}
