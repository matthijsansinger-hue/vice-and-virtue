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
// The art is cut so nothing outside the cloth is paper: the fringe and the
// outline's rim are pencil with the white separated out (colour-to-alpha), so
// no white can show against any background. See PROJECT.md "Camp banners".

import type { CSSProperties, ReactNode } from "react";

type Art = {
  src: string;
  w: number; // source width
  h: number; // source height
  top: number; // last row of the top slice (crenellations + rim)
  bottom: number; // first row of the bottom slice (the point + fringe), just above the first strand
};

const ART: Record<"vice" | "virtue", Art> = {
  virtue: { src: "/camp-banners/virtue.webp?v=2", w: 418, h: 1094, top: 90, bottom: 845 },
  vice: { src: "/camp-banners/vice.webp?v=2", w: 444, h: 1098, top: 75, bottom: 840 },
};

export function CampBanner({
  camp,
  children,
  className = "",
  contentClassName = "",
}: {
  camp: "vice" | "virtue";
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const a = ART[camp];
  const top = a.top;
  const bottom = a.h - a.bottom;
  const middle = a.bottom - a.top;
  const url = `url("${a.src}")`;
  // Padding percentages resolve against the banner's width, so the content
  // stays clear of the top and the point at every size.
  const pct = (px: number) => `${(px / a.w) * 100}%`;

  const slice = (style: CSSProperties) => <div className="shrink-0" style={style} />;
  return (
    <div
      className={`relative w-full self-stretch ${className}`}
      style={{ aspectRatio: `${a.w} / ${a.h}` }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex flex-col"
        style={{ filter: "drop-shadow(0 10px 14px rgba(0,0,0,.5))" }}
      >
        {slice({ aspectRatio: `${a.w} / ${top}`, background: `${url} center top / 100% auto no-repeat` })}
        <div
          className="-my-px min-h-0 flex-1"
          style={{
            background: `${url} 0 ${(top / (top + bottom)) * 100}% / 100% ${(a.h / middle) * 100}% no-repeat`,
          }}
        />
        {slice({ aspectRatio: `${a.w} / ${bottom}`, background: `${url} center bottom / 100% auto no-repeat` })}
      </div>
      <div
        className={`relative [text-shadow:0_1px_3px_rgba(0,0,0,.95)] ${contentClassName}`}
        style={{
          paddingTop: pct(top + 12),
          paddingBottom: pct(bottom),
          paddingLeft: pct(24),
          paddingRight: pct(24),
        }}
      >
        {children}
      </div>
    </div>
  );
}
