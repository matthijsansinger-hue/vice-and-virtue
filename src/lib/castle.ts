// The castle map used by the interactive role actions (Murder first; every
// role will move onto it). This file is the map's geometry and the placement
// of player tokens — the drawing itself is components/castle/CastleFloorPlan.
//
// Coordinates are "map units": the map is MAP_W × MAP_H, and the SVG uses the
// same numbers as its viewBox, so a token at (x, y) sits on the floor plan
// wherever the map is drawn and however big.
//
// Where a token lands carries information: imprisoned players stand in the
// Dungeon cell, hospitalised players in the Infirmary, and everyone else is
// scattered at random over the remaining rooms. The scatter is seeded by the
// room, the day and the viewer, so it holds still through re-renders and
// refreshes but changes every day.

export const MAP_W = 1000;
export const MAP_H = 1120;

export type Rect = { x: number; y: number; w: number; h: number };

// "free" rooms take anyone who's free; the other two are reserved.
export type RoomKind = "free" | "prison" | "hospital";

export type CastleRoom = {
  id: string;
  name: string;
  kind: RoomKind;
  // The room's floor.
  floor: Rect;
  // Where a token's centre may land (inset from the walls, below the label).
  spawn: Rect;
  // Where the label starts, when the top-left corner is taken (a tower).
  labelAt?: { x: number; y: number };
};

export const CASTLE_ROOMS: CastleRoom[] = [
  {
    id: "chapel",
    name: "Chapel",
    kind: "free",
    floor: { x: 120, y: 130, w: 240, h: 310 },
    spawn: { x: 150, y: 205, w: 180, h: 210 },
    // The corner tower covers the top-left; start right of it.
    labelAt: { x: 186, y: 144 },
  },
  {
    id: "throne",
    name: "Throne Room",
    kind: "free",
    floor: { x: 360, y: 130, w: 280, h: 220 },
    spawn: { x: 395, y: 205, w: 210, h: 125 },
  },
  {
    id: "library",
    name: "Library",
    kind: "free",
    floor: { x: 640, y: 130, w: 240, h: 260 },
    spawn: { x: 670, y: 205, w: 180, h: 165 },
  },
  {
    id: "infirmary",
    name: "Infirmary",
    kind: "hospital",
    floor: { x: 120, y: 440, w: 240, h: 240 },
    spawn: { x: 160, y: 505, w: 175, h: 160 },
  },
  {
    id: "hall",
    name: "Great Hall",
    kind: "free",
    floor: { x: 360, y: 350, w: 280, h: 410 },
    spawn: { x: 395, y: 425, w: 210, h: 310 },
  },
  {
    id: "chambers",
    name: "Chambers",
    kind: "free",
    floor: { x: 640, y: 390, w: 240, h: 270 },
    spawn: { x: 670, y: 465, w: 180, h: 170 },
  },
  {
    id: "dungeon",
    name: "Dungeon",
    kind: "prison",
    floor: { x: 120, y: 680, w: 240, h: 320 },
    spawn: { x: 150, y: 812, w: 185, h: 170 },
  },
  {
    id: "courtyard",
    name: "Courtyard",
    kind: "free",
    floor: { x: 360, y: 760, w: 280, h: 240 },
    spawn: { x: 395, y: 835, w: 210, h: 140 },
  },
  {
    id: "kitchens",
    name: "Kitchens",
    kind: "free",
    floor: { x: 640, y: 660, w: 240, h: 340 },
    spawn: { x: 670, y: 735, w: 180, h: 240 },
  },
];

// Room labels sit in the top-left corner of each floor.
export const LABEL_INSET = { x: 16, y: 14 };

export function labelPos(r: CastleRoom): { x: number; y: number } {
  return r.labelAt ?? { x: r.floor.x + LABEL_INSET.x, y: r.floor.y + LABEL_INSET.y };
}

// ---- Sizes --------------------------------------------------------------

// Token + label sizes in CSS px for a map drawn `mapPx` wide. Tokens are HTML
// (so names stay legible on a phone), which makes their size relative to the
// map change with the map's width — placement needs these numbers too.
export type MapMetrics = {
  avatar: number;
  font: number;
  barMax: number;
  barH: number;
  labelFont: number;
  // Map units per CSS px.
  unit: number;
};

const clamp = (min: number, v: number, max: number) => Math.min(max, Math.max(min, v));

export function mapMetrics(mapPx: number): MapMetrics {
  const font = clamp(10, mapPx * 0.024, 13.5);
  return {
    avatar: clamp(26, mapPx * 0.072, 46),
    font,
    barMax: clamp(64, mapPx * 0.19, 124),
    barH: Math.round(font * 1.35 + 6),
    labelFont: clamp(10, mapPx * 0.025, 15),
    unit: MAP_W / Math.max(1, mapPx),
  };
}

// Width of a name bar in px (an estimate — real text is measured by the
// browser; this only has to be close enough to keep tokens apart).
export function barWidthPx(name: string, m: MapMetrics): number {
  return Math.max(m.avatar, Math.min(m.barMax, name.length * m.font * 0.6 + 14));
}

// ---- Placement ----------------------------------------------------------

// "dead" tokens only appear on maps that show the dead (Certainty can read a
// dead player's role): they lie in the Chapel, which the living then avoid.
export type TokenKind = RoomKind | "dead";

export type TokenInput = {
  id: string;
  name: string;
  kind: TokenKind; // which kind of room this player belongs in
};

export type PlacedToken = { id: string; x: number; y: number; roomId: string };

// FNV-1a: a small, stable string hash.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32: a tiny seeded random generator → [0, 1).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Box = { x: number; y: number; w: number; h: number }; // centre + size

// Gap between two boxes: positive = apart by that much, negative = overlap.
function gap(a: Box, b: Box): number {
  return Math.max(
    Math.abs(a.x - b.x) - (a.w + b.w) / 2,
    Math.abs(a.y - b.y) - (a.h + b.h) / 2
  );
}

// Enough room between two tokens that they read as separate (map units).
const COMFORT = 14;
// Spots tried per token; the reserved rooms are small, so they try harder.
const CANDIDATES = { free: 48, prison: 120, hospital: 120, dead: 120 } as const;

// Scatter the tokens over the castle. Each token tries random spots in its
// rooms and keeps the first one that clears every token already placed (and
// the room labels); when none does — a crowded map — it keeps the spot that
// overlaps least. Reserved rooms (dungeon, infirmary) fill first since their
// space is the tightest.
export function placeTokens(
  tokens: TokenInput[],
  seed: string,
  m: MapMetrics
): PlacedToken[] {
  const rand = rng(hash(seed));
  const sizeOf = (name: string) => ({
    w: barWidthPx(name, m) * m.unit,
    h: (m.avatar + 3 + m.barH) * m.unit,
  });

  // Room labels are obstacles, so tokens don't sit on them.
  const placed: Box[] = CASTLE_ROOMS.map((r) => {
    const w = (r.name.length * m.labelFont * 0.66 + 6) * m.unit;
    const h = m.labelFont * 1.4 * m.unit;
    const at = labelPos(r);
    return { x: at.x + w / 2, y: at.y + h / 2, w, h };
  });

  // Seeded shuffle, then reserved rooms first.
  const order = tokens
    .map((t) => ({ t, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t)
    .sort((a, b) => Number(a.kind === "free") - Number(b.kind === "free"));

  const anyDead = tokens.some((t) => t.kind === "dead");
  const roomsFor = (k: TokenKind) =>
    k === "dead"
      ? CASTLE_ROOMS.filter((r) => r.id === "chapel")
      : CASTLE_ROOMS.filter((r) => r.kind === k && !(anyDead && r.id === "chapel"));

  const out: PlacedToken[] = [];
  for (const t of order) {
    const rooms = roomsFor(t.kind);
    const total = rooms.reduce((s, r) => s + r.spawn.w * r.spawn.h, 0);
    const { w, h } = sizeOf(t.name);

    let best: { box: Box; room: CastleRoom; score: number } | null = null;
    for (let i = 0; i < CANDIDATES[t.kind]; i++) {
      // A room weighted by its floor space, then a spot inside it.
      let pick = rand() * total;
      let room = rooms[rooms.length - 1];
      for (const r of rooms) {
        pick -= r.spawn.w * r.spawn.h;
        if (pick <= 0) {
          room = r;
          break;
        }
      }
      const box: Box = {
        x: room.spawn.x + rand() * room.spawn.w,
        y: room.spawn.y + rand() * room.spawn.h,
        w,
        h,
      };
      // Keep the whole token on the map.
      box.x = Math.min(MAP_W - w / 2, Math.max(w / 2, box.x));
      box.y = Math.min(MAP_H - h / 2, Math.max(h / 2, box.y));

      let score = Infinity;
      for (const p of placed) score = Math.min(score, gap(box, p));
      // Clear of everyone: good enough — keep the first such spot, so the
      // scatter stays random instead of drifting into the corners.
      score = Math.min(score, COMFORT);
      if (!best || score > best.score) best = { box, room, score };
      if (score >= COMFORT) break;
    }
    if (!best) continue;
    placed.push(best.box);
    out.push({ id: t.id, x: best.box.x, y: best.box.y, roomId: best.room.id });
  }
  return out;
}

export function roomById(id: string): CastleRoom | undefined {
  return CASTLE_ROOMS.find((r) => r.id === id);
}
