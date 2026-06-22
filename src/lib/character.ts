// The customizable player "character" — a layered, Bitmoji-style avatar that
// replaces uploaded profile photos. The config is stored on `profiles.appearance`
// (jsonb — "character" is a reserved SQL word, hence the column name) and rendered
// by <CharacterAvatar/> (src/components/CharacterAvatar.tsx)
// by stacking PNG layers from /public/characters.
//
// Art strategy: a body-only base PNG per gender (white-fill / black-line line
// art) is **tinted to the skin tone**; attire (top / bottom / shoes) and hair
// stack on top; hair is **tinted to the hair colour**. Tinting is a canvas
// multiply done in CharacterAvatar (white → colour, dark lines stay), so a new
// colour costs no art.
//
// This file is the single source of truth for every option. To add a hairstyle/
// attire/colour, edit the lists here and drop the matching PNG into
// public/characters — see public/characters/README.md.

export type Gender = "male" | "female";

export type CharacterConfig = {
  gender: Gender;
  skin: string; // SKIN_TONES id (tints the body)
  hair: string; // HAIRSTYLES id ("none" = bald)
  hairColor: string; // HAIR_COLORS id
  eyeColor: string; // EYE_COLORS id (placeholder only for now)
  top: string; // TOPS id ("none" = bare)
  bottom: string; // BOTTOMS id
  shoes: string; // SHOES id
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

// The hairstyles with art today (Matthijs's 4 templates + bald). `none` adds no
// layer (the base is bald). Each maps to public/characters/hair/<id>.png.
export const HAIRSTYLES: Option[] = [
  { id: "none", label: "Bald" },
  { id: "short", label: "Short" },
  { id: "long", label: "Long" },
  { id: "dreads_long", label: "Long dreads" },
  { id: "dreads_short", label: "Short dreads" },
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

// Attire pieces — the "outfit for character" sheet split into top / bottom /
// shoes (public/characters/outfit/<id>.png). "none" leaves that slot bare. More
// pieces drop in here as art arrives.
export const TOPS: Option[] = [
  { id: "none", label: "None" },
  { id: "tunic", label: "Tunic" },
];
export const BOTTOMS: Option[] = [
  { id: "none", label: "None" },
  { id: "skirt", label: "Skirt" },
];
export const SHOES: Option[] = [
  { id: "none", label: "None" },
  { id: "boots", label: "Boots" },
];

export const DEFAULT_CHARACTER: CharacterConfig = {
  gender: "male",
  skin: "light",
  hair: "short",
  hairColor: "brown",
  eyeColor: "brown",
  top: "tunic",
  bottom: "skirt",
  shoes: "boots",
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
    top: validId(TOPS, c.top, DEFAULT_CHARACTER.top),
    bottom: validId(BOTTOMS, c.bottom, DEFAULT_CHARACTER.bottom),
    shoes: validId(SHOES, c.shoes, DEFAULT_CHARACTER.shoes),
  };
}

const byId = (list: ColorOption[], id: string) => list.find((o) => o.id === id);
export const skinHex = (id: string) => byId(SKIN_TONES, id)?.hex ?? SKIN_TONES[0].hex;
export const hairHex = (id: string) => byId(HAIR_COLORS, id)?.hex ?? HAIR_COLORS[0].hex;
export const eyeHex = (id: string) => byId(EYE_COLORS, id)?.hex ?? EYE_COLORS[0].hex;

export const CHARACTER_DIR = "/characters";

// One stacked image layer. `tint` (when set) means the PNG is grayscale and
// should be multiply-tinted to that hex (hair/eyes); otherwise it's drawn as-is.
export type CharacterLayer = { key: string; src: string; tint?: string };

// The ordered layers, back → front: body (tinted to the skin tone) → bottom →
// shoes → top → hair (tinted to the hair colour). Body + hair are white-fill /
// black-line art tinted via the canvas multiply in CharacterAvatar; attire is
// drawn as-is. Hair is pre-fitted to each gender's head, so its file is per-gender.
export function characterLayers(c: CharacterConfig): CharacterLayer[] {
  const layers: CharacterLayer[] = [
    { key: "base", src: `${CHARACTER_DIR}/base/${c.gender}.png`, tint: skinHex(c.skin) },
  ];
  if (c.bottom !== "none")
    layers.push({ key: "bottom", src: `${CHARACTER_DIR}/outfit/${c.bottom}.png` });
  if (c.shoes !== "none")
    layers.push({ key: "shoes", src: `${CHARACTER_DIR}/outfit/${c.shoes}.png` });
  if (c.top !== "none")
    layers.push({ key: "top", src: `${CHARACTER_DIR}/outfit/${c.top}.png` });
  if (c.hair !== "none")
    layers.push({
      key: "hair",
      src: `${CHARACTER_DIR}/hair/${c.gender}-${c.hair}.png`,
      tint: hairHex(c.hairColor),
    });
  return layers;
}
