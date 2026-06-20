"use client";

import { Banner } from "./Banner";
import {
  COLOR_TIER_ORDER,
  COLOR_TIER_LABEL,
  NAME_COLOR_UNLOCK,
  BANNER_COLOR_UNLOCK,
  NAME_TEXT_COLOR,
  NAME_TEXT_SHADOW,
  BANNER_BG,
  SHOP_COLOR_ORDER,
  SHOP_COLORS,
  nameColorStyle,
  bannerBg,
  type ColorTier,
  type ShopColorId,
} from "@/lib/levelColors";

type Special = { id: string; label: string };

const DEFAULT_BAR = "linear-gradient(170deg,#2a2540,#1a1830)";

// Profile customizer: pick the name + banner color you've earned by level. A
// live banner preview sits on top; each row offers "Default" plus the five
// tiers, with locked ones greyed and showing the level they unlock at.
export function ColorCustomizer({
  level,
  levelProgress,
  username,
  avatarUrl,
  featured,
  nameColor,
  bannerColor,
  ownedColors,
  onChange,
}: {
  level: number;
  levelProgress: number;
  username: string;
  avatarUrl: string | null;
  featured: string[];
  nameColor: string | null;
  bannerColor: string | null;
  ownedColors: string[];
  onChange: (kind: "name" | "banner", tier: string | null) => void;
}) {
  const ownedShop = SHOP_COLOR_ORDER.filter((id) => ownedColors.includes(id));
  // Special owned cosmetics (Founder pack + season pass), per slot.
  const nameSpecials: Special[] = [];
  if (ownedColors.includes("founder")) nameSpecials.push({ id: "founder", label: "Founder" });
  if (ownedColors.includes("firstsouls")) nameSpecials.push({ id: "firstsouls", label: "First Souls" });
  const bannerSpecials: Special[] = [];
  if (ownedColors.includes("pioneer")) bannerSpecials.push({ id: "pioneer", label: "Pioneer" });
  if (ownedColors.includes("spirit")) bannerSpecials.push({ id: "spirit", label: "Spirit" });
  const initials = username.slice(0, 2).toUpperCase();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-gold">Banner colors</h2>
        <p className="text-xs text-cream/50">
          Earn name + banner colors as you level up, then equip the ones you
          like. Your banner shows everywhere — the hub, the pre-lobby and
          outreach.
        </p>
      </div>

      {/* Live preview of your banner with the current picks. */}
      <div className="flex justify-center rounded-xl border border-gold/20 bg-black/20 p-3">
        <Banner
          name={username}
          avatarUrl={avatarUrl}
          initials={initials}
          featuredBadges={featured}
          nameColor={nameColor}
          bannerColor={bannerColor}
          level={level}
          levelProgress={levelProgress}
        />
      </div>

      <ColorRow
        title="Name color"
        kind="name"
        unlock={NAME_COLOR_UNLOCK}
        swatchKind="name"
        level={level}
        selected={nameColor}
        shopColors={ownedShop}
        specials={nameSpecials}
        onChange={onChange}
      />
      <ColorRow
        title="Banner color"
        kind="banner"
        unlock={BANNER_COLOR_UNLOCK}
        swatchKind="banner"
        level={level}
        selected={bannerColor}
        shopColors={ownedShop}
        specials={bannerSpecials}
        onChange={onChange}
      />
    </div>
  );
}

function ColorRow({
  title,
  kind,
  unlock,
  swatchKind,
  level,
  selected,
  shopColors,
  specials,
  onChange,
}: {
  title: string;
  kind: "name" | "banner";
  unlock: Record<ColorTier, number>;
  swatchKind: "name" | "banner";
  level: number;
  selected: string | null;
  shopColors: ShopColorId[];
  specials: Special[];
  onChange: (kind: "name" | "banner", tier: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-cream/70">
        {title}
      </span>
      <div className="flex flex-wrap gap-2">
        {/* Default (no color). */}
        <button
          type="button"
          onClick={() => onChange(kind, null)}
          className={
            "flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-1.5 transition-colors " +
            (selected == null
              ? "border-gold bg-gold/10"
              : "border-cream/15 hover:border-cream/30")
          }
        >
          <span
            className="flex h-6 w-11 items-center justify-center rounded text-[11px] text-cream/55"
            style={{ background: DEFAULT_BAR }}
          >
            Aa
          </span>
          <span className="text-[10px] text-cream/70">Default</span>
        </button>

        {COLOR_TIER_ORDER.map((t) => {
          const need = unlock[t];
          const locked = level < need;
          const isSel = selected === t;
          return (
            <button
              key={t}
              type="button"
              disabled={locked}
              onClick={() => onChange(kind, t)}
              title={locked ? `Unlock at level ${need}` : COLOR_TIER_LABEL[t]}
              className={
                "flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-1.5 transition-colors " +
                (isSel
                  ? "border-gold bg-gold/10"
                  : locked
                    ? "cursor-not-allowed border-cream/10 opacity-50"
                    : "border-cream/15 hover:border-cream/30")
              }
            >
              {swatchKind === "name" ? (
                <span
                  className="flex h-6 w-11 items-center justify-center rounded text-[11px] font-bold"
                  style={{
                    background: DEFAULT_BAR,
                    color: NAME_TEXT_COLOR[t],
                    textShadow: NAME_TEXT_SHADOW,
                  }}
                >
                  Aa
                </span>
              ) : (
                <span
                  className="h-6 w-11 rounded"
                  style={{ background: BANNER_BG[t] }}
                />
              )}
              <span className="text-[10px] text-cream/70">
                {locked ? `Lv ${need}` : COLOR_TIER_LABEL[t]}
              </span>
            </button>
          );
        })}

        {/* Colors bought in the Shop (owned = always equippable). */}
        {shopColors.map((id) => {
          const c = SHOP_COLORS[id];
          const isSel = selected === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(kind, id)}
              title={c.label}
              className={
                "flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-1.5 transition-colors " +
                (isSel
                  ? "border-gold bg-gold/10"
                  : "border-cream/15 hover:border-cream/30")
              }
            >
              {swatchKind === "name" ? (
                <span
                  className="flex h-6 w-11 items-center justify-center rounded text-[11px] font-bold"
                  style={{ background: DEFAULT_BAR, ...nameColorStyle(id) }}
                >
                  Aa
                </span>
              ) : (
                <span className="h-6 w-11 rounded" style={{ background: c.hex }} />
              )}
              <span className="text-[10px] text-cream/70">{c.label}</span>
            </button>
          );
        })}

        {/* Special owned cosmetics — Founder pack + season pass (when owned). */}
        {specials.map((sp) => (
          <button
            key={sp.id}
            type="button"
            onClick={() => onChange(kind, sp.id)}
            title={sp.label}
            className={
              "flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-1.5 transition-colors " +
              (selected === sp.id
                ? "border-gold bg-gold/10"
                : "border-cream/15 hover:border-cream/30")
            }
          >
            {swatchKind === "name" ? (
              <span
                className="flex h-6 w-11 items-center justify-center rounded text-[11px] font-bold"
                style={{ background: DEFAULT_BAR, ...nameColorStyle(sp.id) }}
              >
                Aa
              </span>
            ) : (
              <span className="h-6 w-11 rounded" style={{ background: bannerBg(sp.id) ?? DEFAULT_BAR }} />
            )}
            <span className="text-[10px] text-cream/70">{sp.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
