"use client";

import { Children, type ReactNode } from "react";
import { SoulFlame } from "@/components/ui/royal";

// The trial as seen from above: a walnut desk with a green leather writing
// inlay, and the proof laid on it as sheets of paper — the prosecution's in
// one row, the defence's in another. The verdict and the settlement sit on
// the same desk. Presentation only.

export const SIDE = {
  P: { ink: "#8a6a1c", name: "Prosecution" },
  D: { ink: "#3a3d8f", name: "Defence" },
} as const;

export const SHEET_PAPER = "linear-gradient(178deg, #fdf6e2 0%, #f3e6c4 100%)";
export const SHEET_SHADOW = "0 1px 0 rgba(255,255,255,.6) inset, 0 6px 14px rgba(0,0,0,.38)";
const LEATHER = "#2f4a36";
const TOOLING = "rgba(201,160,67,.55)";

export function DeskSurface({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative rounded-xl p-2 shadow-[0_10px_26px_rgba(0,0,0,.45)] sm:p-3"
      style={{
        background:
          "repeating-linear-gradient(177deg, rgba(0,0,0,.09) 0 2px, transparent 2px 11px), repeating-linear-gradient(183deg, rgba(255,220,170,.05) 0 1px, transparent 1px 17px), linear-gradient(180deg, #5a3820, #42291a)",
        boxShadow: "inset 0 0 0 2px #2b1a0e, inset 0 2px 0 3px rgba(255,214,160,.12), 0 10px 26px rgba(0,0,0,.45)",
      }}
    >
      <div
        className="relative rounded-lg px-2.5 pb-4 pt-3 sm:px-4"
        style={{
          background: `radial-gradient(ellipse 70% 60% at 50% 40%, rgba(255,255,255,.06), transparent 70%), ${LEATHER}`,
          boxShadow: `inset 0 0 0 1px #1d3022, inset 0 0 0 5px ${LEATHER}, inset 0 0 0 6px ${TOOLING}, inset 0 0 26px rgba(0,0,0,.45)`,
        }}
      >
        <Inkwell />
        <div className="relative space-y-4">{children}</div>
      </div>
    </div>
  );
}

// One side's row of sheets. On phones the sheets lie next to each other in a
// row you swipe (the next one peeks in); from sm up they sit two abreast.
export function DeskRow({
  side,
  label,
  empty,
  children,
}: {
  side: "P" | "D";
  label?: ReactNode;
  empty?: ReactNode;
  children: ReactNode;
}) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <section aria-label={`${SIDE[side].name} proof`}>
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#e9d9a8]">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: SIDE[side].ink, boxShadow: "0 0 0 1.5px #e9d9a8" }} />
        {label ?? SIDE[side].name}
      </p>
      {items.length === 0 ? (
        <p className="py-3 text-center text-xs italic text-[#e9d9a8]/70">{empty}</p>
      ) : (
        <div
          className={
            "-mx-2.5 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-2.5 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-1 " +
            (items.length === 1 ? "[&>*]:w-full" : "[&>*]:w-[84%] sm:[&>*]:w-auto")
          }
        >
          {items.map((c, i) => (
            <div key={i} className="shrink-0 snap-center">
              {c}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// An empty sheet with a dashed edge: where your proof will go. It's the
// button that opens the composer.
export function BlankSheet({
  side,
  label,
  cost,
  onClick,
}: {
  side: "P" | "D";
  label: string;
  cost: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[7.5rem] w-full flex-col items-center justify-center gap-1 rounded-[3px] border-2 border-dashed px-3 py-4 text-center font-semibold transition-colors hover:bg-[#fdf6e2]/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      style={{ borderColor: "rgba(233,217,168,.7)", color: "#f3e6c4" }}
    >
      <span aria-hidden className="text-2xl leading-none">+</span>
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-1 text-xs opacity-80">
        {cost} <SoulFlame size={12} />
      </span>
      <span className="sr-only">{SIDE[side].name}</span>
    </button>
  );
}

// The desk's one ornament: an inkwell with a quill, in the top-right corner.
function Inkwell() {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
      className="pointer-events-none absolute -right-1 -top-2 h-10 w-10 opacity-90 sm:h-12 sm:w-12"
    >
      <ellipse cx="24" cy="33" rx="13" ry="8" fill="#151a17" />
      <ellipse cx="24" cy="31" rx="11" ry="6.5" fill="#262e2a" />
      <ellipse cx="24" cy="30" rx="6" ry="3.2" fill="#0b0d14" />
      <ellipse cx="20" cy="28.5" rx="3.5" ry="1.4" fill="#fff" opacity=".18" />
      <path d="M25 30 L41 4" stroke="#d9cfb8" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M41 4 C 36 6, 31 12, 28 22 C 33 16, 38 11, 41 4 Z" fill="#efe6d2" />
      <path d="M41 4 C 42 9, 39 16, 31 21 C 35 14, 38 9, 41 4 Z" fill="#d6cab0" />
    </svg>
  );
}
