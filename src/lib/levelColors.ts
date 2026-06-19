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

// The tiers a given account level has unlocked, for the profile picker.
export function unlockedNameTiers(level: number): Set<ColorTier> {
  return new Set(COLOR_TIER_ORDER.filter((t) => level >= NAME_COLOR_UNLOCK[t]));
}
export function unlockedBannerTiers(level: number): Set<ColorTier> {
  return new Set(COLOR_TIER_ORDER.filter((t) => level >= BANNER_COLOR_UNLOCK[t]));
}

// Inline style for a name in the given tier (or undefined for the default).
export function nameColorStyle(
  tier: string | null | undefined
): { color: string; textShadow: string } | undefined {
  return isColorTier(tier)
    ? { color: NAME_TEXT_COLOR[tier], textShadow: NAME_TEXT_SHADOW }
    : undefined;
}

// The banner background for the given tier (or null for the default bar).
export function bannerBg(tier: string | null | undefined): string | null {
  return isColorTier(tier) ? BANNER_BG[tier] : null;
}
