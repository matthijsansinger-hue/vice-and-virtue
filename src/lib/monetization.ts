// Monetization config — the single source of truth for premium pricing.
//
// These are CONFIG/DISPLAY values only. No payment processor is wired up yet:
// the real-money purchases (Mano packages + the Founder Pack) are stubbed in the
// UI, and the Mano→LP conversion still needs its own SECURITY DEFINER RPC before
// it can mutate balances. Wire those up later — this file is just the numbers.

// ── Real-money → Mano packages ──────────────────────────────────────────────
// Higher tiers give progressively more Mano per euro (better value the more you
// buy): ~75 → 90 → 100 → 110 → 120 Mano per €.
export type ManoPackage = { eur: number; mano: number };

export const MANO_PACKAGES: ManoPackage[] = [
  { eur: 1.99, mano: 150 },
  { eur: 4.99, mano: 450 },
  { eur: 9.99, mano: 1000 },
  { eur: 19.99, mano: 2200 },
  { eur: 49.99, mano: 6000 },
];

// ── Mano → LP (Life Proficiency) conversion tiers ───────────────────────────
// Bigger conversions give a better LP-per-Mano rate (3.0 → 3.3 → 3.6).
export type ManoToLpTier = { mano: number; lp: number };

export const MANO_TO_LP_TIERS: ManoToLpTier[] = [
  { mano: 100, lp: 300 },
  { mano: 500, lp: 1650 },
  { mano: 1000, lp: 3600 },
];

// ── Founder (Pioneer) Pack ──────────────────────────────────────────────────
// Now a one-time real-money purchase rather than a Mano sink. It still grants
// the same bundle (see buy_founder_pack: LP + Mano + the Pioneer cosmetics).
export const FOUNDER_PACK_EUR = 9.99;
// The pack is launching on sale (50% off); the pre-sale price shows struck through.
export const FOUNDER_PACK_SALE_PCT = 50;
export const FOUNDER_PACK_ORIGINAL_EUR = 19.99;

// ── Helpers ─────────────────────────────────────────────────────────────────
// European euro formatting: "€9,99" (comma decimal).
export function formatEur(eur: number): string {
  return "€" + eur.toFixed(2).replace(".", ",");
}

// LP returned per Mano spent on a conversion tier (for the "best value" framing).
export function lpPerMano(tier: ManoToLpTier): number {
  return tier.lp / tier.mano;
}

// Mano granted per euro on a package (for the "best value" framing).
export function manoPerEur(pkg: ManoPackage): number {
  return pkg.mano / pkg.eur;
}
