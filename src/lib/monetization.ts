// Monetization config — the single source of truth for premium pricing.
//
// Real-money purchases (the Mano packages + the Founder Pack) are sold ONLY
// through the Steam client via Steam Microtransactions (see lib/steam.ts +
// desktop/STEAM.md). The public website never sells them. The package ids below
// are the stable keys the Steam flow + the server-side credit map use
// (db/105 credit_steam_purchase) — keep them in sync with that migration.
//
// The Mano→LP conversion is an in-game spend (owned Mano → LP) and still needs
// its own convert_mano_to_lp RPC before it can mutate balances.

// ── Real-money → Mano packages ──────────────────────────────────────────────
// Higher tiers give progressively more Mano per euro (better value the more you
// buy): ~75 → 90 → 100 → 110 → 120 Mano per €.
export type ManoPackage = { id: string; eur: number; mano: number };

export const MANO_PACKAGES: ManoPackage[] = [
  { id: "mano_150", eur: 1.99, mano: 150 },
  { id: "mano_450", eur: 4.99, mano: 450 },
  { id: "mano_1000", eur: 9.99, mano: 1000 },
  { id: "mano_2200", eur: 19.99, mano: 2200 },
  { id: "mano_6000", eur: 49.99, mano: 6000 },
];

// Stable id for the Founder (Pioneer) Pack in the Steam purchase flow.
export const FOUNDER_PACK_ID = "founder";

// ── Mano → LP (Life Proficiency) conversion tiers ───────────────────────────
// Bigger conversions give a better LP-per-Mano rate (3.0 → 3.3 → 3.6).
export type ManoToLpTier = { mano: number; lp: number };

export const MANO_TO_LP_TIERS: ManoToLpTier[] = [
  { mano: 100, lp: 300 },
  { mano: 500, lp: 1650 },
  { mano: 1000, lp: 3600 },
];

// ── Founder (Pioneer) Pack ──────────────────────────────────────────────────
// A one-time real-money purchase (Steam). Grants the bundle (4000 LP + 1000
// Mano + the Pioneer cosmetics) via credit_steam_purchase — no Mano is spent.
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
