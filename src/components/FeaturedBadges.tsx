"use client";

import { useState } from "react";
import {
  BADGES,
  BADGES_BY_TIER,
  TIER_META,
  TIER_ORDER,
} from "@/lib/badges";
import { Medallion } from "./BadgesShowcase";

// The "Featured badges" widget on the profile page. The whole card is one click
// target; it opens a picker where you first choose which of the two slots to
// change, then pick a badge — so you can set both in a single session. The
// choices show next to your name in the lobby and at game over. Persisted by the
// parent via onChange.
export function FeaturedBadges({
  earned,
  featured,
  onChange,
  readOnly = false,
}: {
  earned: Set<string>;
  featured: string[];
  onChange?: (ids: string[]) => void;
  readOnly?: boolean; // visiting someone else's profile: same widget, no editing
}) {
  const interactive = !readOnly;
  const [open, setOpen] = useState(false);
  // Which slot (0 or 1) the picker is currently editing.
  const [activeSlot, setActiveSlot] = useState(0);

  const slots: (string | null)[] = [featured[0] ?? null, featured[1] ?? null];

  // Set/clear a slot. A badge can only sit in one slot — clear it from the other
  // if needed. Does NOT close the picker, so both slots can be set in one go.
  const setSlot = (slot: number, id: string | null) => {
    const next: (string | null)[] = [...slots];
    next[slot] = id;
    if (id) {
      const other = slot === 0 ? 1 : 0;
      if (next[other] === id) next[other] = null;
    }
    onChange?.(next.filter((x): x is string => !!x));
  };

  const openPicker = () => {
    setActiveSlot(0);
    setOpen(true);
  };

  return (
    <>
      {/* The whole card is the click target (role=button so the heading + badge
          art can live inside without invalid <button> nesting). */}
      <div
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? openPicker : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPicker();
                }
              }
            : undefined
        }
        aria-label={interactive ? "Edit featured badges" : undefined}
        className={
          "flex flex-col gap-3 rounded-2xl border border-gold/20 bg-cream/5 p-4" +
          (interactive ? " cursor-pointer transition-transform hover:scale-[1.02]" : "")
        }
      >
        <h2 className="text-lg font-semibold text-gold">Featured badges</h2>

        <div className="flex justify-center gap-8">
          {[0, 1].map((slot) => {
            const id = slots[slot];
            const badge = id ? BADGES.find((b) => b.id === id) : null;
            return (
              <div key={slot} className="flex w-24 flex-col items-center gap-1">
                {badge ? (
                  <>
                    <Medallion badge={badge} earned sizeClass="h-20 w-20" />
                    <span className="text-center text-[11px] leading-tight text-cream/85">
                      {badge.name}
                    </span>
                  </>
                ) : interactive ? (
                  <span className="flex h-20 w-20 flex-col items-center justify-center rounded-full border-2 border-dashed border-gold/40 text-gold/70">
                    <span className="text-3xl leading-none">+</span>
                    <span className="text-[10px]">Add badge</span>
                  </span>
                ) : (
                  <span className="h-20 w-20 rounded-full border-2 border-dashed border-cream/15" aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* The picker is a sibling of the card, NOT inside it: the card's
          hover:scale transform would otherwise become the containing block for
          this fixed overlay and make it jump around. */}
      {interactive && open && (
        <PickerModal
          earned={earned}
          slots={slots}
          activeSlot={activeSlot}
          onSelectSlot={setActiveSlot}
          onPick={(id) => setSlot(activeSlot, id)}
          onRemove={() => setSlot(activeSlot, null)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// The picker: a slot selector on top (choose which featured badge to change),
// then the player's earned badges grouped by tier. Picking assigns to the active
// slot and stays open so both can be set.
function PickerModal({
  earned,
  slots,
  activeSlot,
  onSelectSlot,
  onPick,
  onRemove,
  onClose,
}: {
  earned: Set<string>;
  slots: (string | null)[];
  activeSlot: number;
  onSelectSlot: (slot: number) => void;
  onPick: (id: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const hasAny = BADGES.some((b) => earned.has(b.id));
  // A badge can't sit in both slots — disable the one already in the other slot.
  const otherId = slots[activeSlot === 0 ? 1 : 0];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-gold bg-home-bg p-6 text-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-semibold text-gold">Featured badges</h3>
        <p className="mt-0.5 text-sm text-cream/50">
          Pick a slot to change, then choose a badge.
        </p>

        {/* Slot selector — which featured badge are you changing? */}
        <div className="mt-4 flex justify-center gap-4">
          {[0, 1].map((slot) => {
            const id = slots[slot];
            const badge = id ? BADGES.find((b) => b.id === id) : null;
            const active = slot === activeSlot;
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onSelectSlot(slot)}
                className={
                  "flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-colors " +
                  (active ? "border-gold bg-gold/10" : "border-cream/15 hover:border-cream/30")
                }
              >
                {badge ? (
                  <Medallion badge={badge} earned sizeClass="h-16 w-16" />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-gold/40 text-2xl text-gold/70">
                    +
                  </span>
                )}
                <span className="text-[11px] font-semibold text-cream/80">Slot {slot + 1}</span>
              </button>
            );
          })}
        </div>

        {!hasAny ? (
          <p className="mt-6 text-center text-sm text-cream/60">
            You haven&rsquo;t earned any badges yet — play a few games first.
          </p>
        ) : (
          <div className="mt-5 border-t border-gold/15 pt-4">
            {TIER_ORDER.map((tier) => {
              const earnedInTier = BADGES_BY_TIER[tier].filter((b) => earned.has(b.id));
              if (earnedInTier.length === 0) return null;
              const meta = TIER_META[tier];
              return (
                <div key={tier} className="mt-4 first:mt-0">
                  <span
                    className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest"
                    style={{ background: meta.gradient, color: meta.text, boxShadow: meta.glow }}
                  >
                    {meta.label}
                  </span>
                  <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                    {earnedInTier.map((b) => {
                      const isCurrent = slots[activeSlot] === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          disabled={b.id === otherId}
                          onClick={() => onPick(b.id)}
                          className={
                            "flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors hover:bg-cream/10 disabled:opacity-30 " +
                            (isCurrent ? "bg-gold/15 ring-1 ring-gold/50" : "")
                          }
                          title={b.id === otherId ? "Already in the other slot" : b.name}
                        >
                          <Medallion badge={b} earned sizeClass="h-20 w-20" />
                          <span className="text-[11px] leading-tight text-cream/75">{b.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2">
          {slots[activeSlot] && (
            <button
              type="button"
              onClick={onRemove}
              className="w-full rounded-lg border border-gold/40 py-2 text-sm font-semibold text-cream/80 transition-colors hover:bg-cream/10"
            >
              Remove badge from slot {activeSlot + 1}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
