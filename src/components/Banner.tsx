"use client";

import { ShowcaseBadges } from "./ShowcaseBadges";
import { LevelStar } from "./LevelStar";
import { CharacterAvatar } from "./CharacterAvatar";
import { bannerBg, nameColorStyle, bannerTextLight } from "@/lib/levelColors";
import type { CharacterConfig } from "@/lib/character";

// Default banner for players with no banner color equipped: the game's plain
// beige (the same cream used for cards/panels elsewhere), with dark text.
const DEFAULT_BANNER_BG = "var(--color-cream)";

// The player "banner" — a horizontal bar holding the profile icon, the player's
// name (in their earned name color) and their featured badges, on their earned
// banner color. Used in the hub top bar; the in-game name bars apply the same
// colors inline. `nameColor`/`bannerColor` are tier ids (or null = default).
export function Banner({
  name,
  character,
  initials,
  featuredBadges = [],
  nameColor,
  bannerColor,
  level,
  levelProgress,
  xpInto,
  xpForNext,
  size = "sm",
  fullWidth = false,
  levelStar = false,
}: {
  name: string;
  character: CharacterConfig | null;
  initials: string;
  featuredBadges?: string[];
  nameColor: string | null;
  bannerColor: string | null;
  level?: number;
  levelProgress?: number; // 0–1 toward the next level
  xpInto?: number; // XP earned into the current level (shown on the big size)
  xpForNext?: number; // total XP this level needs for the next one
  size?: "sm" | "lg";
  fullWidth?: boolean; // stretch to the container width (uniform bar, badges right)
  levelStar?: boolean; // show the level inside a 9-pointed star instead of "Level N" text
}) {
  const lg = size === "lg";
  const customBg = bannerBg(bannerColor);
  // No banner color → the plain beige default (dark text); a custom banner color
  // decides its own text contrast (a light color like yellow/white flips dark).
  const bg = customBg ?? DEFAULT_BANNER_BG;
  const lightText = customBg ? bannerTextLight(bannerColor) : false;
  // Only the dark/custom banners need a name shadow; the beige default reads
  // with plain dark text.
  const nameStyle = nameColorStyle(nameColor) ?? (lightText ? { textShadow: "0 1px 3px rgba(0,0,0,.65)" } : undefined);
  const dim = lightText ? "text-cream/85" : "text-home-bg/85";
  const avatarBox = lg ? "h-14 w-14" : "h-8 w-8";
  return (
    <span
      className={
        "flex min-w-0 items-center rounded-full border border-gold/40 " +
        (fullWidth ? "w-full " : "max-w-full ") +
        (lg ? "gap-3 py-2 pl-2 pr-5" : "gap-2 py-1 pl-1 pr-3")
      }
      style={{ background: bg }}
    >
      <CharacterAvatar
        character={character}
        initials={initials}
        className={`${avatarBox} ring-2 ring-gold/50`}
        textClass={lg ? "text-lg" : "text-xs"}
      />
      <span className="flex min-w-0 flex-col items-start leading-tight">
        <span
          className={
            "truncate font-semibold " +
            (lg ? "max-w-[18rem] text-lg" : "max-w-[14rem] text-sm") +
            (lightText ? " text-cream" : " text-home-bg")
          }
          style={nameStyle}
        >
          {name}
        </span>
        {level != null && (
          <span className={"flex flex-col gap-0.5 " + (lg ? "mt-1" : "mt-0.5")}>
            <span className="flex items-center gap-1.5">
              {levelStar ? (
                <LevelStar level={level} size={lg ? 34 : 22} />
              ) : (
                <span className={`font-semibold leading-none ${dim} ${lg ? "text-xs" : "text-[10px]"}`}>
                  {lg ? `Level ${level}` : level}
                </span>
              )}
              <span className={`overflow-hidden rounded-full bg-black/30 ring-1 ring-black/10 ${lg ? "h-2.5 w-36" : "h-1.5 w-14"}`}>
                <span
                  className="block h-full rounded-full bg-gold"
                  style={{ width: `${Math.round(Math.max(0, Math.min(1, levelProgress ?? 0)) * 100)}%` }}
                />
              </span>
            </span>
            {lg && xpInto != null && xpForNext != null && (
              <span className={`text-[11px] leading-none ${dim}`}>
                {xpInto.toLocaleString()} / {xpForNext.toLocaleString()} XP to level {level + 1}
              </span>
            )}
          </span>
        )}
      </span>
      {featuredBadges.length > 0 && (
        <span className={"flex shrink-0 " + (lg ? "ml-1" : "ml-0.5")}>
          <ShowcaseBadges ids={featuredBadges} sizeClass={lg ? "h-9 w-9" : "h-6 w-6"} />
        </span>
      )}
    </span>
  );
}
