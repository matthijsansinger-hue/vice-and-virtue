"use client";

import { forwardRef, type ReactNode } from "react";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { heading } from "@/components/ui/royal";
import type { CharacterConfig } from "@/lib/character";

// The Market as a stall: a striped awning, a lantern-lit back wall, the
// merchant behind the counter with his speech bubble, and shelves of bottles
// with a price tag and a Buy button under each. Presentation only — the
// buying, the target picker and the prison release live in Store.tsx.

const C = {
  plum: "#4b1f3f",
  bone: "#efe1c2",
  wall: "#2b1b0f",
  wallSeam: "#1f130a",
  plank: "#6b4526",
  plankTop: "#8a5c34",
  plankEdge: "#3b2615",
  glow: "255,207,122",
  brass: "#c9a043",
};

// The merchant: an old apothecary, bald with a long silver beard, drawn with
// the game's own character avatars.
export const MERCHANT: CharacterConfig = {
  gender: "male",
  faceShape: "round",
  expression: "happy",
  skin: "tan",
  hair: "none",
  hairColor: "silver",
  facialHair: "long",
  facialHairColor: "silver",
  eyeColor: "amber",
  outfit: "plum",
};

export function StallFrame({
  top,
  children,
  counter,
}: {
  // The merchant + his bubble, under the awning.
  top: ReactNode;
  // The shelves.
  children: ReactNode;
  // The counter's front (Soul Energy on hand).
  counter: ReactNode;
}) {
  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {/* The awning: plum and bone stripes, scalloped edge, the stall's sign. */}
      <div className="relative z-10">
        <div
          className="h-10 rounded-t-xl border-x-4 border-t-4 shadow-[0_6px_14px_rgba(0,0,0,.45)] sm:h-12"
          style={{
            borderColor: C.plankEdge,
            background: `repeating-linear-gradient(90deg, ${C.plum} 0 28px, ${C.bone} 28px 56px)`,
          }}
        />
        <div
          aria-hidden
          className="h-[14px]"
          style={{
            background: `radial-gradient(circle at 14px 0, ${C.plum} 13px, transparent 13.5px) 0 0 / 56px 14px repeat-x, radial-gradient(circle at 42px 0, ${C.bone} 13px, transparent 13.5px) 0 0 / 56px 14px repeat-x`,
            filter: "drop-shadow(0 3px 2px rgba(0,0,0,.35))",
          }}
        />
        <div className="absolute left-1/2 top-1.5 -translate-x-1/2 sm:top-2">
          <span
            className={`block rounded-md border-2 px-4 py-0.5 text-sm font-semibold tracking-[0.06em] text-[#3a2a18] shadow-[0_3px_8px_rgba(0,0,0,.45)] sm:text-base ${heading}`}
            style={{ background: C.bone, borderColor: C.plankEdge }}
          >
            Potions
          </span>
        </div>
      </div>

      {/* The back wall and the shelves. */}
      <div
        className="relative -mt-[14px] overflow-hidden border-x-4 px-2 pb-3 pt-6 sm:px-5"
        style={{
          borderColor: C.plankEdge,
          background: `radial-gradient(ellipse 45% 32% at 12% 6%, rgba(${C.glow},.22), transparent 70%), radial-gradient(ellipse 45% 32% at 88% 6%, rgba(${C.glow},.22), transparent 70%), repeating-linear-gradient(90deg, ${C.wall} 0 46px, ${C.wallSeam} 46px 48px)`,
        }}
      >
        <Lantern className="left-2 sm:left-4" />
        <Lantern className="right-2 sm:right-4" />
        {top}
        <div className="mt-3 flex flex-col gap-1">{children}</div>
      </div>

      {/* The counter. */}
      <div
        className="relative rounded-b-xl border-4 border-t-0 px-4 py-3 text-center shadow-[0_10px_24px_rgba(0,0,0,.5)]"
        style={{
          borderColor: C.plankEdge,
          background: `linear-gradient(180deg, ${C.plankTop} 0 6px, ${C.plank} 6px), repeating-linear-gradient(90deg, transparent 0 60px, rgba(0,0,0,.18) 60px 62px)`,
          backgroundBlendMode: "normal",
        }}
      >
        {counter}
      </div>
    </div>
  );
}

function Lantern({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 40"
      className={`pointer-events-none absolute top-0 h-9 w-6 ${className}`}
      aria-hidden
      focusable="false"
    >
      <path d="M12 0 V7" stroke="#1a1009" strokeWidth="1.5" />
      <rect x="6" y="7" width="12" height="3" rx="1" fill={C.brass} />
      <path d="M7 10 H17 L19 30 H5 Z" fill={`rgba(${C.glow},.85)`} stroke={C.brass} strokeWidth="1.6" />
      <path d="M12 12 V28" stroke={C.brass} strokeWidth="1" opacity="0.7" />
      <rect x="5" y="30" width="14" height="3" rx="1" fill={C.brass} />
    </svg>
  );
}

// One shelf: the bottles standing on a plank, their price tags and Buy
// buttons hanging below it.
export function ShelfRow({ bottles, tags }: { bottles: ReactNode[]; tags: ReactNode[] }) {
  return (
    <div>
      <div className="grid grid-cols-3 items-end gap-1 sm:gap-3">{bottles}</div>
      <div
        aria-hidden
        className="relative h-3 rounded-sm shadow-[0_5px_8px_rgba(0,0,0,.55)]"
        style={{
          background: `linear-gradient(180deg, ${C.plankTop} 0 35%, ${C.plank} 35%)`,
          boxShadow: `inset 0 -2px 0 ${C.plankEdge}, 0 5px 8px rgba(0,0,0,.55)`,
        }}
      />
      <div className="grid grid-cols-3 gap-1 pb-3 pt-1.5 sm:gap-3">{tags}</div>
    </div>
  );
}

// The parchment tag under a bottle: its name and price, then its button.
export function PriceTag({
  name,
  price,
  dim = false,
  children,
}: {
  name: string;
  price: ReactNode;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center">
      <span aria-hidden className="h-2 w-px" style={{ background: C.brass }} />
      <div
        className={
          "w-full max-w-[9rem] rounded-md px-1 pb-1.5 pt-1 text-center text-[#3a2a18] shadow-[0_3px_8px_rgba(0,0,0,.45)] sm:px-1.5 " +
          (dim ? "opacity-60" : "")
        }
        style={{ background: C.bone }}
      >
        <p className={`text-[11px] font-semibold leading-tight tracking-[-0.02em] sm:text-[13px] sm:tracking-normal ${heading}`}>
          {name}
        </p>
        <p className="mt-0.5 text-xs font-semibold">{price}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

// The merchant, behind the counter. A button: tapping him is how you get
// someone out of the dungeon. A brass key badge shows how many are in there.
export const Merchant = forwardRef<
  HTMLButtonElement,
  { onClick: () => void; prisoners: number; active: boolean }
>(function Merchant({ onClick, prisoners, active }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={
        prisoners > 0
          ? `The merchant: free someone from prison (${prisoners} in the dungeon)`
          : "The merchant: free someone from prison"
      }
      aria-pressed={active}
      className="group relative shrink-0 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
    >
      <span
        className={
          "block transition-transform duration-200 motion-safe:group-hover:-translate-y-1 " +
          (active ? "drop-shadow-[0_0_12px_rgba(255,207,122,.6)]" : "")
        }
      >
        <CharacterAvatar
          character={MERCHANT}
          initials="M"
          variant="full"
          className="h-24 w-24 sm:h-32 sm:w-32"
        />
      </span>
      {/* The counter's top edge in front of him. */}
      <span
        aria-hidden
        className="absolute -bottom-1 left-1/2 h-3 w-[120%] -translate-x-1/2 rounded-sm"
        style={{ background: `linear-gradient(180deg, ${C.plankTop}, ${C.plank})`, boxShadow: "0 3px 6px rgba(0,0,0,.5)" }}
      />
      {prisoners > 0 && (
        <span
          className="absolute -right-2 top-1 flex items-center gap-0.5 rounded-full border-2 px-1.5 py-0.5 text-xs font-bold text-[#3a2a18] shadow-[0_2px_6px_rgba(0,0,0,.5)]"
          style={{ background: C.brass, borderColor: C.plankEdge }}
        >
          <KeyIcon />
          {prisoners}
        </span>
      )}
    </button>
  );
});

function KeyIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden focusable="false">
      <circle cx="5" cy="5" r="3.2" fill="none" stroke="#3a2a18" strokeWidth="1.8" />
      <path d="M7.3 7.3 L14 14 M11 11 L12.8 9.2 M12.6 12.6 L14.2 11" stroke="#3a2a18" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// The merchant's speech bubble, its tail pointing back at him.
export const Bubble = forwardRef<HTMLDivElement, { children: ReactNode }>(function Bubble(
  { children },
  ref
) {
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className="relative min-w-0 flex-1 self-center rounded-2xl border-2 px-3 py-2.5 text-sm text-[#3a2a18] shadow-[0_4px_12px_rgba(0,0,0,.45)]"
      style={{ background: C.bone, borderColor: C.plankEdge }}
    >
      <span
        aria-hidden
        className="absolute -left-[9px] top-6 h-4 w-4 rotate-45 border-b-2 border-l-2"
        style={{ background: C.bone, borderColor: C.plankEdge }}
      />
      <div className="relative">{children}</div>
    </div>
  );
});
