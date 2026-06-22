// The customizable player "character" — a stylized shoulder-up portrait drawn
// entirely as an inline SVG by <CharacterAvatar/> (src/components/CharacterAvatar.tsx).
// There are NO image assets: the head, eyes, hair and collar are vector shapes
// recoloured from the config, so any colour/style combination is free.
//
// The config is stored on `profiles.appearance` (jsonb — "character" is a
// reserved SQL word, hence the column name). This file is the single source of
// truth for every option; the avatar maps `hair` (a style id) to a set of SVG
// paths and the four colour fields to hex fills.

export type Gender = "male" | "female";
export type Expression = "neutral" | "happy" | "angry" | "sad" | "scared";

export type CharacterConfig = {
  gender: Gender; // drives face/jaw/neck/traps build + eye size/lashes
  expression: Expression; // reshapes brows + eyes + mouth
  skin: string; // SKIN_TONES id
  hair: string; // HAIRSTYLES id ("none" = bald)
  hairColor: string; // HAIR_COLORS id
  eyeColor: string; // EYE_COLORS id
  outfit: string; // OUTFIT_COLORS id (the collar/garment colour)
};

export type Option = { id: string; label: string };
export type ColorOption = Option & { hex: string };

// Male = wider jaw, wider neck, bigger traps. Female = bigger eyes + lashes,
// softer jaw, slimmer build. The exact trait shapes live in CharacterAvatar.
export const GENDERS: { id: Gender; label: string }[] = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
];

// Skin is the face/neck/shoulders fill (the avatar derives its own shadows).
export const SKIN_TONES: ColorOption[] = [
  { id: "porcelain", label: "Porcelain", hex: "#f4dbc7" },
  { id: "fair", label: "Fair", hex: "#eec5a3" },
  { id: "tan", label: "Tan", hex: "#cf9d6c" },
  { id: "brown", label: "Brown", hex: "#a06b43" },
  { id: "deep", label: "Deep", hex: "#774a32" },
  { id: "ebony", label: "Ebony", hex: "#4f3122" },
];

// Each id maps to a set of SVG paths in CharacterAvatar (`none` = bald).
export const HAIRSTYLES: Option[] = [
  { id: "none", label: "Bald" },
  { id: "short", label: "Short" },
  { id: "long", label: "Long" },
  { id: "ponytail", label: "Ponytail" },
  { id: "bun", label: "Bun" },
  { id: "curly", label: "Curly" },
];

export const HAIR_COLORS: ColorOption[] = [
  { id: "black", label: "Black", hex: "#211a17" },
  { id: "brown", label: "Brown", hex: "#4a3526" },
  { id: "auburn", label: "Auburn", hex: "#7a3b22" },
  { id: "blonde", label: "Blonde", hex: "#c89a4e" },
  { id: "red", label: "Red", hex: "#a4392a" },
  { id: "silver", label: "Silver", hex: "#c2bcc4" },
];

export const EYE_COLORS: ColorOption[] = [
  { id: "brown", label: "Brown", hex: "#6b4a2b" },
  { id: "amber", label: "Amber", hex: "#9a6b2f" },
  { id: "blue", label: "Blue", hex: "#3f74c0" },
  { id: "green", label: "Green", hex: "#3f7d52" },
  { id: "grey", label: "Grey", hex: "#6f7d86" },
  { id: "violet", label: "Violet", hex: "#6d4aa0" },
  { id: "red", label: "Red", hex: "#b3342f" },
];

// Facial expressions — each reshapes the brows, eye openness, and mouth (the
// exact geometry lives in CharacterAvatar's EXPRESSIONS map).
export const EXPRESSIONS: { id: Expression; label: string }[] = [
  { id: "neutral", label: "Neutral" },
  { id: "happy", label: "Happy" },
  { id: "angry", label: "Angry" },
  { id: "sad", label: "Sad" },
  { id: "scared", label: "Scared" },
];

// The collar/garment colour — themed to the game's deep, royal palette.
export const OUTFIT_COLORS: ColorOption[] = [
  { id: "royal", label: "Royal blue", hex: "#2f4f9c" },
  { id: "crimson", label: "Crimson", hex: "#9c2b2b" },
  { id: "emerald", label: "Emerald", hex: "#2f7d54" },
  { id: "plum", label: "Plum", hex: "#5d3470" },
  { id: "gold", label: "Gold", hex: "#b07d1e" },
  { id: "teal", label: "Teal", hex: "#2c6b6b" },
  { id: "wine", label: "Wine", hex: "#6e2540" },
  { id: "charcoal", label: "Charcoal", hex: "#36343f" },
];

export const DEFAULT_CHARACTER: CharacterConfig = {
  gender: "male",
  expression: "neutral",
  skin: "fair",
  hair: "short",
  hairColor: "brown",
  eyeColor: "brown",
  outfit: "royal",
};

function validId(list: { id: string }[], id: string | undefined, fallback: string): string {
  return id != null && list.some((o) => o.id === id) ? id : fallback;
}

// Coerce arbitrary stored/legacy data into a complete, valid config. Unknown or
// missing fields (incl. the old gender / outfit-piece fields) fall back to the
// default, so a schema-drifted row never throws.
export function normalizeCharacter(raw: unknown): CharacterConfig {
  const c = (raw ?? {}) as Partial<CharacterConfig>;
  return {
    gender: c.gender === "female" ? "female" : "male",
    expression: EXPRESSIONS.some((e) => e.id === c.expression)
      ? (c.expression as Expression)
      : "neutral",
    skin: validId(SKIN_TONES, c.skin, DEFAULT_CHARACTER.skin),
    hair: validId(HAIRSTYLES, c.hair, DEFAULT_CHARACTER.hair),
    hairColor: validId(HAIR_COLORS, c.hairColor, DEFAULT_CHARACTER.hairColor),
    eyeColor: validId(EYE_COLORS, c.eyeColor, DEFAULT_CHARACTER.eyeColor),
    outfit: validId(OUTFIT_COLORS, c.outfit, DEFAULT_CHARACTER.outfit),
  };
}

// Deterministic PRNG from a string seed (FNV-1a hash → mulberry32) so a given
// account id always yields the SAME "random" character — stable across reloads
// and across everyone viewing it, with nothing persisted.
function rngFromSeed(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random but valid character. With a seed (an account id) it's deterministic —
// the same account always gets the same default; without one it's truly random
// (e.g. a future "shuffle" button). Expression is weighted toward neutral so
// default avatars look friendly, and the default hair is never "none".
export function randomCharacter(seed?: string): CharacterConfig {
  const rnd = seed ? rngFromSeed(seed) : () => Math.random();
  const pick = <X,>(arr: readonly X[]): X => arr[Math.floor(rnd() * arr.length)];
  const styles = HAIRSTYLES.filter((h) => h.id !== "none");
  const exprPool: Expression[] = ["neutral", "neutral", "neutral", "happy", "happy", "angry", "sad", "scared"];
  return {
    gender: pick(GENDERS).id,
    expression: pick(exprPool),
    skin: pick(SKIN_TONES).id,
    hair: pick(styles).id,
    hairColor: pick(HAIR_COLORS).id,
    eyeColor: pick(EYE_COLORS).id,
    outfit: pick(OUTFIT_COLORS).id,
  };
}

// Give an account that hasn't customized a character yet (appearance == null) a
// deterministic random one keyed by its id. Used by the profile/friend/lobby/
// leaderboard loaders so everyone has a character by default; saving a custom
// one (saveCharacter) overrides it.
export function withDefaultCharacter<T extends { id: string; appearance: CharacterConfig | null }>(p: T): T {
  return p.appearance ? p : { ...p, appearance: randomCharacter(p.id) };
}

const byId = (list: ColorOption[], id: string) => list.find((o) => o.id === id);
export const skinHex = (id: string) => byId(SKIN_TONES, id)?.hex ?? SKIN_TONES[0].hex;
export const hairHex = (id: string) => byId(HAIR_COLORS, id)?.hex ?? HAIR_COLORS[0].hex;
export const eyeHex = (id: string) => byId(EYE_COLORS, id)?.hex ?? EYE_COLORS[0].hex;
export const outfitHex = (id: string) => byId(OUTFIT_COLORS, id)?.hex ?? OUTFIT_COLORS[0].hex;
