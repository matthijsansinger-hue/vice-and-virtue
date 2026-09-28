// Torment's ink (reworked 2026-09-28 — was a name scramble on the old Quiz).
// On the day a player is tormented, their OUTREACH shows ink blots instead of
// names: they can still tell their conversations apart (each blot carries a
// number) but not who they're writing to. The numbers are a seeded shuffle,
// stable for the whole day, and NOT in join order — otherwise the lobby order
// everyone saw would give the names away.

function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// id → blot number (1..n), shuffled by `seed`. Sorting the ids first makes the
// result independent of the order the player list happened to arrive in.
export function inkNumbers(ids: string[], seed: string): Map<string, number> {
  const order = [...ids].sort();
  const rng = mulberry32(hashString(seed));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Map(order.map((id, i) => [id, i + 1]));
}
