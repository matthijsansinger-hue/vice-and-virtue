// The courtyard map used in Outreach: the open yard at the heart of the castle
// (the Courtyard room of lib/castle.ts, seen close up). Every living player
// stands in it, and the people who are talking to each other gather into a
// huddle, so anyone can see who's talking — that's the point of the map.
//
// Same units as the castle map (MAP_W × MAP_H), so tokens, metrics and the
// placement in lib/castle.ts work unchanged. The drawing is
// components/castle/CourtyardPlan.tsx.

import {
  COMFORT,
  MAP_H,
  MAP_W,
  gap,
  hash,
  labelBoxes,
  rng,
  tokenSize,
  type Box,
  type CastleRoom,
  type MapMetrics,
  type MapPlan,
  type PlacedToken,
} from "./castle";

// The yard: open stone between the four wings of the castle. The wings are
// kept thin so the yard holds a full game (16–20 people) even on a phone.
export const YARD = { x: 76, y: 140, w: 848, h: 880 };
// The well in the middle of the yard.
export const WELL = { x: 500, y: 580 };

const X0 = YARD.x;
const Y0 = YARD.y;
const X1 = YARD.x + YARD.w;
const Y1 = YARD.y + YARD.h;
// The middle column (the well) that the four open zones surround.
const MID_L = X0 + 250;
const MID_R = 640;

const ZONES: CastleRoom[] = [
  // Hospitalised players sit under the infirmary's awning (top-left corner).
  {
    id: "infirmary",
    name: "Infirmary",
    kind: "hospital",
    floor: { x: X0, y: Y0, w: 290, h: 230 },
    spawn: { x: X0 + 50, y: Y0 + 100, w: 220, h: 110 },
  },
  // Prisoners look up through the dungeon grates (bottom-left corner).
  {
    id: "dungeon",
    name: "Dungeon",
    kind: "prison",
    floor: { x: X0, y: Y1 - 240, w: 320, h: 240 },
    spawn: { x: X0 + 50, y: Y1 - 150, w: 230, h: 125 },
  },
  // Everyone else stands anywhere in the yard, around the well.
  {
    id: "yard-north",
    name: "courtyard",
    kind: "free",
    floor: { x: MID_L, y: Y0, w: X1 - MID_L, h: 250 },
    spawn: { x: MID_L + 40, y: Y0 + 100, w: X1 - 40 - (MID_L + 40), h: 130 },
  },
  {
    id: "yard-west",
    name: "courtyard",
    kind: "free",
    floor: { x: X0, y: Y0 + 230, w: 250, h: Y1 - 240 - (Y0 + 230) },
    spawn: { x: X0 + 45, y: Y0 + 280, w: 175, h: Y1 - 290 - (Y0 + 280) },
  },
  {
    id: "yard-east",
    name: "courtyard",
    kind: "free",
    floor: { x: MID_R, y: Y0 + 250, w: X1 - MID_R, h: Y1 - (Y0 + 250) },
    spawn: { x: MID_R + 40, y: Y0 + 290, w: X1 - 40 - (MID_R + 40), h: Y1 - 40 - (Y0 + 290) },
  },
  {
    id: "yard-south",
    name: "courtyard",
    kind: "free",
    floor: { x: MID_L, y: WELL.y + 95, w: MID_R - MID_L, h: Y1 - (WELL.y + 95) },
    spawn: { x: MID_L + 30, y: WELL.y + 145, w: MID_R - 40 - (MID_L + 30), h: Y1 - 40 - (WELL.y + 145) },
  },
];

export const COURTYARD_PLAN: MapPlan = {
  rooms: ZONES,
  labels: [
    { text: "Great Hall", x: 420, y: 62 },
    { text: "Gatehouse", x: 110, y: 1046 },
    { text: "Infirmary", x: X0 + 18, y: Y0 + 14 },
    { text: "Dungeon", x: X0 + 18, y: Y1 - 226 },
    { text: "Well", x: WELL.x - 18, y: WELL.y + 61 },
  ],
};

// ---- Huddles ---------------------------------------------------------------

// One conversation link, from outreach_state (migration 146): `a` wrote first,
// to `b`, at `at`. Never what was said.
export type Talk = { a: string; b: string; at: string };

// Gather the people who are talking. Everyone linked by messages (directly or
// through someone) forms one huddle — but every chat is still one-on-one, so
// each person stands next to the person they're talking to, and the map draws
// one link per chat (never a ring around a "group"). A huddle's anchor stays
// put — a prisoner or a hospitalised player if there is one (they can't walk),
// otherwise whoever was written to first — and the others join chat by chat,
// each walking to the free spot beside their partner nearest to where they
// stood. Anyone the huddles land on steps aside. Returns the new positions and
// the chats to draw (one [a, b] per pair).
export function huddle(
  base: PlacedToken[],
  talks: Talk[],
  opts: {
    fixed: (id: string) => boolean;
    nameOf: (id: string) => string;
    m: MapMetrics;
    plan: MapPlan;
    seed: string;
    // Where people can stand (the yard — not on the roofs).
    area?: { x: number; y: number; w: number; h: number };
  }
): { placed: PlacedToken[]; links: [string, string][] } {
  const { fixed, nameOf, m, plan, seed } = opts;
  const area = opts.area ?? { x: 0, y: 0, w: MAP_W, h: MAP_H };
  const present = new Set(base.map((t) => t.id));
  const links = talks
    .filter((t) => t.a !== t.b && present.has(t.a) && present.has(t.b))
    .sort((x, y) => x.at.localeCompare(y.at));
  if (links.length === 0) return { placed: base, links: [] };

  // Union-find over the links.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  for (const { a, b } of links) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  // Groups, members in the order they joined the conversation.
  const groupsByRoot = new Map<string, { members: string[]; firstTo: string }>();
  for (const { a, b } of links) {
    const root = find(a);
    let g = groupsByRoot.get(root);
    if (!g) {
      g = { members: [], firstTo: b };
      groupsByRoot.set(root, g);
    }
    for (const id of [b, a]) if (!g.members.includes(id)) g.members.push(id);
  }

  const at = new Map(base.map((t) => [t.id, { ...t }]));
  const sizeOf = (id: string) => tokenSize(nameOf(id), m);
  const boxOf = (id: string): Box => {
    const t = at.get(id)!;
    return { x: t.x, y: t.y, ...sizeOf(id) };
  };
  // The whole token inside the walkable area (a little slack at the edges).
  type Rect = { x: number; y: number; w: number; h: number };
  const slack = 12;
  const inside = (b: Box, r: Rect) =>
    b.x - b.w / 2 >= r.x - slack &&
    b.x + b.w / 2 <= r.x + r.w + slack &&
    b.y - b.h / 2 >= r.y - slack &&
    b.y + b.h / 2 <= r.y + r.h + slack;
  const inMap = (b: Box) => inside(b, area);

  // The space between two people in a chat — room for the link the map draws
  // between them.
  const step = 24 * m.unit;
  // How far out the spots around a partner go, as multiples of "just beside".
  const RADII = [1, 1.2, 1.45, 1.75, 2.1, 2.5, 3, 3.6];
  const rand = rng(hash(seed + ":aside"));
  const labels = labelBoxes(plan, m);

  // The nearest spot to `b` that clears `avoid` (spiralling out), else the
  // least crowded one tried.
  const clearSpot = (b: Box, avoid: Box[], within: Rect = area): Box => {
    let best = b;
    let bestScore = -Infinity;
    for (let i = 0; i < 60; i++) {
      const r = 40 + i * 6;
      const ang = rand() * Math.PI * 2;
      const c: Box = { ...b, x: b.x + Math.cos(ang) * r, y: b.y + Math.sin(ang) * r };
      if (!inside(c, within)) continue;
      let score = Infinity;
      for (const o of avoid) score = Math.min(score, gap(c, o));
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
      if (score >= COMFORT) break;
    }
    return best;
  };

  const groupList = [...groupsByRoot.values()].map((g) => ({
    ...g,
    anchor: g.members.find(fixed) ?? g.firstTo,
  }));

  const huddled: Box[] = [];

  // People who aren't in any chat, where they stand: a newcomer walking over
  // prefers a spot that doesn't push one of them aside.
  const talking = new Set(groupList.flatMap((g) => g.members));
  const idle = base.filter((t) => !talking.has(t.id));
  const bystanders = idle.filter((t) => !fixed(t.id)).map((t) => boxOf(t.id));
  // Prisoners and the hospitalised can't step aside, so nobody stands on them.
  const stuck = idle.filter((t) => fixed(t.id)).map((t) => boxOf(t.id));

  // Walk `id` over to stand beside `host`.
  const joinNextTo = (id: string, host: string) => {
    const a = boxOf(host);
    const me = sizeOf(id);
    const home = at.get(id)!;
    const dx = a.w / 2 + me.w / 2 + step;
    const dy = (a.h + me.h) / 2 + step;
    // Spots around the partner: 16 directions on ever wider ellipses (an
    // ellipse because tokens are taller than wide). The first ellipse just
    // clears the partner's token.
    const spots: { box: Box; ring: number }[] = [];
    RADII.forEach((k, ring) => {
      for (let i = 0; i < 16; i++) {
        const t = (i / 16) * 2 * Math.PI;
        spots.push({
          ring,
          box: { x: a.x + Math.cos(t) * dx * k, y: a.y + Math.sin(t) * dy * k, ...me },
        });
      }
    });
    const nearestHome = (list: Box[]) =>
      list.sort(
        (u, v) => Math.hypot(u.x - home.x, u.y - home.y) - Math.hypot(v.x - home.x, v.y - home.y)
      )[0];
    const clearOfChats = spots.filter(
      (sp) =>
        inMap(sp.box) &&
        huddled.every((h) => gap(sp.box, h) >= 0) &&
        stuck.every((h) => gap(sp.box, h) >= 0)
    );
    // As close to the partner as there's room: the nearest ellipse with a
    // free spot. A spot that doesn't push a bystander aside is worth up to two
    // ellipses more (bystanders in a cramped corner have nowhere to go);
    // failing that a bystander steps aside below. Nearest where they stood.
    // No free spot at all — a crowded corner — the nearest clear spot, with
    // the link still joining them.
    let spot: Box;
    if (clearOfChats.length) {
      const ring = Math.min(...clearOfChats.map((sp) => sp.ring));
      const onRing = (r: number) => clearOfChats.filter((sp) => sp.ring === r).map((sp) => sp.box);
      const calmOn = (r: number) =>
        onRing(r).filter((sp) => bystanders.every((o) => gap(sp, o) >= 0));
      const calm = [ring, ring + 1, ring + 2].map(calmOn).find((list) => list.length);
      spot = nearestHome(calm ?? onRing(ring));
    } else {
      spot = clearSpot({ ...me, x: a.x, y: a.y }, [...labels, ...huddled, ...stuck]);
    }
    at.set(id, { ...home, x: spot.x, y: spot.y });
    huddled.push(spot);
  };

  // Everyone in a group joins chat by chat, in the order they started:
  // whoever isn't standing yet walks over to the partner who is.
  const inGroup = new Set<string>();
  const gather = (g: (typeof groupList)[number]) => {
    const standing = new Set([g.anchor]);
    const mine = links.filter((l) => g.members.includes(l.a));
    let moved = true;
    while (moved && standing.size < g.members.length) {
      moved = false;
      for (const { a, b } of mine) {
        if (standing.has(a) === standing.has(b)) continue;
        const [guest, host] = standing.has(a) ? [b, a] : [a, b];
        joinNextTo(guest, host);
        standing.add(guest);
        moved = true;
      }
    }
    g.members.forEach((id) => inGroup.add(id));
  };

  // Those who can't walk go first: their spots are reserved, then their
  // visitors gather round them (the corners are small, so they get first
  // pick). Then the other huddles: each anchor steps clear if it stands where
  // someone already is, and its partners gather round it.
  const stays = groupList.filter((g) => fixed(g.anchor));
  const walks = groupList.filter((g) => !fixed(g.anchor));
  for (const g of stays) huddled.push(boxOf(g.anchor));
  for (const g of stays) gather(g);
  for (const g of walks) {
    let a = boxOf(g.anchor);
    if (huddled.some((h) => gap(a, h) < step) || stuck.some((h) => gap(a, h) < 0)) {
      a = clearSpot(a, [...labels, ...huddled, ...stuck]);
      at.set(g.anchor, { ...at.get(g.anchor)!, x: a.x, y: a.y });
    }
    huddled.push(a);
  }
  for (const g of walks) gather(g);

  // Anyone a huddle landed on steps aside to the nearest clear spot — in
  // their own corner (a prisoner stays at the grates).
  const singles = base.filter((t) => !inGroup.has(t.id));
  for (const t of singles) {
    const me = boxOf(t.id);
    if (huddled.every((h) => gap(me, h) >= 0)) continue;
    const others = singles.filter((o) => o.id !== t.id).map((o) => boxOf(o.id));
    const own = plan.rooms.find((r) => r.id === t.roomId)?.floor;
    const spot = clearSpot(me, [...labels, ...huddled, ...others], own ?? area);
    at.set(t.id, { ...at.get(t.id)!, x: spot.x, y: spot.y });
  }

  return {
    placed: base.map((t) => at.get(t.id)!),
    links: links.map((l) => [l.a, l.b] as [string, string]),
  };
}
