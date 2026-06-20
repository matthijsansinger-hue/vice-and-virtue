"use client";

// Custom currency/HUD glyphs replacing the generic Tabler icons:
// - ManoIcon: a faceted magenta gem (Mano, the premium cosmetics currency)
// - LifeProficiencyIcon: a teal hex token (Life Proficiency / LP, unlocks roles)
// - SoulShardIcon: a faceted shard with an eye-like strike + emanating sparks
// - SoulEnergyIcon: a swirling spectral-cyan flame (the in-match Soul Energy)
// - DailyRewardIcon: a crowned gift box (royal take on the daily-login reward)
// - LeaderboardIcon: a ribboned star medal
// - HowToPlayIcon: an open rulebook with a question mark

import { useId } from "react";

type IconProps = {
  size?: number;
  className?: string;
};

// Mano — premium gem currency (cosmetics). Faceted magenta crystal.
export function ManoIcon({ size = 16, className }: IconProps) {
  const id = useId();
  const grad = `mano-gem-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd1ea" />
          <stop offset="45%" stopColor="#ff5db1" />
          <stop offset="100%" stopColor="#bf1f78" />
        </linearGradient>
      </defs>
      {/* faceted gem body */}
      <polygon points="34,14 66,14 90,44 50,92 10,44" fill={`url(#${grad})`} stroke="#ffe3f3" strokeWidth="2" strokeOpacity="0.85" />
      {/* top facet band + crown shading */}
      <polygon points="34,14 66,14 74,44 26,44" fill="#ffffff" fillOpacity="0.24" />
      <polygon points="34,14 26,44 10,44" fill="#000000" fillOpacity="0.12" />
      <polygon points="66,14 90,44 74,44" fill="#ffffff" fillOpacity="0.14" />
      {/* pavilion facets to the point */}
      <polygon points="26,44 50,92 10,44" fill="#000000" fillOpacity="0.20" />
      <polygon points="74,44 90,44 50,92" fill="#000000" fillOpacity="0.10" />
      <line x1="26" y1="44" x2="50" y2="92" stroke="#fff" strokeWidth="1.5" strokeOpacity="0.28" />
      <line x1="74" y1="44" x2="50" y2="92" stroke="#fff" strokeWidth="1.5" strokeOpacity="0.22" />
      <line x1="10" y1="44" x2="90" y2="44" stroke="#fff" strokeWidth="1.5" strokeOpacity="0.22" />
    </svg>
  );
}

// Life Proficiency — general currency (unlocks roles). Teal hex token.
export function LifeProficiencyIcon({ size = 16, className }: IconProps) {
  const id = useId();
  const grad = `lp-hex-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c5fff6" />
          <stop offset="50%" stopColor="#3fd9c8" />
          <stop offset="100%" stopColor="#1b8f86" />
        </linearGradient>
      </defs>
      {/* hex body */}
      <polygon points="50,6 88,28 88,72 50,94 12,72 12,28" fill={`url(#${grad})`} stroke="#d8fff8" strokeWidth="2" strokeOpacity="0.85" />
      {/* inset hex ring */}
      <polygon points="50,20 76,35 76,65 50,80 24,65 24,35" fill="none" stroke="#06403b" strokeOpacity="0.4" strokeWidth="2.5" />
      {/* core */}
      <circle cx="50" cy="50" r="12" fill="#eafffb" />
      <circle cx="50" cy="50" r="12" fill="none" stroke="#0d5a53" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="50" cy="50" r="4.5" fill="#1b8f86" />
    </svg>
  );
}

export function SoulShardIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* faceted shard */}
      <path
        d="M12 2 L18.5 9.5 L12 22 L5.5 9.5 Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 9.5 L12 2 M15 9.5 L12 2" stroke="currentColor" strokeWidth="1" strokeOpacity="0.55" strokeLinecap="round" />
      {/* horizontal strike — the "eye" line */}
      <path d="M5.5 9.5 H18.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* static sparks */}
      <path
        d="M19.5 3.2 L20.2 4.9 L21.9 5.6 L20.2 6.3 L19.5 8 L18.8 6.3 L17.1 5.6 L18.8 4.9 Z"
        fill="currentColor"
      />
      <path
        d="M3 15.2 L3.55 16.45 L4.8 17 L3.55 17.55 L3 18.8 L2.45 17.55 L1.2 17 L2.45 16.45 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SoulEnergyIcon({ size = 18, className }: IconProps) {
  const id = useId();
  const grad = `soul-flame-${id}`;
  const core = `soul-core-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={grad} x1="12" y1="1.5" x2="12" y2="22.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#dffaff" />
          <stop offset="45%" stopColor="#7de0f0" />
          <stop offset="100%" stopColor="#0b7285" />
        </linearGradient>
        <radialGradient id={core} cx="50%" cy="62%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#bdf3fb" />
          <stop offset="100%" stopColor="#7de0f0" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Outer flame body — a teardrop tongue with a curled wick tip. */}
      <path
        d="M13 1.8 C 13.4 5 10.2 6.4 9 9 C 7.4 6.6 8.1 5 8.1 5 C 5.4 7.4 4 10.4 4 13.4 C 4 18 7.6 22 12 22 C 16.4 22 20 18.4 20 13.8 C 20 9 16.6 6.2 16.9 2.6 C 15.7 4 15.4 5.4 15.4 5.4 C 15.6 3.4 14.4 2.3 13 1.8 Z"
        fill={`url(#${grad})`}
        stroke="#0b7285"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Inner swirl — a spiral curl of the cooler cyan rising through the flame. */}
      <path
        d="M12 19 C 9.2 19 7.6 16.8 8.6 14.4 C 9.4 12.5 11.8 12.1 13 13.4 C 13.9 14.4 13.4 15.9 12.2 16 C 11.4 16.1 10.8 15.5 11 14.8"
        fill="none"
        stroke="#eafcff"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeOpacity="0.9"
      />
      {/* Hot core glow at the base of the swirl. */}
      <ellipse cx="11.7" cy="16.4" rx="4.2" ry="4.8" fill={`url(#${core})`} />
    </svg>
  );
}

export function DailyRewardIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* crown */}
      <path
        d="M6.5 9 L8 4.5 L11 7.5 L12 4.5 L13 7.5 L16 4.5 L17.5 9 Z"
        fill="currentColor"
        fillOpacity="0.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {/* gift box lid */}
      <rect x="3" y="9.5" width="18" height="3.5" rx="1" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
      {/* gift box body */}
      <rect x="4" y="13" width="16" height="7.5" rx="1" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
      {/* ribbon */}
      <path d="M12 9.5 V20.5 M3 13 H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* gem on ribbon knot */}
      <circle cx="12" cy="11.25" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function LeaderboardIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* ribbon straps */}
      <path d="M9 2 L10 11.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12 1.5 L12 7.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M15 2 L14 11.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* star medal */}
      <path
        d="M12 9.2 L13.53 13.4 L17.99 13.55 L14.47 16.3 L15.7 20.6 L12 18.1 L8.3 20.6 L9.53 16.3 L6.01 13.55 L10.47 13.4 Z"
        fill="currentColor"
        fillOpacity="0.25"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HowToPlayIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      {/* open book */}
      <path
        d="M12 5.2 C10.2 3.7 6.8 3.2 3.5 3.6 V18.1 C6.8 17.7 10.2 18.2 12 19.7 C13.8 18.2 17.2 17.7 20.5 18.1 V3.6 C17.2 3.2 13.8 3.7 12 5.2 Z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 5.2 V19.7" stroke="currentColor" strokeWidth="1.5" />
      {/* question mark on the right page */}
      <path
        d="M14.5 8.4 c0 -1.1 1 -1.9 2.1 -1.7 c1 0.1 1.8 1 1.7 2 c-0.1 0.9 -0.8 1.2 -1.4 1.6 c-0.5 0.3 -0.7 0.6 -0.7 1.2"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="16.2" cy="13.6" r="0.65" fill="currentColor" />
    </svg>
  );
}
