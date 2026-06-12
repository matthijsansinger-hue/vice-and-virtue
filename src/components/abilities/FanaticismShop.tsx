"use client";

import { useCallback, useEffect, useState } from "react";
import { bombCarriers, myBombs, detonateBomb } from "@/lib/game";
import type { Player } from "@/lib/types";

const CHECK_COST = 50;
const DETONATE_COST = 150;

// Fanaticism's shop-phase tools (migration 072): pay 50 to see who carries your
// bombs, and 150 to ARM one for detonation. Armed bombs go off when the shop
// closes (resolve_store), killing the blind holder — shown in the shop summary.
export function FanaticismShop({ myPlayer }: { myPlayer: Player }) {
  const [bombs, setBombs] = useState<
    { id: number; alive: boolean; armed: boolean }[]
  >([]);
  const [carriers, setCarriers] = useState<
    { id: number; name: string }[] | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    myBombs(myPlayer.id).then(setBombs);
  }, [myPlayer.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function check() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await bombCarriers(myPlayer.id);
      if (res.ok) setCarriers(res.carriers ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function arm(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await detonateBomb(myPlayer.id, id);
      if (res.ok) {
        setNote(`Bomb ${id} is armed — it goes off when the shop closes.`);
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const liveBombs = bombs.filter((b) => b.alive);
  const canAffordDet = myPlayer.soul_energy >= DETONATE_COST;
  const canAffordCheck = myPlayer.soul_energy >= CHECK_COST;

  return (
    <div
      className="rounded-xl border-2 border-[#b3445c]/70 p-4 text-cream"
      style={{
        background:
          "linear-gradient(165deg, rgba(128,0,32,.5) 0%, rgba(24,6,10,.92) 70%)",
      }}
    >
      <p className="text-sm font-semibold uppercase tracking-widest text-[#e6889a]">
        Fanaticism
      </p>
      <p className="mt-1 text-xs text-cream/75">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;{" "}
        {bombs.length} bomb{bombs.length === 1 ? "" : "s"} in play
      </p>

      {note && (
        <p className="mt-2 text-sm font-medium text-[#f3c0cb]">{note}</p>
      )}

      {/* Check carriers */}
      {carriers ? (
        <div className="mt-3 rounded-lg border border-[#b3445c]/50 bg-black/20 p-2">
          {carriers.length === 0 ? (
            <p className="text-xs italic text-cream/65">
              No bombs in circulation.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 text-sm">
              {carriers.map((c) => (
                <li key={c.id}>
                  <span className="font-semibold">Bomb {c.id}</span> &mdash;{" "}
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          onClick={check}
          disabled={busy || !canAffordCheck || bombs.length === 0}
          className="mt-3 w-full rounded-lg border border-[#b3445c] bg-black/25 px-4 py-2 text-sm font-semibold text-cream transition-opacity hover:bg-black/40 disabled:opacity-50"
        >
          See who carries your bombs (50 SE)
        </button>
      )}

      {/* Arm detonations — blind (no holder name). */}
      {liveBombs.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-cream/75">
            Arm a bomb to detonate (150 SE) &mdash; it kills whoever holds it
            when the shop closes. You won&rsquo;t know who until it blows.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {liveBombs.map((b) => (
              <button
                key={b.id}
                onClick={() => arm(b.id)}
                disabled={busy || b.armed || !canAffordDet}
                className="rounded-lg border border-[#b3445c] bg-black/25 px-4 py-2 text-sm font-semibold text-cream transition-opacity hover:bg-black/40 disabled:opacity-50"
              >
                {b.armed ? `Bomb ${b.id} armed` : `Detonate Bomb ${b.id}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
