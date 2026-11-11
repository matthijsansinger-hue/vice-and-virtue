"use client";

import { memo, useId } from "react";
import { MAP_W, MAP_H } from "@/lib/castle";

// The castle floor plan: a top-down night view of the floating castle from
// the lore art — moonlit lavender stone on a dark island, lamp-lit rooms,
// the Dungeon cell barred off. Pure drawing: the room geometry it follows
// lives in lib/castle.ts, and tokens + room labels are HTML on top of it
// (components/castle/CastleMap.tsx). Coordinates are map units (the viewBox).

const C = {
  islandTop: "#1d1539",
  islandRim: "#45377c",
  underside: "#05030b",
  floor: "#271d4b",
  floorDeep: "#1a1234",
  yard: "#252c4f",
  wall: "#b9a7e3",
  wallShade: "#0b0718",
  parapet: "#9a88c8",
  lamp: "#f6b65a",
  moon: "#d3ccff",
  carpet: "#7a1c3a",
  moss: "#2e4a3c",
  well: "#0b0818",
};

// A straight wall with door gaps. `doors` are door centres along the wall.
function wall(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  doors: number[] = [],
  gap = 56
): string {
  const vertical = x1 === x2;
  const start = vertical ? y1 : x1;
  const end = vertical ? y2 : x2;
  const at = (v: number) => (vertical ? `${x1} ${v}` : `${v} ${y1}`);
  let d = "";
  let from = start;
  for (const c of [...doors].sort((a, b) => a - b)) {
    d += `M${at(from)} L${at(c - gap / 2)} `;
    from = c + gap / 2;
  }
  return d + `M${at(from)} L${at(end)}`;
}

const INTERIOR_WALLS = [
  wall(360, 130, 360, 1000, [240, 560]),
  wall(640, 130, 640, 1000, [240, 525, 880]),
  wall(120, 440, 360, 440, [240]),
  wall(120, 680, 360, 680, [240]),
  wall(360, 350, 640, 350, [500], 84),
  wall(360, 760, 640, 760, [500], 100),
  wall(640, 390, 880, 390, [760]),
  wall(640, 660, 880, 660, [760]),
].join(" ");

// The curtain wall leaves the gate (bottom) and the chapel apse (top) open.
const OUTER_WALL = "M455 1000 H120 V130 H190 M290 130 H880 V1000 H545";
const APSE = "M190 130 A50 50 0 0 1 290 130";
// Battlements: a dashed line hugging the outer face of the curtain wall and
// the apse (touching it, so they read as part of the wall).
const MERLONS =
  "M455 1012 H108 V118 H180.9 A61 61 0 0 1 299.1 118 H892 V1012 H545";

const ISLAND =
  "M48 20 L190 34 L300 14 L420 30 L540 12 L660 30 L790 14 L950 22 L990 140 L974 280 L994 420 L972 560 L992 700 L970 840 L990 980 L958 1090 L820 1108 L690 1094 L560 1116 L430 1098 L300 1114 L170 1096 L38 1102 L10 980 L30 840 L8 700 L28 560 L6 420 L26 280 L8 140 Z";

const TOWERS: [number, number][] = [
  [120, 130],
  [880, 130],
  [120, 1000],
  [880, 1000],
];

// Lamp pools: [x, y, radius, strength].
const LAMPS: [number, number, number, number][] = [
  [240, 112, 175, 1],
  [500, 170, 150, 0.9],
  [750, 300, 140, 0.85],
  [500, 410, 150, 0.8],
  [630, 645, 165, 1],
  [250, 570, 135, 0.7],
  [300, 722, 120, 0.55],
  [760, 545, 135, 0.8],
  [858, 770, 175, 1],
  [820, 948, 95, 0.8],
];

// Moss tufts along the island's edge (the lore island is overgrown).
const MOSS: [number, number, number][] = [
  [60, 300, 16],
  [44, 620, 20],
  [70, 890, 14],
  [946, 240, 18],
  [962, 610, 14],
  [930, 900, 20],
  [260, 1066, 18],
  [740, 1062, 16],
  [360, 60, 14],
  [700, 58, 18],
];

export const CastleFloorPlan = memo(function CastleFloorPlan() {
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `${n}-${uid}`;
  const url = (n: string) => `url(#${id(n)})`;

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className="absolute inset-0 h-full w-full"
      style={{ overflow: "visible" }}
      aria-hidden
      focusable="false"
    >
      <defs>
        <radialGradient id={id("lamp")}>
          <stop offset="0" stopColor={C.lamp} stopOpacity="0.34" />
          <stop offset="0.45" stopColor={C.lamp} stopOpacity="0.12" />
          <stop offset="1" stopColor={C.lamp} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id("moon")}>
          <stop offset="0" stopColor={C.moon} stopOpacity="0.2" />
          <stop offset="1" stopColor={C.moon} stopOpacity="0" />
        </radialGradient>
        <filter id={id("drop")} x="-10%" y="-10%" width="120%" height="125%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <pattern id={id("cobble")} width="30" height="22" patternUnits="userSpaceOnUse">
          <rect x="2" y="2" width="26" height="8" rx="4" fill="none" stroke={C.wall} strokeOpacity="0.1" strokeWidth="1.5" />
          <rect x="-13" y="13" width="26" height="8" rx="4" fill="none" stroke={C.wall} strokeOpacity="0.1" strokeWidth="1.5" />
          <rect x="17" y="13" width="26" height="8" rx="4" fill="none" stroke={C.wall} strokeOpacity="0.1" strokeWidth="1.5" />
        </pattern>
        <pattern id={id("flags")} width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M0 0 H44 M0 22 H44 M0 0 V22 M22 22 V44" stroke={C.wall} strokeOpacity="0.08" strokeWidth="2" fill="none" />
        </pattern>
        <clipPath id={id("inside")}>
          <rect x="120" y="130" width="760" height="870" />
          <path d={`${APSE} Z`} />
        </clipPath>
      </defs>

      {/* The island, floating: a blurred shadow underneath, then its top. */}
      <path d={ISLAND} fill={C.underside} opacity="0.85" transform="translate(0 26)" filter={url("drop")} />
      <path d={ISLAND} fill={C.islandTop} stroke={C.islandRim} strokeWidth="4" strokeLinejoin="round" />
      <g fill={C.moss} opacity="0.7">
        {MOSS.map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r} />
            <circle cx={x + r * 0.9} cy={y + r * 0.35} r={r * 0.65} />
            <circle cx={x - r * 0.8} cy={y + r * 0.4} r={r * 0.55} />
          </g>
        ))}
      </g>
      {/* The road out of the gate. */}
      <rect x="462" y="1030" width="76" height="76" fill={C.yard} />
      <rect x="462" y="1030" width="76" height="76" fill={url("cobble")} />

      {/* Floors. */}
      <rect x="120" y="130" width="760" height="870" fill={C.floor} />
      <path d={`${APSE} Z`} fill={C.floor} />
      <rect x="360" y="760" width="280" height="240" fill={C.yard} />
      <rect x="360" y="760" width="280" height="240" fill={url("cobble")} />
      <rect x="120" y="680" width="240" height="320" fill={C.floorDeep} />
      <rect x="120" y="680" width="240" height="320" fill={url("flags")} />

      {/* Light: lamp pools indoors, moonlight in the open courtyard. */}
      <g clipPath={url("inside")}>
        {LAMPS.map(([x, y, r, s], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={url("lamp")} opacity={s} />
        ))}
        <circle cx="500" cy="880" r="190" fill={url("moon")} />
      </g>

      {/* Furniture — faint, so the people stay the focus. */}
      <g stroke={C.wall} strokeOpacity="0.3" strokeWidth="3" fill={C.wall} fillOpacity="0.06" strokeLinecap="round">
        {/* Chapel: altar in the apse, two blocks of pews. */}
        <rect x="215" y="96" width="50" height="18" rx="2" fillOpacity="0.22" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i} strokeWidth="5">
            <line x1="152" y1={255 + i * 30} x2="222" y2={255 + i * 30} />
            <line x1="258" y1={255 + i * 30} x2="328" y2={255 + i * 30} />
          </g>
        ))}

        {/* Throne room: dais, throne, carpet, four pillars. */}
        <rect x="440" y="146" width="120" height="40" rx="3" />
        <rect x="486" y="150" width="28" height="24" rx="4" fillOpacity="0.3" />
        <line x1="448" y1="194" x2="552" y2="194" />
        <rect x="481" y="202" width="38" height="146" fill={C.carpet} fillOpacity="0.5" stroke="none" />
        {[[400, 220], [400, 310], [600, 220], [600, 310]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="10" fillOpacity="0.2" />
        ))}

        {/* Library: shelves on two walls, a round reading table. */}
        <rect x="742" y="144" width="124" height="14" />
        <rect x="852" y="172" width="14" height="196" />
        <line x1="746" y1="151" x2="862" y2="151" strokeWidth="9" strokeDasharray="2 5" strokeOpacity="0.4" />
        <line x1="859" y1="176" x2="859" y2="364" strokeWidth="9" strokeDasharray="2 5" strokeOpacity="0.4" />
        <circle cx="750" cy="300" r="30" />
        {[[750, 258], [750, 342], [708, 300], [792, 300]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="7" />
        ))}

        {/* Infirmary: a row of beds. */}
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <rect x="136" y={500 + i * 45} width="66" height="32" rx="4" />
            <rect x="139" y={503 + i * 45} width="13" height="26" rx="2" fillOpacity="0.25" />
          </g>
        ))}

        {/* Great hall: high table, two long tables with benches, hearth. */}
        <rect x="420" y="402" width="160" height="18" rx="3" />
        <rect x="422" y="450" width="30" height="262" rx="4" />
        <rect x="548" y="450" width="30" height="262" rx="4" />
        <g strokeWidth="4">
          <line x1="412" y1="458" x2="412" y2="704" />
          <line x1="462" y1="458" x2="462" y2="704" />
          <line x1="538" y1="458" x2="538" y2="704" />
          <line x1="588" y1="458" x2="588" y2="704" />
        </g>
        <rect x="616" y="610" width="18" height="70" fill={C.lamp} fillOpacity="0.22" />

        {/* Chambers: two beds and a rug. */}
        <ellipse cx="760" cy="580" rx="54" ry="30" fill={C.carpet} fillOpacity="0.32" stroke="none" />
        <rect x="660" y="470" width="64" height="90" rx="6" />
        <rect x="664" y="474" width="56" height="16" rx="3" fillOpacity="0.25" />
        <rect x="796" y="470" width="64" height="90" rx="6" />
        <rect x="800" y="474" width="56" height="16" rx="3" fillOpacity="0.25" />
        <rect x="740" y="620" width="40" height="22" rx="2" />

        {/* Dungeon: the guards' table, shackles on the cell's back wall. */}
        <rect x="270" y="706" width="56" height="30" rx="3" />
        {[170, 240, 310].map((x) => (
          <g key={x}>
            <line x1={x} y1="1000" x2={x} y2="978" strokeDasharray="4 4" />
            <circle cx={x} cy="972" r="7" fill="none" />
          </g>
        ))}

        {/* Courtyard: the well and shrubs in the corners. */}
        <circle cx="500" cy="895" r="24" strokeWidth="5" strokeOpacity="0.5" />
        <circle cx="500" cy="895" r="14" fill={C.well} fillOpacity="1" stroke="none" />

        {/* Kitchens: hearth, work table, oven, barrels. */}
        <rect x="852" y="700" width="20" height="140" fill={C.lamp} fillOpacity="0.2" />
        <rect x="690" y="790" width="110" height="38" rx="3" />
        <circle cx="820" cy="948" r="30" />
        <circle cx="820" cy="948" r="18" fill={C.lamp} fillOpacity="0.18" />
        {[[668, 972], [696, 980], [668, 944]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="13" />
        ))}
      </g>
      <g fill={C.moss} opacity="0.8">
        {[[384, 980], [616, 980], [384, 784], [616, 784]].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="15" />
            <circle cx={x + (x < 500 ? 14 : -14)} cy={y + (y > 900 ? -6 : 6)} r="10" />
          </g>
        ))}
      </g>

      {/* Walls: a dark offset first, so they read as standing up. */}
      <g fill="none" stroke={C.wallShade} strokeOpacity="0.85" transform="translate(3 6)">
        <path d={INTERIOR_WALLS} strokeWidth="10" />
        <path d={`${OUTER_WALL} ${APSE}`} strokeWidth="18" />
      </g>
      <g fill="none" stroke={C.wall} strokeLinejoin="miter">
        <path d={INTERIOR_WALLS} strokeWidth="9" />
        <path d={OUTER_WALL} strokeWidth="18" />
        <path d={APSE} strokeWidth="16" />
        <path d={MERLONS} stroke={C.parapet} strokeWidth="8" strokeDasharray="14 11" />
      </g>

      {/* The dungeon cell's bars. */}
      <line x1="120" y1="780" x2="360" y2="780" stroke={C.wall} strokeWidth="3" strokeOpacity="0.7" />
      <line x1="126" y1="780" x2="356" y2="780" stroke={C.wall} strokeWidth="16" strokeDasharray="3 10" />

      {/* Gatehouse + portcullis. */}
      <g fill={C.floor} stroke={C.wall} strokeWidth="10">
        <rect x="410" y="982" width="46" height="52" />
        <rect x="544" y="982" width="46" height="52" />
      </g>
      <line x1="458" y1="1004" x2="542" y2="1004" stroke={C.wall} strokeWidth="12" strokeDasharray="3 8" strokeOpacity="0.8" />

      {/* Corner towers with their stairs. */}
      {TOWERS.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x + 3} cy={y + 6} r="56" fill={C.wallShade} opacity="0.85" />
          <circle cx={x} cy={y} r="64" fill="none" stroke={C.parapet} strokeWidth="8" strokeDasharray="13 10" />
          <circle cx={x} cy={y} r="54" fill={C.floor} stroke={C.wall} strokeWidth="14" />
          {/* The spiral stair, round its newel post. */}
          <circle cx={x} cy={y} r="7" fill={C.wall} fillOpacity="0.3" />
          <path
            d={`M${x + 7} ${y} A10 10 0 0 1 ${x - 13} ${y} A16 16 0 0 1 ${x + 19} ${y} A22 22 0 0 1 ${x - 25} ${y} A28 28 0 0 1 ${x + 31} ${y}`}
            fill="none"
            stroke={C.wall}
            strokeOpacity="0.3"
            strokeWidth="3"
          />
        </g>
      ))}
    </svg>
  );
});
