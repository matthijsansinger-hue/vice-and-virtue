"use client";

import { memo, useId } from "react";
import { MAP_W, MAP_H } from "@/lib/castle";
import { WELL, YARD } from "@/lib/courtyard";

// The courtyard plan for Outreach: the open yard at the heart of the castle,
// drawn by day as a brown-ink plan on parchment — the Outreach palette, where
// the role-action castle map is moonlit. The Great Hall closes the top, the
// Gatehouse the bottom, the two side wings the left and right (all kept thin,
// so the yard holds a full game on a phone); the well sits in the middle. Two
// corners mean something: hospitalised players sit under the Infirmary's
// awning (top-left) and prisoners look up through the Dungeon grates
// (bottom-left). Zones and labels live in lib/courtyard.ts; tokens and labels
// are HTML on top (components/castle/CastleMap.tsx). Everything inside is
// placed relative to the yard and the well.

const D = {
  sheet: "#efe7cf",
  sheetEdge: "#cdbd96",
  roof: "#ddd0b0",
  ink: "#735333",
  yard: "#e8e2ce",
  path: "#ddd2b4",
  green: "#a6a670",
  greenDark: "#7a7a46",
  water: "#5d7d88",
  wood: "#8a6a45",
  iron: "#40362c",
  glass: "#b9cbcf",
  cream: "#f6efdc",
};

const X0 = YARD.x;
const Y0 = YARD.y;
const X1 = YARD.x + YARD.w;
const Y1 = YARD.y + YARD.h;
// The sheet's inner edge, where the wings' roofs end.
const E = { l: 20, t: 22, r: 980, b: MAP_H - 22 };

const TOWER_R = 40;
const TOWERS: [number, number][] = [
  [50, 52],
  [950, 52],
  [50, MAP_H - 52],
  [950, MAP_H - 52],
];

const TREES: [number, number, number][] = [
  [X1 - 78, Y0 + 92, 52],
  [X1 - 78, Y1 - 82, 48],
  [X0 + 96, (Y0 + Y1) / 2 + 30, 42],
];

// Doors in the side walls (y of their top edge).
const INFIRMARY_DOOR = Y0 + 100;
const DUNGEON_DOOR = Y1 - 190;
const KITCHEN_DOOR = WELL.y;

export const CourtyardPlan = memo(function CourtyardPlan() {
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `${n}-${uid}`;
  const url = (n: string) => `url(#${id(n)})`;
  const wings = [
    { x: E.l, y: E.t, w: E.r - E.l, h: Y0 - E.t, rx: 10 },
    { x: E.l, y: Y1, w: E.r - E.l, h: E.b - Y1, rx: 10 },
    { x: E.l, y: Y0, w: X0 - E.l, h: YARD.h, rx: 0 },
    { x: X1, y: Y0, w: E.r - X1, h: YARD.h, rx: 0 },
  ];

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className="absolute inset-0 h-full w-full"
      style={{ overflow: "visible" }}
      aria-hidden
      focusable="false"
    >
      <defs>
        <filter id={id("lift")} x="-6%" y="-6%" width="112%" height="114%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#2f2112" floodOpacity="0.35" />
        </filter>
        {/* Roof tiles: fine diagonal hatching. */}
        <pattern id={id("tiles")} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="14" stroke={D.ink} strokeOpacity="0.22" strokeWidth="2" />
        </pattern>
        {/* Flagstones, staggered. */}
        <pattern id={id("flags")} width="80" height="56" patternUnits="userSpaceOnUse">
          <path
            d="M0 0 H80 M0 28 H80 M0 0 V28 M40 28 V56 M54 0 V28 M14 28 V56"
            stroke={D.ink}
            strokeOpacity="0.13"
            strokeWidth="2"
            fill="none"
          />
        </pattern>
        <pattern id={id("awning")} width="36" height="10" patternUnits="userSpaceOnUse">
          <rect width="18" height="10" fill={D.green} />
          <rect x="18" width="18" height="10" fill={D.cream} />
        </pattern>
      </defs>

      {/* The sheet. */}
      <rect x="6" y="6" width={MAP_W - 12} height={MAP_H - 12} rx="26" fill={D.sheet} filter={url("lift")} />
      <rect x="6" y="6" width={MAP_W - 12} height={MAP_H - 12} rx="26" fill="none" stroke={D.sheetEdge} strokeWidth="3" />

      {/* The four wings: tiled roofs with a ridge each. */}
      <g fill={D.roof} stroke={D.ink} strokeWidth="3">
        {wings.map((w, i) => (
          <rect key={i} x={w.x} y={w.y} width={w.w} height={w.h} rx={w.rx} />
        ))}
      </g>
      <g fill={url("tiles")}>
        {wings.map((w, i) => (
          <rect key={i} x={w.x} y={w.y} width={w.w} height={w.h} rx={w.rx} />
        ))}
      </g>
      <g stroke={D.ink} strokeWidth="3" strokeOpacity="0.55" strokeLinecap="round" fill="none">
        <path d={`M${X0} ${(E.t + Y0) / 2} H${X1}`} />
        <path d={`M${X0} ${(Y1 + E.b) / 2} H${X1}`} />
        <path d={`M${(E.l + X0) / 2} ${Y0} V${Y1}`} />
        <path d={`M${(X1 + E.r) / 2} ${Y0} V${Y1}`} />
        {/* Hips where the wings meet. */}
        <path d={`M${X0} ${Y0} L${(E.l + X0) / 2} ${(E.t + Y0) / 2}`} />
        <path d={`M${X1} ${Y0} L${(X1 + E.r) / 2} ${(E.t + Y0) / 2}`} />
        <path d={`M${X0} ${Y1} L${(E.l + X0) / 2} ${(Y1 + E.b) / 2}`} />
        <path d={`M${X1} ${Y1} L${(X1 + E.r) / 2} ${(Y1 + E.b) / 2}`} />
      </g>
      {/* The kitchens' chimney, right wing. */}
      <rect x={(X1 + E.r) / 2 - 16} y={KITCHEN_DOOR - 70} width="32" height="32" fill={D.roof} stroke={D.ink} strokeWidth="3" />
      <rect x={(X1 + E.r) / 2 - 9} y={KITCHEN_DOOR - 63} width="18" height="18" fill={D.iron} opacity="0.7" />

      {/* Corner towers with conical roofs. */}
      {TOWERS.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={TOWER_R} fill={D.roof} stroke={D.ink} strokeWidth="4" />
          <path
            d={`M${x} ${y - TOWER_R} V${y + TOWER_R} M${x - TOWER_R} ${y} H${x + TOWER_R} M${x - 28} ${y - 28} L${x + 28} ${y + 28} M${x + 28} ${y - 28} L${x - 28} ${y + 28}`}
            stroke={D.ink}
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          <circle cx={x} cy={y} r="6" fill={D.ink} />
        </g>
      ))}

      {/* The yard: flagstones, and the walk from the gate to the hall. */}
      <rect x={X0} y={Y0} width={YARD.w} height={YARD.h} fill={D.yard} />
      <rect x={X0} y={Y0} width={YARD.w} height={YARD.h} fill={url("flags")} />
      <rect x={WELL.x - 38} y={Y0} width="76" height={YARD.h} fill={D.path} />
      <circle cx={WELL.x} cy={WELL.y} r="84" fill={D.path} stroke={D.ink} strokeOpacity="0.25" strokeWidth="2" />

      {/* The facades around the yard, with their doors. */}
      <g stroke={D.ink} strokeWidth="7" fill="none" strokeLinecap="butt">
        <path d={`M${X0} ${Y0} H${WELL.x - 60} M${WELL.x + 60} ${Y0} H${X1}`} />
        <path d={`M${X0} ${Y1} H${WELL.x - 48} M${WELL.x + 48} ${Y1} H${X1}`} />
        <path
          d={`M${X0} ${Y0} V${INFIRMARY_DOOR} M${X0} ${INFIRMARY_DOOR + 60} V${DUNGEON_DOOR} M${X0} ${DUNGEON_DOOR + 60} V${Y1}`}
        />
        <path d={`M${X1} ${Y0} V${KITCHEN_DOOR} M${X1} ${KITCHEN_DOOR + 60} V${Y1}`} />
      </g>
      {/* Great Hall: double door and three steps down into the yard. */}
      <rect x={WELL.x - 60} y={Y0 - 14} width="120" height="14" fill={D.wood} stroke={D.ink} strokeWidth="3" />
      <path d={`M${WELL.x} ${Y0 - 14} V${Y0}`} stroke={D.ink} strokeWidth="2" />
      <g stroke={D.ink} strokeOpacity="0.5" strokeWidth="3">
        <path
          d={`M${WELL.x - 70} ${Y0 + 14} H${WELL.x + 70} M${WELL.x - 76} ${Y0 + 28} H${WELL.x + 76} M${WELL.x - 82} ${Y0 + 42} H${WELL.x + 82}`}
        />
      </g>
      {/* Hall windows. */}
      {[X0 + 110, X0 + 210, X1 - 230, X1 - 130].map((x) => (
        <rect key={x} x={x} y={Y0 - 10} width="40" height="10" fill={D.glass} stroke={D.ink} strokeWidth="2" />
      ))}
      {/* A flower bed along the hall (the left corner is the Infirmary's). */}
      <g>
        <rect x={X1 - 230} y={Y0 + 12} width="120" height="22" rx="6" fill={D.green} fillOpacity="0.7" stroke={D.greenDark} strokeWidth="2" />
        {[16, 40, 64, 88, 108].map((dx) => (
          <circle key={dx} cx={X1 - 230 + dx} cy={Y0 + 23} r="4" fill={D.cream} />
        ))}
      </g>

      {/* Gatehouse: the passage, its towers and the portcullis. */}
      <rect x={WELL.x - 48} y={Y1} width="96" height={E.b - Y1} fill={D.path} />
      <g fill={D.roof} stroke={D.ink} strokeWidth="4">
        <rect x={WELL.x - 104} y={Y1 - 18} width="56" height="60" />
        <rect x={WELL.x + 48} y={Y1 - 18} width="56" height="60" />
      </g>
      <path d={`M${WELL.x - 44} ${Y1 + 4} H${WELL.x + 44}`} stroke={D.iron} strokeWidth="10" strokeDasharray="3 8" />

      {/* The Infirmary corner: a striped awning over three cots, its door. */}
      <rect x={X0 + 12} y={Y0 + 44} width="232" height="44" fill={url("awning")} stroke={D.ink} strokeWidth="3" />
      <path
        d={`M${X0 + 12} ${Y0 + 88} q14.5 14 29 0 q14.5 14 29 0 q14.5 14 29 0 q14.5 14 29 0 q14.5 14 29 0 q14.5 14 29 0 q14.5 14 29 0 q14.5 14 29 0`}
        fill={D.cream}
        stroke={D.ink}
        strokeWidth="2.5"
      />
      {[X0 + 70, X0 + 134, X0 + 198].map((x) => (
        <g key={x}>
          <rect x={x - 20} y={Y0 + 114} width="40" height="76" rx="5" fill={D.cream} stroke={D.ink} strokeWidth="2.5" />
          <rect x={x - 14} y={Y0 + 119} width="28" height="14" rx="4" fill="#fff" stroke={D.ink} strokeWidth="1.5" />
        </g>
      ))}
      <rect x={X0 - 12} y={INFIRMARY_DOOR} width="12" height="60" fill={D.wood} stroke={D.ink} strokeWidth="2" />

      {/* The Dungeon corner: barred grates in the ground and the iron door. */}
      {[
        [X0 + 46, Y1 - 106],
        [X0 + 134, Y1 - 128],
        [X0 + 220, Y1 - 94],
      ].map(([x, y]) => (
        <g key={x}>
          <rect x={x} y={y} width="58" height="36" rx="3" fill={D.iron} stroke={D.ink} strokeWidth="3" />
          <path
            d={`M${x + 10} ${y} V${y + 36} M${x + 20} ${y} V${y + 36} M${x + 29} ${y} V${y + 36} M${x + 38} ${y} V${y + 36} M${x + 48} ${y} V${y + 36}`}
            stroke="#9a8f80"
            strokeWidth="3"
          />
        </g>
      ))}
      <rect x={X0 - 12} y={DUNGEON_DOOR} width="12" height="60" fill={D.iron} stroke={D.ink} strokeWidth="2" />
      {[14, 30, 46].map((dy) => (
        <circle key={dy} cx={X0 - 6} cy={DUNGEON_DOOR + dy} r="2.4" fill="#b8ad9c" />
      ))}

      {/* Kitchens: the door, barrels and a cart. */}
      <rect x={X1} y={KITCHEN_DOOR} width="12" height="60" fill={D.wood} stroke={D.ink} strokeWidth="2" />
      {[
        [X1 - 34, KITCHEN_DOOR - 20],
        [X1 - 34, KITCHEN_DOOR + 90],
        [X1 - 62, KITCHEN_DOOR + 102],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="16" fill={D.wood} stroke={D.ink} strokeWidth="2.5" />
          <circle cx={x} cy={y} r="9" fill="none" stroke={D.ink} strokeOpacity="0.5" strokeWidth="2" />
        </g>
      ))}

      {/* Trees: round canopies. */}
      {TREES.map(([x, y, r]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x + 6} cy={y + 8} r={r} fill={D.ink} opacity="0.12" />
          <circle cx={x} cy={y} r={r} fill={D.green} fillOpacity="0.85" stroke={D.greenDark} strokeWidth="3" />
          <path
            d={`M${x - r * 0.5} ${y - r * 0.1} a${r * 0.35} ${r * 0.35} 0 0 1 ${r * 0.55} ${-r * 0.3} M${x + r * 0.05} ${y + r * 0.35} a${r * 0.3} ${r * 0.3} 0 0 1 ${r * 0.5} ${-r * 0.2}`}
            fill="none"
            stroke={D.greenDark}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      ))}

      {/* The well: stone ring, water, the winch beam and its bucket. */}
      <circle cx={WELL.x} cy={WELL.y} r="42" fill={D.roof} stroke={D.ink} strokeWidth="4" />
      <circle cx={WELL.x} cy={WELL.y} r="27" fill={D.water} stroke={D.ink} strokeWidth="2" />
      <rect x={WELL.x - 52} y={WELL.y - 5} width="104" height="10" rx="2" fill={D.wood} stroke={D.ink} strokeWidth="2.5" />
      <circle cx={WELL.x + 14} cy={WELL.y} r="7" fill={D.wood} stroke={D.ink} strokeWidth="2" />
      {/* Benches by the well. */}
      <rect
        x={WELL.x - 72}
        y={WELL.y - 93}
        width="62"
        height="12"
        rx="3"
        fill={D.wood}
        stroke={D.ink}
        strokeWidth="2"
        transform={`rotate(-24 ${WELL.x - 41} ${WELL.y - 87})`}
      />
      <rect
        x={WELL.x + 12}
        y={WELL.y + 81}
        width="62"
        height="12"
        rx="3"
        fill={D.wood}
        stroke={D.ink}
        strokeWidth="2"
        transform={`rotate(-24 ${WELL.x + 43} ${WELL.y + 87})`}
      />
    </svg>
  );
});
