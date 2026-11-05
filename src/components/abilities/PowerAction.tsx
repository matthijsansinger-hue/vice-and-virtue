"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Player } from "@/lib/types";

// Role abilities bought for one day in the role phase (migration 142:
// use_power). Diligence, Truthfulness and Justice act in the courtroom; Pride's
// two act on Outreach and the consultation.
export type PowerKey = "diligence" | "truth" | "justice" | "pride_shield" | "pride_broadcast";

export type PowerOption = {
  power: PowerKey;
  label: string; // button text, without the price
  cost: number;
  done: string; // shown once bought
};

const REASONS: Record<string, string> = {
  not_yet: "This ability works in the new courtroom, which isn't switched on yet.",
  cant_afford: "Not enough Soul Energy.",
  already_acted: "You already used an ability today.",
  wrong_phase: "Abilities are used in the role phase.",
  cannot_act: "You can't act right now.",
  not_your_role: "That isn't your ability.",
};

export async function buyPower(
  playerId: string,
  power: PowerKey
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc("use_power", {
    p_player_id: playerId,
    p_power: power,
  });
  if (error) return { ok: false, reason: "error" };
  return (data as { ok: boolean; reason?: string } | null) ?? { ok: false };
}

export function PowerAction({
  myPlayer,
  title,
  blurb,
  options,
  note,
}: {
  myPlayer: Player;
  title: string;
  blurb: string;
  options: PowerOption[];
  note?: string; // e.g. a passive ability
}) {
  const [busy, setBusy] = useState(false);
  const [bought, setBought] = useState<PowerOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(o: PowerOption) {
    if (busy || myPlayer.acted_this_day || myPlayer.soul_energy < o.cost) return;
    setBusy(true);
    setError(null);
    try {
      const res = await buyPower(myPlayer.id, o.power);
      if (res.ok) setBought(o);
      else setError(REASONS[res.reason ?? ""] ?? "That didn't work — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">{title}</p>
      <p className="mt-2 text-sm text-cream/80">{blurb}</p>
      {note && <p className="mt-2 text-xs text-cream/70 italic">{note}</p>}
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy: <span className="font-semibold">{myPlayer.soul_energy}</span>
      </p>

      {bought ? (
        <p className="mt-4 rounded-lg bg-cream/10 px-3 py-2 text-sm">{bought.done}</p>
      ) : myPlayer.acted_this_day ? (
        <p className="mt-4 text-sm text-cream/60 italic">You already used an ability today.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {options.map((o) => (
            <button
              key={o.power}
              onClick={() => buy(o)}
              disabled={busy || myPlayer.soul_energy < o.cost}
              className="w-full rounded-lg bg-gold py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {o.label} ({o.cost} SE)
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
