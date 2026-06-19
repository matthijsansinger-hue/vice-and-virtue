"use client";

import { ShowcaseBadges } from "./ShowcaseBadges";
import { bannerBg, nameColorStyle } from "@/lib/levelColors";

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
}: {
  name: string;
  avatarUrl: string | null;
  initials: string;
  featuredBadges?: string[];
  nameColor: string | null;
  bannerColor: string | null;
  level?: number;
}) {
  const bg = bannerBg(bannerColor);
  const nameStyle = nameColorStyle(nameColor);
  return (
    <span
      className={
        "flex items-center gap-2 rounded-full border border-gold/40 py-1 pl-1 pr-3 " +
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
      <span className="flex flex-col items-start leading-tight">
        <span className="max-w-[10rem] truncate text-sm font-semibold text-cream" style={nameStyle}>
          {name}
        </span>
        {level != null && <span className="text-[10px] text-cream/70">Lv {level}</span>}
      </span>
      {featuredBadges.length > 0 && (
        <span className="ml-0.5 flex shrink-0">
          <ShowcaseBadges ids={featuredBadges} sizeClass="h-6 w-6" />
        </span>
      )}
    </span>
  );
}
