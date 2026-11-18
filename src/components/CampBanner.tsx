// A camp's hand-drawn hanging banner (public/camp-banners/*.webp) used as the
// backdrop behind a camp's roles: the hub Roles tab and the in-game cast.
//
// The art is drawn in three slices so it can hold any number of roles without
// warping its ends: the crenellated top and the pointed, fringed bottom keep
// their proportions, and only the plain body between them stretches. The
// banner never gets shorter than its natural shape (aspect-ratio acts as a
// minimum), so with few roles it simply hangs at full length.
//
// Children sit on the body: below the crenellations and above the fringe. The
// camp's name goes ABOVE the banner (the caller renders it), not on it. Text
// on the banner should carry a dark shadow (the content wrapper sets one) —
// the Vice banner is a bright orange.
//
// Two ways to use it:
// - <CampBanner> — one banner with its content inside (the in-game cast).
// - <BannerArt> + bannerPadding() — just the drawing, as a grid item, when two
//   banners share one grid so their rows line up (the hub Roles tab: each
//   class row is as tall as the taller side, so Exterminators sits level with
//   Protectors, and so on).
//
// The art is cut so nothing outside the cloth is paper: the fringe and the
// outline's rim are pencil with the white separated out (colour-to-alpha), so
// no white can show against any background. See PROJECT.md "Camp banners".

import type { CSSProperties, ReactNode } from "react";

type Camp = "vice" | "virtue";

type Art = {
  src: string;
  w: number; // source width
  h: number; // source height
  top: number; // last row of the top slice (crenellations + rim)
  bottom: number; // first row of the bottom slice (the point + fringe), just above the first strand
};

const ART: Record<Camp, Art> = {
  virtue: { src: "/camp-banners/virtue.webp?v=2", w: 418, h: 1094, top: 90, bottom: 845 },
  vice: { src: "/camp-banners/vice.webp?v=2", w: 444, h: 1098, top: 75, bottom: 840 },
};

// Where content may sit on the banner, as padding. Percentages resolve against
// the width of the box they're set on (the banner's own column), so the
// content stays clear of the crenellations and the fringe at every size.
export function bannerPadding(camp: Camp): { top: string; bottom: string; x: string } {
  const a = ART[camp];
  const pct = (px: number) => `${(px / a.w) * 100}%`;
  return { top: pct(a.top + 12), bottom: pct(a.h - a.bottom), x: pct(24) };
}

// The drawing alone: the three slices stacked to fill the box. Give it a
// width; its height is at least the banner's natural shape, and when the box
// is taller only the body stretches.
export function BannerArt({
  camp,
  className = "",
  style,
}: {
  camp: Camp;
  className?: string;
  style?: CSSProperties;
}) {
  const a = ART[camp];
  const top = a.top;
  const bottom = a.h - a.bottom;
  const middle = a.bottom - a.top;
  const url = `url("${a.src}")`;
  return (
    <div
      aria-hidden
      className={`pointer-events-none flex w-full flex-col self-stretch ${className}`}
      style={{
        aspectRatio: `${a.w} / ${a.h}`,
        filter: "drop-shadow(0 10px 14px rgba(0,0,0,.5))",
        ...style,
      }}
    >
      <div
        className="shrink-0"
        style={{ aspectRatio: `${a.w} / ${top}`, background: `${url} center top / 100% auto no-repeat` }}
      />
      <div
        className="-my-px min-h-0 flex-1"
        style={{
          background: `${url} 0 ${(top / (top + bottom)) * 100}% / 100% ${(a.h / middle) * 100}% no-repeat`,
        }}
      />
      <div
        className="shrink-0"
        style={{ aspectRatio: `${a.w} / ${bottom}`, background: `${url} center bottom / 100% auto no-repeat` }}
      />
    </div>
  );
}

export function CampBanner({
  camp,
  children,
  className = "",
  contentClassName = "",
}: {
  camp: Camp;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const a = ART[camp];
  const pad = bannerPadding(camp);
  return (
    <div
      className={`relative w-full self-stretch ${className}`}
      style={{ aspectRatio: `${a.w} / ${a.h}` }}
    >
      <BannerArt camp={camp} className="absolute inset-0" />
      <div
        className={`relative [text-shadow:0_1px_3px_rgba(0,0,0,.95)] ${contentClassName}`}
        style={{
          paddingTop: pad.top,
          paddingBottom: pad.bottom,
          paddingLeft: pad.x,
          paddingRight: pad.x,
        }}
      >
        {children}
      </div>
    </div>
  );
}
