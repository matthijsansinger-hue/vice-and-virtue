"use client";

import { useState } from "react";
import { buyColor, buyFounderPack, type AccountEconomy, LE_ABBR } from "@/lib/economy";
import {
  SHOP_COLOR_ORDER,
  SHOP_COLORS,
  SHOP_COLOR_PRICE,
  bannerTextLight,
  type ShopColorId,
} from "@/lib/levelColors";
import { ManoIcon } from "./CurrencyIcons";

// The cosmetics Shop: buy flat name/banner colors with Mano. Each color is one
// 200-Mano purchase that unlocks it for both slots; equipping happens on the
// Profile (alongside the level-tier colors). `onBought` refreshes the economy.
export function ColorShop({
  econ,
  onBought,
}: {
  econ: AccountEconomy | null;
  onBought: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [founderBusy, setFounderBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owned = new Set(econ?.ownedColors ?? []);
  const mano = econ?.mano ?? 0;
  const ownsFounder = owned.has("pioneer"); // the pack-ownership marker

  async function handleFounder() {
    if (founderBusy || ownsFounder) return;
    if (mano < 1000) {
      setError("Not enough Mano — the Founder Pack costs 1000.");
      return;
    }
    setFounderBusy(true);
    setError(null);
    try {
      const res = await buyFounderPack();
      if (res.ok || res.reason === "owned") {
        onBought();
      } else if (res.reason === "insufficient") {
        setError("Not enough Mano.");
      } else {
        setError("Could not buy the Founder Pack.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setFounderBusy(false);
    }
  }

  async function handleBuy(id: ShopColorId) {
    if (busy || owned.has(id)) return;
    if (mano < SHOP_COLOR_PRICE) {
      setError(`Not enough Mano — colors cost ${SHOP_COLOR_PRICE}.`);
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await buyColor(id);
      if (res.ok || res.reason === "owned") {
        onBought();
      } else if (res.reason === "insufficient") {
        setError("Not enough Mano.");
      } else {
        setError("Could not buy that color.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-gold">Name &amp; banner colors</h1>
          <p className="mt-1 text-sm text-cream/60">
            Buy a color to wear as your name or banner — then equip it on your{" "}
            <span className="text-cream/80">Profile</span> (it sits alongside the
            colors you unlock by levelling).
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg border-2 border-gold bg-panel px-3 py-1.5 text-sm font-semibold text-gold shadow-[0_0_10px_rgba(227,181,16,0.4)]">
          <ManoIcon size={16} /> {mano}
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {/* Featured: the Founder Pack bundle. */}
      <div className="mt-4 overflow-hidden rounded-2xl border-2 border-gold bg-black/30 shadow-[0_0_18px_rgba(227,181,16,.22)]">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/banners/pioneer.png?v=3" alt="Pioneer banner" className="block max-h-32 w-full object-cover object-center" />
          <span className="absolute left-3 top-2 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-gold">
            Founder Pack
          </span>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gold">Founder Pack</h2>
            <ul className="mt-1 space-y-0.5 text-sm text-cream/75">
              <li>&bull; 4000 {LE_ABBR}</li>
              <li>&bull; The <span className="text-cream">Pioneer</span> banner</li>
              <li>&bull; The <span className="text-cream">Founder</span> name color (ivory, decorative)</li>
            </ul>
          </div>
          {ownsFounder ? (
            <span className="shrink-0 self-start rounded-lg border border-gold/40 px-4 py-2 text-sm font-semibold text-cream/70 sm:self-auto">
              Owned
            </span>
          ) : (
            <button
              onClick={handleFounder}
              disabled={founderBusy || mano < 1000}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40 sm:self-auto"
              title={mano >= 1000 ? "Buy the Founder Pack" : "Not enough Mano"}
            >
              {founderBusy ? "…" : (<><ManoIcon size={15} /> 1000</>)}
            </button>
          )}
        </div>
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-widest text-cream/60">
        Colors
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SHOP_COLOR_ORDER.map((id) => {
          const c = SHOP_COLORS[id];
          const isOwned = owned.has(id);
          const labelColor = bannerTextLight(id) ? "#f5ecd6" : "#16181d";
          const afford = mano >= SHOP_COLOR_PRICE;
          return (
            <div
              key={id}
              className="flex flex-col gap-2 rounded-xl border border-cream/15 bg-black/20 p-2"
            >
              {/* Preview: a banner bar in the colour with its name on it. */}
              <div
                className="flex h-14 items-center justify-center rounded-lg"
                style={{ background: c.hex }}
              >
                <span className="text-sm font-semibold" style={{ color: labelColor }}>
                  {c.label}
                </span>
              </div>
              {isOwned ? (
                <span className="rounded-md bg-cream/10 py-1.5 text-center text-xs font-semibold text-cream/70">
                  Owned
                </span>
              ) : (
                <button
                  onClick={() => handleBuy(id)}
                  disabled={busy !== null || !afford}
                  className="flex items-center justify-center gap-1 rounded-md bg-gold py-1.5 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                  title={afford ? `Buy ${c.label}` : "Not enough Mano"}
                >
                  {busy === id ? (
                    "…"
                  ) : (
                    <>
                      <ManoIcon size={13} /> {SHOP_COLOR_PRICE}
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-cream/45">
        Earn Mano from opening Soul Fragments. Spend it here — it isn&rsquo;t used
        for unlocking roles ({LE_ABBR} does that).
      </p>
    </div>
  );
}
