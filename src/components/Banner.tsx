"use client";

import { ShowcaseBadges } from "./ShowcaseBadges";
import { bannerBg, nameColorStyle, bannerTextLight } from "@/lib/levelColors";

// The player "banner" — a horizontal bar holding the profile icon, the player's
// name (in their earned name color) and their featured badges, on their earned
// banner color. Used in the hub top bar; the in-game name bars apply the same
// colors inline. `nameColor`/`bannerColor` are tier ids (or null = default).
export function Banner({
  name,
  avatarUrl,
  initials,
  featuredBadges = [],
  nameColor,
  bannerColor,
  level,
  levelProgress,
}: {
  name: string;
  avatarUrl: string | null;
  initials: string;
  featuredBadges?: string[];
  nameColor: string | null;
  bannerColor: string | null;
  level?: number;
  levelProgress?: number; // 0–1 toward the next level
}) {
  const bg = bannerBg(bannerColor);
  // The default panel is dark, so default to light text; a light banner color
  // (yellow/white) flips it dark.
  const lightText = bg ? bannerTextLight(bannerColor) : true;
  const nameStyle = nameColorStyle(nameColor);
  return (
    <span
      className={
        "flex min-w-0 max-w-full items-center gap-2 rounded-full border border-gold/40 py-1 pl-1 pr-3 " +
        (bg ? "" : "bg-panel")
      }
      style={bg ? { background: bg } : undefined}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-gold/50"
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#372155] text-xs font-semibold text-cream ring-2 ring-gold/40">
          {initials}
        </span>
      )}
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span
          className={"max-w-[14rem] truncate text-sm font-semibold " + (lightText ? "text-cream" : "text-home-bg")}
          style={nameStyle}
        >
          {name}
        </span>
        {level != null && (
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={"text-[10px] font-semibold leading-none " + (lightText ? "text-cream/85" : "text-home-bg/85")}>
              {level}
            </span>
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-black/30 ring-1 ring-black/10">
              <span
                className="block h-full rounded-full bg-gold"
                style={{ width: `${Math.round(Math.max(0, Math.min(1, levelProgress ?? 0)) * 100)}%` }}
              />
            </span>
          </span>
        )}
      </span>
      {featuredBadges.length > 0 && (
        <span className="ml-0.5 flex shrink-0">
          <ShowcaseBadges ids={featuredBadges} sizeClass="h-6 w-6" />
        </span>
      )}
    </span>
  );
}
