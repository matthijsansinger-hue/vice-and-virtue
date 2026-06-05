"use client";

import { useState } from "react";
import {
  BADGES,
  BADGES_BY_TIER,
  TIER_META,
  TIER_ORDER,
} from "@/lib/badges";
import { Medallion } from "./BadgesShowcase";

// The "Featured badges" picker on the profile page. Two slots the player
// fills from their earned badges; the choices show next to their name in the
// lobby and at game over. Persisted by the parent via onChange.
export function FeaturedBadges({
  earned,
  featured,
  onChange,
}: {
  earned: Set<string>;
  featured: string[];
  onChange: (ids: string[]) => void;
}) {
  // Which slot (0 or 1) is currently being picked, or null when closed.
  const [picking, setPicking] = useState<number | null>(null);

  const slots: (string | null)[] = [featured[0] ?? null, featured[1] ?? null];

  const setSlot = (slot: number, id: string | null) => {
    const next: (string | null)[] = [...slots];
    next[slot] = id;
    // A badge can only sit in one slot — clear it from the other if needed.
    if (id) {
      const other = slot === 0 ? 1 : 0;
      if (next[other] === id) next[other] = null;
    }
    onChange(next.filter((x): x is string => !!x));
    setPicking(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-gold">Featured badges</h2>
        <p className="text-xs text-cream/50">
          Pick up to 2 — they show next to your name in the lobby and at game
          over.
        </p>
      </div>

      <div className="flex justify-center gap-8">
        {[0, 1].map((slot) => {
          const id = slots[slot];
          const badge = id ? BADGES.find((b) => b.id === id) : null;
          return (
            <div key={slot} className="flex w-24 flex-col items-center gap-1">
              {badge ? (
                <>
                  <button
                    type="button"
                    onClick={() => setPicking(slot)}
                    title="Change this badge"
                  >
                    <Medallion badge={badge} earned sizeClass="h-20 w-20" />
                  </button>
                  <span className="text-center text-[11px] leading-tight text-cream/85">
                    {badge.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSlot(slot, null)}
                    className="text-[10px] text-cream/45 underline hover:text-cream/70"
                  >
                    remove
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPicking(slot)}
                  className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 border-dashed border-gold/40 text-gold/70 transition-colors hover:border-gold/70 hover:text-gold"
                >
                  <span className="text-3xl leading-none">+</span>
                  <span className="text-[10px]">Add badge</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {picking !== null && (
        <PickerModal
          earned={earned}
          excludeId={slots[picking === 0 ? 1 : 0]}
          onPick={(id) => setSlot(picking, id)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

// Modal listing the player's earned badges (grouped by tier) to choose from.
function PickerModal({
  earned,
  excludeId,
  onPick,
  onClose,
}: {
  earned: Set<string>;
  excludeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const hasAny = BADGES.some((b) => earned.has(b.id));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border-2 border-gold bg-home-bg p-5 text-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gold">Choose a badge</h3>
        <p className="mt-0.5 text-xs text-cream/50">
          Only badges you&rsquo;ve earned.
        </p>

        {!hasAny ? (
          <p className="mt-6 text-center text-sm text-cream/60">
            You haven&rsquo;t earned any badges yet — play a few games first.
          </p>
        ) : (
          TIER_ORDER.map((tier) => {
            const earnedInTier = BADGES_BY_TIER[tier].filter((b) =>
              earned.has(b.id)
            );
            if (earnedInTier.length === 0) return null;
            const meta = TIER_META[tier];
            return (
              <div key={tier} className="mt-4">
                <span
                  className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest"
                  style={{
                    background: meta.gradient,
                    color: meta.text,
                    boxShadow: meta.glow,
                  }}
                >
                  {meta.label}
                </span>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {earnedInTier.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={b.id === excludeId}
                      onClick={() => onPick(b.id)}
                      className="flex flex-col items-center gap-1 rounded-lg p-1 transition-colors hover:bg-cream/10 disabled:opacity-30"
                      title={b.id === excludeId ? "Already featured" : b.name}
                    >
                      <Medallion badge={b} earned sizeClass="h-14 w-14" />
                      <span className="text-[9px] leading-tight text-cream/70">
                        {b.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          Close
        </button>
      </div>
    </div>
  );
}
