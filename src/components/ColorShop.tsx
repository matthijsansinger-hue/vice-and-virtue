"use client";

import { useState } from "react";
import { buyColor, type AccountEconomy } from "@/lib/economy";
import {
  SHOP_COLOR_ORDER,
  SHOP_COLORS,
  SHOP_COLOR_PRICE,
  bannerTextLight,
  nameColorStyle,
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
  const [error, setError] = useState<string | null>(null);

  const owned = new Set(econ?.ownedColors ?? []);
  const mano = econ?.mano ?? 0;

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
      <h1 className="text-2xl font-semibold text-gold">Name &amp; banner colors</h1>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SHOP_COLOR_ORDER.map((id) => {
          const c = SHOP_COLORS[id];
          const isOwned = owned.has(id);
          const labelColor = bannerTextLight(id) ? "#f5ecd6" : "#16181d";
          const nameStyle = nameColorStyle(id);
          const afford = mano >= SHOP_COLOR_PRICE;
          return (
            <div
              key={id}
              className="flex flex-col gap-1.5 rounded-xl border border-cream/15 bg-black/20 p-2"
            >
              <span className="text-center text-xs font-semibold text-cream/85">{c.label}</span>
              {/* Name color — the name as it actually renders (color + shadow). */}
              <div className="flex items-center justify-between gap-2 rounded-lg bg-[#38271a] px-2.5 py-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-cream/45">Name</span>
                <span className="text-base font-bold leading-none" style={nameStyle}>Aa</span>
              </div>
              {/* Banner color — a bar in the color, with its contrast text. */}
              <div
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
                style={{ background: c.hex }}
              >
                <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: labelColor, opacity: 0.7 }}>
                  Banner
                </span>
                <span className="text-base font-bold leading-none" style={{ color: labelColor }}>Aa</span>
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
    </div>
  );
}
