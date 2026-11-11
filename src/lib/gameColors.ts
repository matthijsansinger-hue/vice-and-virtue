// In-game banner colours (2026-11-05). Inside a game a player's name bar no
// longer shows their customisable banner: everyone gets a colour for THIS game
// only, so you can remember who you talked to by colour as well as by name.
//
// The eight colours are the Okabe–Ito set, which stays distinguishable for the
// common kinds of colour blindness. Past eight players a pattern (stripes,
// then dots) doubles and triples the set, so the colour is never the only cue
// — up to 24 players get a unique look. Every client computes the same result:
// the order comes from hashing the room id with each player id.

export type GameColor = {
  background: string;
  // The plain colour under any pattern (for rings and outlines).
  hex: string;
  // Light text reads better on this colour.
  lightText: boolean;
  // Name of the colour + pattern, for screen readers / tooltips.
  label: string;
};

const COLORS: { hex: string; lightText: boolean; name: string }[] = [
  { hex: "#E69F00", lightText: false, name: "orange" },
  { hex: "#56B4E9", lightText: false, name: "sky blue" },
  { hex: "#009E73", lightText: true, name: "green" },
  { hex: "#F0E442", lightText: false, name: "yellow" },
  { hex: "#0072B2", lightText: true, name: "blue" },
  { hex: "#D55E00", lightText: true, name: "vermilion" },
  { hex: "#CC79A7", lightText: false, name: "pink" },
  { hex: "#3B3B3B", lightText: true, name: "charcoal" },
];

const PATTERNS: { css: string | null; name: string }[] = [
  { css: null, name: "" },
  {
    css: "repeating-linear-gradient(45deg, rgba(255,255,255,.32) 0 6px, transparent 6px 12px)",
    name: "striped",
  },
  {
    css: "radial-gradient(rgba(255,255,255,.42) 2px, transparent 2.6px) 0 0 / 10px 10px",
    name: "dotted",
  },
];

// FNV-1a: a small, stable string hash.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Player id → this game's colour. Players are ordered by a per-room hash, and
// take the colours in turn: all eight plain colours first, then striped, then
// dotted. The palette order is shuffled per room too, so the same two people
// don't always get the same colours.
export function gameColors(roomId: string, playerIds: string[]): Map<string, GameColor> {
  const order = [...new Set(playerIds)].sort(
    (a, b) => hash(roomId + a) - hash(roomId + b) || (a < b ? -1 : 1)
  );
  const palette = COLORS.map((c, i) => ({ c, k: hash(roomId + ":" + i) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c);
  const out = new Map<string, GameColor>();
  order.forEach((id, i) => {
    const color = palette[i % palette.length];
    const pattern = PATTERNS[Math.floor(i / palette.length) % PATTERNS.length];
    out.set(id, {
      background: pattern.css ? `${pattern.css}, ${color.hex}` : color.hex,
      hex: color.hex,
      lightText: color.lightText,
      label: pattern.name ? `${pattern.name} ${color.name}` : color.name,
    });
  });
  return out;
}
