"use client";

// Dev-only preview for the Soul Fragment cinematic (unlinked, like /dev/avatars).
// Drives the REAL component with a stubbed openOne() so the reveal can be QA'd
// without spending actual fragments:
//   /dev/fragment?kind=le|mano|role&rarity=earthen|verdant|primal|noble|divine&n=1

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SoulFragmentReveal } from "@/components/SoulFragmentReveal";
import { SHARD_XP, type ShardReward, type FragmentRarity } from "@/lib/economy";

const RARITIES: FragmentRarity[] = ["earthen", "verdant", "primal", "noble", "divine"];

function Preview() {
  const q = useSearchParams();
  const kindParam = q.get("kind");
  const kind: "le" | "mano" | "role" =
    kindParam === "mano" || kindParam === "role" ? kindParam : "le";
  const rarityParam = q.get("rarity") as FragmentRarity | null;
  const rarity: FragmentRarity =
    rarityParam && RARITIES.includes(rarityParam) ? rarityParam : "divine";
  const count = Math.max(1, Number(q.get("n") ?? 1) || 1);
  const [open, setOpen] = useState(true);

  // The balance fields aren't read by the cinematic — only kind/amount/rarity.
  const balances = { le: 0, mano: 0, xp: 0, xp_gained: SHARD_XP, unopened_shards: 0 };

  async function openOne(): Promise<ShardReward> {
    if (kind === "mano") return { kind: "mano", amount: 19, rarity, ...balances };
    if (kind === "role") return { kind: "role", role: "wrath", rarity, ...balances };
    return { kind: "le", amount: 190, rarity, ...balances };
  }

  return (
    <main className="min-h-screen bg-black p-6 text-cream">
      <p className="font-mono text-sm leading-relaxed">
        /dev/fragment?kind=le|mano|role&amp;rarity=earthen|verdant|primal|noble|divine&amp;n=1
        <br />
        showing: kind={kind} · rarity={rarity} · n={count}
      </p>
      <button
        onClick={() => setOpen(true)}
        className="mt-4 rounded bg-gold px-4 py-2 font-semibold text-home-bg"
      >
        Replay
      </button>
      {open && (
        <SoulFragmentReveal
          remaining={count}
          openOne={openOne}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
