// Earned cosmetic colors for the player banner (migration 080). The five tiers
// reuse the badge tier names + palette. NAME colors recolor the player's name
// text; BANNER colors recolor the bar (the "banner") their name sits in.
//
// Unlock by account level (mirror set_cosmetic_color in the SQL):
//   name   — Earthen 5  / Verdant 15 / Primal 25 / Noble 35 / Divine 45
//   banner — Earthen 10 / Verdant 20 / Primal 30 / Noble 40 / Divine 50
// Tiers are EQUIPPED by the player (profiles.name_color / banner_color); the
// server validates the pick against their level.

import type { BadgeTier } from "./badges";

export type ColorTier = BadgeTier; // "earthen" | "verdant" | "primal" | "noble" | "divine"

// Low → high, matching the unlock ladder.
export const COLOR_TIER_ORDER: ColorTier[] = [
  "earthen",
  "verdant",
  "primal",
  "noble",
  "divine",
];

export const COLOR_TIER_LABEL: Record<ColorTier, string> = {
  earthen: "Earthen",
  verdant: "Verdant",
  primal: "Primal",
  noble: "Noble",
  divine: "Divine",
};

export const NAME_COLOR_UNLOCK: Record<ColorTier, number> = {
  earthen: 5,
  verdant: 15,
  primal: 25,
  noble: 35,
  divine: 45,
};

export const BANNER_COLOR_UNLOCK: Record<ColorTier, number> = {
  earthen: 10,
  verdant: 20,
  primal: 30,
  noble: 40,
  divine: 50,
};

// Name text color per tier — vivid, always paired with NAME_TEXT_SHADOW so it
// reads on both the light parchment bars and the dark tier banners.
export const NAME_TEXT_COLOR: Record<ColorTier, string> = {
  earthen: "#d8a86a",
  verdant: "#74d074",
  primal: "#ff9a52",
  noble: "#c79bf0",
  divine: "#ffd75e",
};

export const NAME_TEXT_SHADOW = "0 1px 2px rgba(0,0,0,0.7)";

// Banner background per tier — a rich dark gradient so light names stay legible.
export const BANNER_BG: Record<ColorTier, string> = {
  earthen: "linear-gradient(170deg,#6e5132,#3a2917)",
  verdant: "linear-gradient(170deg,#356b33,#163016)",
  primal: "linear-gradient(170deg,#a8431a,#4a1608)",
  noble: "linear-gradient(170deg,#5e3a8a,#27123c)",
  divine: "linear-gradient(170deg,#a07d20,#5a440f)",
};

export function isColorTier(x: string | null | undefined): x is ColorTier {
  return (
    x === "earthen" ||
    x === "verdant" ||
    x === "primal" ||
    x === "noble" ||
    x === "divine"
  );
}

// ---- Shop colors (migration 081) -----------------------------------------
// Flat colors bought with Mano (200 each), usable for BOTH name and banner.
// `light` = the color reads as light, so a banner in it wants DARK bar text and
// a name in it wants a DARK text-shadow (and vice-versa for dark colors).
export type ShopColorId =
  | "red" | "orange" | "yellow" | "green" | "blue"
  | "indigo" | "violet" | "grey" | "white" | "black";

export const SHOP_COLOR_PRICE = 200; // Mano

export const SHOP_COLOR_ORDER: ShopColorId[] = [
  "red", "orange", "yellow", "green", "blue", "indigo", "violet", "grey", "white", "black",
];

// Distinct letter shadows, assigned per shop color so the name pops with a
// chosen accent (gold / black / silver) rather than a plain dark/light shade.
const GOLD_SHADOW = "0 1px 2px rgba(227,181,16,0.95), 0 0 4px rgba(227,181,16,0.55)";
const BLACK_SHADOW = "0 1px 2px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.5)";
const SILVER_SHADOW = "0 1px 2px rgba(208,213,221,0.95), 0 0 4px rgba(208,213,221,0.6)";

// `light` drives banner text contrast; `shadow` is the name-letter accent.
export const SHOP_COLORS: Record<ShopColorId, { label: string; hex: string; light: boolean; shadow: string }> = {
  red: { label: "Red", hex: "#e23b3b", light: false, shadow: GOLD_SHADOW },
  orange: { label: "Orange", hex: "#ec8a2f", light: false, shadow: GOLD_SHADOW },
  yellow: { label: "Yellow", hex: "#f2cf3a", light: true, shadow: BLACK_SHADOW },
  green: { label: "Green", hex: "#3aa847", light: false, shadow: SILVER_SHADOW },
  blue: { label: "Blue", hex: "#3a7be0", light: false, shadow: SILVER_SHADOW },
  indigo: { label: "Indigo", hex: "#4b3fb0", light: false, shadow: SILVER_SHADOW },
  violet: { label: "Violet", hex: "#9b48d0", light: false, shadow: GOLD_SHADOW },
  grey: { label: "Grey", hex: "#6e7480", light: false, shadow: GOLD_SHADOW },
  white: { label: "White", hex: "#f4f1ea", light: true, shadow: GOLD_SHADOW },
  black: { label: "Black", hex: "#16181d", light: false, shadow: GOLD_SHADOW },
};

export function isShopColor(x: string | null | undefined): x is ShopColorId {
  return !!x && x in SHOP_COLORS;
}

// The tiers a given account level has unlocked, for the profile picker.
export function unlockedNameTiers(level: number): Set<ColorTier> {
  return new Set(COLOR_TIER_ORDER.filter((t) => level >= NAME_COLOR_UNLOCK[t]));
}
export function unlockedBannerTiers(level: number): Set<ColorTier> {
  return new Set(COLOR_TIER_ORDER.filter((t) => level >= BANNER_COLOR_UNLOCK[t]));
}

// Inline style for a name in the given color id — a level tier OR a shop color
// (or undefined for the default). Shadow direction keeps it legible on any bar.
export function nameColorStyle(
  id: string | null | undefined
): { color: string; textShadow: string } | undefined {
  if (isColorTier(id)) {
    return { color: NAME_TEXT_COLOR[id], textShadow: NAME_TEXT_SHADOW };
  }
  if (isShopColor(id)) {
    const c = SHOP_COLORS[id];
    return { color: c.hex, textShadow: c.shadow };
  }
  return undefined;
}

// The banner background for the given color id (or null for the default bar).
// Level tiers get a rich gradient; shop colors are flat.
export function bannerBg(id: string | null | undefined): string | null {
  if (isColorTier(id)) return BANNER_BG[id];
  if (isShopColor(id)) return SHOP_COLORS[id].hex;
  return null;
}

// Whether a bar wearing this banner color should use LIGHT text. Level tiers are
// all dark → light text; shop colors depend on their luminance (yellow/white
// are light → dark text). Callers use this only when a banner color is set.
export function bannerTextLight(id: string | null | undefined): boolean {
  if (isShopColor(id)) return !SHOP_COLORS[id].light;
  return isColorTier(id);
}
