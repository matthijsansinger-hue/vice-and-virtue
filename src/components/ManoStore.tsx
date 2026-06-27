"use client";

import { useState } from "react";
import type { AccountEconomy } from "@/lib/economy";
import {
  MANO_PACKAGES,
  MANO_TO_LP_TIERS,
  FOUNDER_PACK_EUR,
  FOUNDER_PACK_ORIGINAL_EUR,
  FOUNDER_PACK_SALE_PCT,
  formatEur,
  manoPerEur,
} from "@/lib/monetization";
import { ManoIcon, LifeProficiencyIcon } from "./CurrencyIcons";

// The premium store, split so the Shop tab can place the featured Founder Pack
// at the top and the Mano purchase + conversion at the bottom. NOTE: no payment
// processor is wired yet, so the real-money buys are stubbed (a "coming soon"
// notice), and the converter still needs its `convert_mano_to_lp` RPC.
const SOON = "Purchases aren’t live yet — payments are coming soon.";

// Featured one-time Founder (Pioneer) Pack — real-money bundle, on launch sale.
export function FounderPack({ econ }: { econ: AccountEconomy | null }) {
  const [notice, setNotice] = useState<string | null>(null);
  const ownsFounder = (econ?.ownedColors ?? []).includes("pioneer");

  return (
    <div className="mx-auto w-full max-w-3xl">
      {notice && (
        <p className="mb-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          {notice}
        </p>
      )}
      <div className="overflow-hidden rounded-2xl border-2 border-gold bg-black/30 shadow-[0_0_18px_rgba(227,181,16,.22)]">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/banners/pioneer.png?v=3"
            alt="Pioneer banner"
            className="block max-h-32 w-full object-cover object-center"
          />
          <span className="absolute left-3 top-2 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-gold">
            Founder Pack
          </span>
          {/* Gold launch-sale flag, top-right. */}
          <span className="absolute right-3 top-2 rounded-full bg-gradient-to-b from-[#fff3c4] to-gold px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-widest text-home-bg shadow-[0_0_14px_rgba(227,181,16,.8)] ring-1 ring-[#fff7d6]/70">
            {FOUNDER_PACK_SALE_PCT}% sale
          </span>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gold">Pioneer Pack</h2>
            <ul className="mt-1 space-y-1 text-sm text-cream/75">
              <li className="flex items-center gap-1.5"><span aria-hidden>&bull;</span> 4000 <LifeProficiencyIcon size={15} /></li>
              <li className="flex items-center gap-1.5"><span aria-hidden>&bull;</span> 1000 <ManoIcon size={15} /></li>
              <li>&bull; The <span className="text-cream">Pioneer</span> banner</li>
              <li>&bull; The <span className="text-cream">Pioneer Name Color</span> (ivory, decorative)</li>
            </ul>
          </div>
          {ownsFounder ? (
            <span className="shrink-0 self-start rounded-lg border border-gold/40 px-4 py-2 text-sm font-semibold text-cream/70 sm:self-auto">
              Owned
            </span>
          ) : (
            <button
              onClick={() => setNotice(SOON)}
              className="inline-flex shrink-0 items-baseline gap-1.5 self-start rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 sm:self-auto"
            >
              <span className="text-xs text-home-bg/55 line-through">{formatEur(FOUNDER_PACK_ORIGINAL_EUR)}</span>
              {formatEur(FOUNDER_PACK_EUR)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Buy Mano with real money + convert Mano → LP. Placed at the BOTTOM of the Shop.
export function GetMano({ econ }: { econ: AccountEconomy | null }) {
  const [notice, setNotice] = useState<string | null>(null);
  const mano = econ?.mano ?? 0;
  // Mano-per-€ of the smallest package, so bigger ones can show their bonus %.
  const baseRate = manoPerEur(MANO_PACKAGES[0]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold text-gold">Get Mano</h1>

      {notice && (
        <p className="mt-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
          {notice}
        </p>
      )}

      {/* Mano packages — real money → Mano. */}
      <h2 className="mt-4 text-sm font-semibold uppercase tracking-widest text-cream/60">
        Buy Mano
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {MANO_PACKAGES.map((pkg, i) => {
          const bonus = Math.round((manoPerEur(pkg) / baseRate - 1) * 100);
          const best = i === MANO_PACKAGES.length - 1;
          return (
            <div
              key={pkg.eur}
              className={
                "relative flex flex-col items-center gap-2 rounded-xl border bg-black/20 p-3 text-center " +
                (best ? "border-gold shadow-[0_0_14px_rgba(227,181,16,.25)]" : "border-cream/15")
              }
            >
              {best && (
                <span className="absolute -top-2 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-home-bg">
                  Best value
                </span>
              )}
              <span className="mt-1 flex items-center gap-1.5 text-lg font-bold text-cream">
                <ManoIcon size={18} /> {pkg.mano}
              </span>
              {bonus > 0 ? (
                <span className="text-[11px] font-semibold text-green-300">+{bonus}% value</span>
              ) : (
                <span className="text-[11px] text-cream/40">&nbsp;</span>
              )}
              <button
                onClick={() => setNotice(SOON)}
                className="mt-0.5 w-full rounded-md bg-gold py-1.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90"
              >
                {formatEur(pkg.eur)}
              </button>
            </div>
          );
        })}
      </div>

      {/* Mano → LP conversion. */}
      <h2 className="mt-6 text-sm font-semibold uppercase tracking-widest text-cream/60">
        Convert to LP
      </h2>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MANO_TO_LP_TIERS.map((tier, i) => {
          const best = i === MANO_TO_LP_TIERS.length - 1;
          const afford = mano >= tier.mano;
          return (
            <div
              key={tier.mano}
              className={
                "relative flex flex-col items-center gap-2 rounded-xl border bg-black/20 p-3 text-center " +
                (best ? "border-soul/60 shadow-[0_0_14px_rgba(125,224,240,.22)]" : "border-cream/15")
              }
            >
              {best && (
                <span className="absolute -top-2 rounded-full bg-soul px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#06363f]">
                  Best rate
                </span>
              )}
              <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-cream">
                {tier.mano} <ManoIcon size={15} />
                <span aria-hidden className="text-cream/45">&rarr;</span>
                {tier.lp} <LifeProficiencyIcon size={15} />
              </span>
              <button
                onClick={() => setNotice(SOON)}
                disabled={!afford}
                className="mt-0.5 w-full rounded-md bg-soul py-1.5 text-sm font-semibold text-[#06363f] transition-opacity hover:opacity-90 disabled:opacity-40"
                title={afford ? "Convert" : `Need ${tier.mano} Mano`}
              >
                {afford ? "Convert" : `Need ${tier.mano}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
