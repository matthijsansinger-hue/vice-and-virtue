// The customizable player "character" — a layered, Bitmoji-style avatar that
// replaces uploaded profile photos. The config is stored on `profiles.appearance`
// (jsonb — "character" is a reserved SQL word, hence the column name) and rendered
// by <CharacterAvatar/> (src/components/CharacterAvatar.tsx)
// by stacking PNG layers from /public/characters.
//
// Art strategy (decided with Matthijs):
//  - Skin + outfit are PRE-BAKED PNGs (one per gender/tone, gender/outfit).
//  - Hair + eye COLOR are applied by TINTING a single grayscale PNG at runtime,
//    so each hairstyle / eye shape is drawn once and a new colour costs no art.
//
// This file is the single source of truth for every option: the customization
// UI, the SVG placeholder, and the asset filenames all derive from it. To add a
// hairstyle/outfit/colour, edit the lists here and (for baked layers) drop the
// matching PNG into public/characters — see public/characters/README.md.

export type Gender = "male" | "female";

export type CharacterConfig = {
  gender: Gender;
  skin: string; // SKIN_TONES id
  hair: string; // HAIRSTYLES id ("none" = bald, no hair layer)
  hairColor: string; // HAIR_COLORS id
  eyeColor: string; // EYE_COLORS id
  outfit: string; // OUTFITS id
};

export type Option = { id: string; label: string };
// A colour option also carries a hex — used both to tint the grayscale art
// (hair/eyes) and to paint the SVG placeholder before real art exists.
export type ColorOption = Option & { hex: string };

export const GENDERS: { id: Gender; label: string }[] = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
];

// Skin tones are pre-baked into the base art; the hex here only drives the
// placeholder silhouette.
export const SKIN_TONES: ColorOption[] = [
  { id: "porcelain", label: "Porcelain", hex: "#f3d9c6" },
  { id: "fair", label: "Fair", hex: "#e9c1a4" },
  { id: "light", label: "Light", hex: "#d9a884" },
  { id: "tan", label: "Tan", hex: "#bd8662" },
  { id: "brown", label: "Brown", hex: "#8d5a3c" },
  { id: "deep", label: "Deep", hex: "#5c3a28" },
];

export const HAIRSTYLES: Option[] = [
  { id: "none", label: "Bald" },
  { id: "short", label: "Short" },
  { id: "medium", label: "Medium" },
  { id: "long", label: "Long" },
  { id: "curly", label: "Curly" },
  { id: "ponytail", label: "Ponytail" },
];

// Hair colours tint the grayscale hair art at runtime (no per-colour art).
export const HAIR_COLORS: ColorOption[] = [
  { id: "black", label: "Black", hex: "#2b2118" },
  { id: "brown", label: "Brown", hex: "#6b4423" },
  { id: "blonde", label: "Blonde", hex: "#d8b65c" },
  { id: "auburn", label: "Auburn", hex: "#7a3520" },
  { id: "grey", label: "Grey", hex: "#b8b3ad" },
  { id: "red", label: "Red", hex: "#a63a2a" },
];

// Eye colours tint the grayscale iris overlay at runtime.
export const EYE_COLORS: ColorOption[] = [
  { id: "brown", label: "Brown", hex: "#5b3a21" },
  { id: "blue", label: "Blue", hex: "#4a76a8" },
  { id: "green", label: "Green", hex: "#4e7a4e" },
  { id: "hazel", label: "Hazel", hex: "#8a6b3b" },
  { id: "grey", label: "Grey", hex: "#7d8488" },
];

// Outfits are pre-baked per gender; the hex only drives the placeholder.
export const OUTFITS: ColorOption[] = [
  { id: "tunic", label: "Tunic", hex: "#6f7d4a" },
  { id: "robe", label: "Robe", hex: "#5b4a8a" },
  { id: "armor", label: "Armor", hex: "#8a8f99" },
  { id: "noble", label: "Noble", hex: "#8a2f4a" },
  { id: "peasant", label: "Peasant", hex: "#8a6f4a" },
];

export const DEFAULT_CHARACTER: CharacterConfig = {
  gender: "male",
  skin: "light",
  hair: "short",
  hairColor: "brown",
  eyeColor: "brown",
  outfit: "tunic",
};

function validId(list: { id: string }[], id: string | undefined, fallback: string): string {
  return id != null && list.some((o) => o.id === id) ? id : fallback;
}

// Coerce arbitrary stored/legacy data into a complete, valid config. Any missing
// or unknown field falls back to the default, so a partially-saved or
// schema-drifted row never throws.
export function normalizeCharacter(raw: unknown): CharacterConfig {
  const c = (raw ?? {}) as Partial<CharacterConfig>;
  return {
    gender: c.gender === "female" ? "female" : "male",
    skin: validId(SKIN_TONES, c.skin, DEFAULT_CHARACTER.skin),
    hair: validId(HAIRSTYLES, c.hair, DEFAULT_CHARACTER.hair),
    hairColor: validId(HAIR_COLORS, c.hairColor, DEFAULT_CHARACTER.hairColor),
    eyeColor: validId(EYE_COLORS, c.eyeColor, DEFAULT_CHARACTER.eyeColor),
    outfit: validId(OUTFITS, c.outfit, DEFAULT_CHARACTER.outfit),
  };
}

const byId = (list: ColorOption[], id: string) => list.find((o) => o.id === id);
export const skinHex = (id: string) => byId(SKIN_TONES, id)?.hex ?? SKIN_TONES[0].hex;
export const hairHex = (id: string) => byId(HAIR_COLORS, id)?.hex ?? HAIR_COLORS[0].hex;
export const eyeHex = (id: string) => byId(EYE_COLORS, id)?.hex ?? EYE_COLORS[0].hex;
export const outfitHex = (id: string) => byId(OUTFITS, id)?.hex ?? OUTFITS[0].hex;

export const CHARACTER_DIR = "/characters";

// One stacked image layer. `tint` (when set) means the PNG is grayscale and
// should be multiply-tinted to that hex (hair/eyes); otherwise it's drawn as-is.
export type CharacterLayer = { key: string; src: string; tint?: string };

// The ordered layers, back → front: base (skin) → eyes → outfit → hair. Hair is
// last so long styles can fall over the shoulders. "none" hair adds no layer.
export function characterLayers(c: CharacterConfig): CharacterLayer[] {
  const layers: CharacterLayer[] = [
    { key: "base", src: `${CHARACTER_DIR}/base/${c.gender}-${c.skin}.png` },
    { key: "eyes", src: `${CHARACTER_DIR}/eyes/${c.gender}.png`, tint: eyeHex(c.eyeColor) },
    { key: "outfit", src: `${CHARACTER_DIR}/outfit/${c.gender}-${c.outfit}.png` },
  ];
  if (c.hair !== "none") {
    layers.push({ key: "hair", src: `${CHARACTER_DIR}/hair/${c.hair}.png`, tint: hairHex(c.hairColor) });
  }
  return layers;
}
