"use client";

import { useEffect, useState } from "react";
import { vengeanceRevengeTargets, queueVengeanceRevenge } from "@/lib/game";
import type { Player } from "@/lib/types";

const REVENGE_COST = 150;

// Shown by RoleAction when Vengeance is imprisoned. She may spend 150 SE to
// kill one of the players who voted to jail her (the room remembers them for
// the whole game). One kill per day; Justice protect can still save the target
// (it resolves as a normal 'kill'). The jailer list is fetched from the server
// so it is never exposed to anyone else.
export function VengeanceRevengeAction({ myPlayer }: { myPlayer: Player }) {
  const [targets, setTargets] = useState<
    { id: string; name: string }[] | null
  >(null);
  const [busy, setBusy] = useState(false);

  const alreadyActed = myPlayer.acted_this_day;
  const canAfford = myPlayer.soul_energy >= REVENGE_COST;

  useEffect(() => {
    let cancelled = false;
    vengeanceRevengeTargets(myPlayer.id).then((t) => {
      if (!cancelled) setTargets(t);
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer.id]);

  async function pick(id: string) {
    if (alreadyActed || busy || !canAfford) return;
    setBusy(true);
    try {
      await queueVengeanceRevenge(myPlayer.id, id);
    } finally {
      setBusy(false);
    }
  }

  if (
    alreadyActed &&
    myPlayer.pending_action === "kill" &&
    myPlayer.pending_target
  ) {
    const t = targets?.find((x) => x.id === myPlayer.pending_target);
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Vengeance &mdash; queued
        </p>
        <p className="mt-2">
          You will kill <strong>{t?.name ?? "your target"}</strong> (unless
          Justice protects them).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">
        Vengeance &mdash; imprisoned
      </p>
      <p className="mt-2 text-sm text-cream/80">
        You are behind bars, but you remember who put you here. Spend 150 to
        kill one of them today &mdash; Justice protect can still save them.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;
        cost: {REVENGE_COST}
      </p>

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
      ) : !canAfford ? (
        <p className="mt-4 text-sm text-red-300 italic">
          Not enough Soul Energy.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {targets.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => pick(t.id)}
                disabled={busy}
                className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
