"use client";

import { useId, type ReactNode } from "react";

// The Market's bottles: one drawing per potion, so each reads at a glance on
// the stall — the shape and the liquid say what it does. 60×80 SVGs, glass on
// a dark shelf: a pale outline, a bright liquid, a cork or stopper, and an
// emblem on the glass.

export type PotionId =
  | "kill"
  | "hospitalise"
  | "protect"
  | "camp_reveal"
  | "eye"
  | "vote_reveal"
  | "iron_will"
  | "comms";

const INK = "#1b120a";
const GLASS = "rgba(236,232,244,.22)";
const RIM = "#efe7d8";
const CORK = "#9a6a3c";
const CORK_DARK = "#6e4824";

export function PotionBottle({ id, className = "h-20 w-16" }: { id: PotionId; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const clip = `clip-${id}-${uid}`;
  const url = `url(#${clip})`;
  return (
    <svg viewBox="0 0 60 80" className={className} aria-hidden focusable="false">
      {/* Shadow on the shelf. */}
      <ellipse cx="30" cy="77" rx="17" ry="2.6" fill="#000" opacity="0.35" />
      {BOTTLES[id](clip, url)}
    </svg>
  );
}

type Draw = (clip: string, url: string) => ReactNode;

const cork = (x: number, y: number, w: number, h: number) => (
  <>
    <rect x={x} y={y} width={w} height={h} rx="1.6" fill={CORK} stroke={INK} strokeWidth="1.2" />
    <path d={`M${x + 1.5} ${y + h * 0.45} H${x + w - 1.5}`} stroke={CORK_DARK} strokeWidth="1" />
  </>
);

// The glass highlight: a soft streak down the left of the body.
const shine = (d: string) => (
  <path d={d} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.2" strokeLinecap="round" />
);

const BOTTLES: Record<PotionId, Draw> = {
  // Kill: a round-bottomed flask of blood-red, a skull on the glass, sealed
  // with dripping wax.
  kill: (clip, url) => {
    const body = "M25 14 H35 V33 A20 20 0 1 1 25 33 Z";
    return (
      <>
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={GLASS} />
        <rect x="8" y="42" width="44" height="36" fill="#a3172b" clipPath={url} />
        <path d="M8 42 Q18 39 30 42 T52 42" fill="none" stroke="#e0485c" strokeWidth="1.4" clipPath={url} />
        <path d={body} fill="none" stroke={RIM} strokeWidth="1.6" />
        {/* Skull. */}
        <circle cx="30" cy="55" r="7" fill="#f1ece2" stroke={INK} strokeWidth="1" />
        <rect x="26.5" y="59.5" width="7" height="4" rx="1" fill="#f1ece2" stroke={INK} strokeWidth="1" />
        <circle cx="27.3" cy="54.6" r="1.8" fill={INK} />
        <circle cx="32.7" cy="54.6" r="1.8" fill={INK} />
        <path d="M28.6 60 V63 M30 60 V63 M31.4 60 V63" stroke={INK} strokeWidth="0.7" />
        {shine("M15 47 Q13 54 16 61")}
        {cork(23.5, 7, 13, 8)}
        <path d="M23.5 14 q2 4 3.4 0 q1.6 5 3.4 0 q1.8 3.6 3.4 0 q1.4 3 2.8 0" fill="#7a1020" stroke={INK} strokeWidth="0.8" />
      </>
    );
  },

  // Hospitalise: a square apothecary bottle of sickly green, a red cross on
  // its label.
  hospitalise: (clip, url) => {
    const body = "M25 14 H35 V22 Q46 24 46 32 V70 Q46 75 41 75 H19 Q14 75 14 70 V32 Q14 24 25 22 Z";
    return (
      <>
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={GLASS} />
        <rect x="10" y="38" width="40" height="40" fill="#8cc04a" clipPath={url} />
        <path d="M10 38 H50" stroke="#c6ec88" strokeWidth="1.4" clipPath={url} />
        <path d={body} fill="none" stroke={RIM} strokeWidth="1.6" />
        <rect x="19" y="45" width="22" height="20" rx="2" fill="#f4eedf" stroke={INK} strokeWidth="1" />
        <path d="M27.5 48.5 H32.5 V52.5 H36.5 V57.5 H32.5 V61.5 H27.5 V57.5 H23.5 V52.5 H27.5 Z" fill="#c62f37" />
        {shine("M18 33 V42")}
        {cork(23.5, 7, 13, 8)}
      </>
    );
  },

  // Protection: a shield-shaped flask of steel blue with a gold boss.
  protect: (clip, url) => {
    const body = "M25 14 H35 V22 L47 27 V45 Q47 63 30 75 Q13 63 13 45 V27 L25 22 Z";
    return (
      <>
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={GLASS} />
        <rect x="10" y="36" width="40" height="42" fill="#3a74cf" clipPath={url} />
        <path d="M10 36 H50" stroke="#8fbaf5" strokeWidth="1.4" clipPath={url} />
        <path d={body} fill="none" stroke={RIM} strokeWidth="1.6" />
        <path d="M30 30 V70 M15 44 H45" stroke="#e3b510" strokeWidth="1.6" strokeOpacity="0.85" />
        <circle cx="30" cy="48" r="4.2" fill="#e3b510" stroke={INK} strokeWidth="1" />
        {shine("M17 31 V44")}
        {cork(23.5, 7, 13, 8)}
      </>
    );
  },

  // Camp reveal: a teardrop flask split between the two camps — burgundy and
  // navy, swirling into each other.
  camp_reveal: (clip, url) => {
    const body = "M25 14 H35 V28 Q49 40 49 54 A19 19 0 0 1 11 54 Q11 40 25 28 Z";
    return (
      <>
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={GLASS} />
        <g clipPath={url}>
          <rect x="8" y="36" width="44" height="42" fill="#203a9c" />
          <path d="M8 36 H30 Q22 46 30 56 Q38 66 30 78 H8 Z" fill="#9c1b38" />
          <path d="M8 36 H52" stroke="#f1d9e6" strokeOpacity="0.7" strokeWidth="1.2" />
        </g>
        <path d={body} fill="none" stroke={RIM} strokeWidth="1.6" />
        {shine("M16 44 Q14 52 17 60")}
        {cork(23.5, 7, 13, 8)}
      </>
    );
  },

  // Revealing Eye: a glass sphere of teal with an open eye on it and a round
  // glass stopper.
  eye: (clip, url) => {
    const body = "M26 20 H34 V32 A18 18 0 1 1 26 32 Z";
    return (
      <>
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={GLASS} />
        <rect x="8" y="48" width="44" height="30" fill="#1f9f93" clipPath={url} />
        <path d="M8 48 Q30 44 52 48" fill="none" stroke="#86e6da" strokeWidth="1.4" clipPath={url} />
        <path d={body} fill="none" stroke={RIM} strokeWidth="1.6" />
        <path d="M19 50 Q30 40 41 50 Q30 60 19 50 Z" fill="#f4f0e6" stroke={INK} strokeWidth="1.1" />
        <circle cx="30" cy="50" r="4.4" fill="#2bb3a3" stroke={INK} strokeWidth="0.9" />
        <circle cx="30" cy="50" r="1.9" fill={INK} />
        <circle cx="31.2" cy="48.8" r="0.8" fill="#fff" />
        {shine("M17 41 Q15 48 17 55")}
        <circle cx="30" cy="15" r="6" fill="rgba(236,232,244,.35)" stroke={RIM} strokeWidth="1.5" />
        <rect x="27" y="19" width="6" height="3" fill={RIM} />
      </>
    );
  },

  // Vote reveal: a slim lilac bottle with a ballot on its label and a tiny
  // scroll tied round the neck.
  vote_reveal: (clip, url) => {
    const body = "M26 14 H34 V26 Q42 30 42 38 V70 Q42 75 37 75 H23 Q18 75 18 70 V38 Q18 30 26 26 Z";
    return (
      <>
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={GLASS} />
        <rect x="14" y="42" width="32" height="36" fill="#8d6ad8" clipPath={url} />
        <path d="M14 42 H46" stroke="#cdb8ff" strokeWidth="1.4" clipPath={url} />
        <path d={body} fill="none" stroke={RIM} strokeWidth="1.6" />
        <rect x="22" y="49" width="16" height="15" rx="1.5" fill="#f4eedf" stroke={INK} strokeWidth="1" />
        <path d="M25 56 L28.5 60 L35 51.5" fill="none" stroke="#9c1b38" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {shine("M21.5 40 V50")}
        {cork(24.5, 7, 11, 8)}
        <rect x="33" y="17" width="9" height="6" rx="2.5" fill="#efe2bd" stroke={INK} strokeWidth="0.9" />
        <path d="M33 20 H26" stroke="#9a6a3c" strokeWidth="1" />
      </>
    );
  },

  // Iron Will: a riveted iron flask, a slot of molten orange showing through.
  iron_will: () => (
    <>
      <path d="M24 14 H36 V22 H44 Q48 22 48 26 V70 Q48 75 43 75 H17 Q12 75 12 70 V26 Q12 22 16 22 H24 Z" fill="#6c707c" stroke={INK} strokeWidth="1.4" />
      <path d="M12 34 H48 M12 62 H48" stroke="#41444d" strokeWidth="3" />
      {[16, 44].map((x) =>
        [30, 38, 58, 66].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="#a8acb6" />)
      )}
      <rect x="22" y="38" width="16" height="22" rx="3" fill="#2a1a10" stroke={INK} strokeWidth="1" />
      <rect x="23.5" y="46" width="13" height="12.5" rx="2" fill="#f0742a" />
      <path d="M23.5 46 Q30 43.5 36.5 46" fill="none" stroke="#ffc07a" strokeWidth="1.3" />
      <path d="M15 28 V54" stroke="#c9ccd4" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
      <rect x="22" y="6" width="16" height="9" rx="2" fill="#4a4d57" stroke={INK} strokeWidth="1.2" />
      <circle cx="30" cy="10.5" r="1.6" fill="#a8acb6" />
    </>
  ),

  // Communication: a tall conical flask of sky blue with a speech bubble.
  comms: (clip, url) => {
    const body = "M26 10 H34 V34 L48 70 Q49.5 75 44 75 H16 Q10.5 75 12 70 L26 34 Z";
    return (
      <>
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path d={body} fill={GLASS} />
        <rect x="8" y="48" width="44" height="30" fill="#4bb6e8" clipPath={url} />
        <path d="M8 48 H52" stroke="#a7e2fb" strokeWidth="1.4" clipPath={url} />
        <path d={body} fill="none" stroke={RIM} strokeWidth="1.6" />
        <path d="M20 52 H40 Q42 52 42 54 V62 Q42 64 40 64 H29 L25 68 V64 H20 Q18 64 18 62 V54 Q18 52 20 52 Z" fill="#f4eedf" stroke={INK} strokeWidth="1" />
        <circle cx="24.5" cy="58" r="1.4" fill={INK} />
        <circle cx="30" cy="58" r="1.4" fill={INK} />
        <circle cx="35.5" cy="58" r="1.4" fill={INK} />
        {shine("M24 38 L19 52")}
        {cork(24.5, 3, 11, 8)}
      </>
    );
  },
};
