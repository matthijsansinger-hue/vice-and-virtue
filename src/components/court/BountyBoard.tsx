"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { heading, SoulFlame } from "@/components/ui/royal";
import { hash } from "@/lib/castle";
import type { CharacterConfig } from "@/lib/character";
import type { GameColor } from "@/lib/gameColors";

// The docket as a bounty board: an oak notice board with a poster nailed up
// for every living player — their face, their name in this game's colour,
// and the bounty: all the Soul Energy pressed and backed against them. A
// charged poster is stamped "Wanted" in red ink; the biggest bounty carries a
// wax seal (on trial if the docket closed now). Presentation only — pressing
// and backing live in CourtDocket.tsx.

export const INK = "#2a1c10";
export const RED_INK = "#9e1b1b";
const OAK = { frame: "#3b2615", plank: "#5a3a1e", seam: "#462c15" };
const POSTER_PAPER = "linear-gradient(176deg, #f6ead0 0%, #ecd9ab 100%)";
const POSTER_EDGE =
  "inset 0 0 0 1px rgba(90,60,20,.22), inset 0 0 16px rgba(128,80,24,.38), 0 5px 9px rgba(0,0,0,.5)";
const BARS =
  "repeating-linear-gradient(90deg, transparent 0 7px, rgba(28,24,22,.85) 7px 10px)";

export function BoardFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-xl border-[6px] p-2.5 pb-4 shadow-[0_10px_26px_rgba(0,0,0,.45)] sm:p-4 sm:pb-5"
      style={{
        borderColor: OAK.frame,
        background: `radial-gradient(ellipse 60% 40% at 50% 0%, rgba(255,214,140,.10), transparent 70%), repeating-linear-gradient(90deg, ${OAK.plank} 0 62px, ${OAK.seam} 62px 64px)`,
        boxShadow: "inset 0 0 28px rgba(0,0,0,.5), 0 10px 26px rgba(0,0,0,.45)",
      }}
    >
      <ul className="grid grid-cols-3 items-start gap-x-2 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] sm:gap-x-3 sm:gap-y-5">
        {children}
      </ul>
    </div>
  );
}

export type PosterProps = {
  id: string;
  name: string;
  character: CharacterConfig | null;
  color: GameColor | undefined;
  bounty: number;
  // Short summary of the charges ("Vice", "Murder +1").
  summary: string | null;
  chargeCount: number;
  leader: boolean;
  me: boolean;
  inPrison: boolean;
  inHospital: boolean;
  open: boolean;
  onOpen: (() => void) | null;
};

// One poster. Pinned a little crooked (seeded by the player, so it holds
// still), and a button unless the player can't be charged (prison).
export function Poster(p: PosterProps) {
  const reduce = useReducedMotion();
  const h = hash(p.id);
  const tilt = ((h % 1000) / 1000 - 0.5) * 5; // −2.5° … 2.5°
  const drop = (h >>> 10) % 7; // 0–6 px

  // A bounty that just went up stamps itself again; the first render doesn't.
  const [prev, setPrev] = useState(p.bounty);
  const [bumps, setBumps] = useState(0);
  if (prev !== p.bounty) {
    setPrev(p.bounty);
    if (p.bounty > prev) setBumps((n) => n + 1);
  }
  const stamp = !reduce && bumps > 0;
  const wanted = p.bounty > 0;

  const label =
    `${p.name}${p.me ? " (you)" : ""}: ` +
    (p.inPrison
      ? "in the dungeon, can't be charged"
      : (wanted
          ? `bounty ${p.bounty} Soul Energy, ${p.chargeCount} ${p.chargeCount === 1 ? "charge" : "charges"}`
          : "no charges") +
        (p.leader ? ", on trial if the docket closed now" : "") +
        (p.inHospital ? ", in the infirmary" : ""));

  const paper = (
    <span
      className={
        "relative flex flex-col items-center rounded-[3px] px-1.5 pb-2 pt-3 text-center sm:px-2 " +
        (p.inPrison ? "grayscale-[.6] opacity-75" : "")
      }
      style={{ background: POSTER_PAPER, boxShadow: POSTER_EDGE, color: INK }}
    >
      <Nail />
      {p.leader && <WaxSeal stamp={stamp} />}

      {/* "Wanted", in red ink, once there's a bounty. The row keeps its
          height either way so the posters line up. */}
      <span className="flex h-5 items-center">
        {wanted && (
          <motion.span
            key={bumps}
            initial={stamp ? { scale: 1.7, opacity: 0, rotate: -12 } : false}
            animate={{ scale: 1, opacity: 1, rotate: -3 }}
            transition={{ type: "spring", stiffness: 520, damping: 22 }}
            className={`block text-[13px] font-bold tracking-[0.1em] sm:text-sm ${heading}`}
            style={{ color: RED_INK }}
          >
            Wanted
          </motion.span>
        )}
      </span>

      <span
        className="relative mt-0.5 block h-[52px] w-[52px] rounded-full sm:h-16 sm:w-16"
        style={{ boxShadow: `0 0 0 2px ${INK}, 0 0 0 4px rgba(42,28,16,.15)` }}
      >
        <CharacterAvatar
          character={p.character}
          initials={p.name.charAt(0).toUpperCase()}
          className="h-full w-full"
          textClass="text-sm"
        />
        {p.inPrison && (
          <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: BARS }} />
        )}
        {p.inHospital && (
          <span
            aria-hidden
            title="In the infirmary"
            className="absolute -bottom-0.5 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[11px] font-black leading-none text-[#c62828] shadow-[0_1px_3px_rgba(0,0,0,.4)]"
          >
            +
          </span>
        )}
      </span>

      <span
        className="mt-1.5 block w-full truncate rounded-[4px] px-1 text-[11px] font-semibold leading-[18px] shadow-[0_1px_3px_rgba(0,0,0,.35)] sm:text-xs sm:leading-5"
        style={{
          background: p.color?.background ?? "#e9dcb5",
          color: p.color ? (p.color.lightText ? "#fff7e6" : "#1c140c") : INK,
        }}
      >
        {p.name}
      </span>

      {p.inPrison ? (
        <span className="mt-1.5 text-[10px] font-semibold leading-tight opacity-75 sm:text-[11px]">
          In the dungeon
        </span>
      ) : wanted ? (
        <>
          <motion.span
            key={`b${bumps}`}
            initial={stamp ? { scale: 1.35 } : false}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 480, damping: 18 }}
            className={`mt-1 flex items-center gap-0.5 text-lg font-bold leading-none tabular-nums sm:text-xl ${heading}`}
            style={{ color: RED_INK }}
          >
            {p.bounty}
            <SoulFlame size={15} />
          </motion.span>
          {p.summary && (
            <span className="mt-0.5 block max-w-full truncate text-[10px] font-semibold leading-tight opacity-75 sm:text-[11px]">
              {p.summary}
            </span>
          )}
        </>
      ) : (
        <span className="mt-1.5 text-[10px] leading-tight opacity-55 sm:text-[11px]">No charges</span>
      )}
      {p.me && <span className="mt-0.5 text-[10px] font-bold leading-tight opacity-70 sm:text-[11px]">You</span>}
    </span>
  );

  return (
    <li
      style={{ rotate: `${tilt}deg`, translate: `0 ${drop}px` }}
    >
      {p.onOpen ? (
        <button
          type="button"
          onClick={p.onOpen}
          aria-label={label}
          aria-haspopup="dialog"
          className={
            "group block w-full rounded-[4px] transition-transform duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-0 " +
            (p.open ? "outline-2 outline-offset-4 outline-gold" : "")
          }
        >
          {paper}
        </button>
      ) : (
        paper
      )}
    </li>
  );
}

function Nail() {
  return (
    <span
      aria-hidden
      className="absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full"
      style={{
        background: "radial-gradient(circle at 35% 30%, #d9dde2 0 18%, #7d838b 45%, #3c3f44 100%)",
        boxShadow: "0 1px 2px rgba(0,0,0,.6)",
      }}
    />
  );
}

// Red sealing wax with a gavel: the biggest bounty.
function WaxSeal({ stamp }: { stamp: boolean }) {
  return (
    <motion.span
      aria-hidden
      title="On trial if the docket closed now"
      initial={stamp ? { scale: 1.8, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 20 }}
      className="absolute -bottom-3 -right-3 z-10 h-10 w-10 sm:h-11 sm:w-11"
    >
      <svg viewBox="0 0 40 40" className="h-full w-full drop-shadow-[0_2px_2px_rgba(0,0,0,.45)]">
        <path
          d="M20 2 C24 3 27 1 30 4 C33 7 37 7 37 12 C37 16 39 19 37 23 C35 27 37 31 33 34 C30 37 26 36 22 38 C18 39 15 36 11 36 C7 35 5 32 4 28 C3 24 1 21 3 17 C4 13 3 9 7 6 C10 3 15 4 20 2 Z"
          fill="#a3161b"
        />
        <circle cx="20" cy="20" r="12.5" fill="none" stroke="#7a0e12" strokeWidth="1.6" />
        {/* the gavel */}
        <g transform="rotate(-35 20 20)" fill="#f3c9b6" opacity="0.9">
          <rect x="13" y="13.5" width="11" height="6" rx="1.4" />
          <rect x="17.4" y="19" width="2.4" height="10" rx="1" />
        </g>
        <path d="M11 30.5 H22" stroke="#f3c9b6" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
        <ellipse cx="14" cy="11" rx="5" ry="2.4" fill="#fff" opacity="0.18" transform="rotate(-30 14 11)" />
      </svg>
    </motion.span>
  );
}

// The warrant: a sheet that opens over the board for one player — every
// charge against them, its backers, and (if you may) the buttons to back one
// or press your own. A bottom sheet on phones, a centred sheet on desktop.
export function WarrantSheet({
  titleId,
  onClose,
  children,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, without re-running the focus effect: callers may pass
  // a fresh function every render (the court re-renders every half second),
  // and re-running it pulled the focus out of the composer's fields mid-edit —
  // which made forging proof impossible.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  // Once, when the sheet opens: focus it, close on Escape, and give the focus
  // back to whatever opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl px-4 pb-5 pt-4 outline-none sm:rounded-xl"
        style={{
          background: POSTER_PAPER,
          boxShadow: "inset 0 0 22px rgba(128,80,24,.35), 0 18px 40px rgba(0,0,0,.55)",
          color: INK,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-gold"
        >
          ×
        </button>
        {children}
      </motion.div>
    </div>
  );
}
