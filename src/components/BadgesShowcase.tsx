"use client";

import { useState, type ReactNode } from "react";
import {
  BADGES,
  BADGES_BY_TIER,
  TIER_META,
  TIER_ORDER,
  type BadgeDef,
  type BadgeIcon,
  type BadgeTier,
} from "@/lib/badges";

// Renders every badge grouped by tier (Divine → Earthen). Earned badges
// glow in their tier's theme; locked ones are dimmed but still shown as
// goals. Hovering a badge (PC) shows a small bubble next to it; tapping a
// badge (phone) opens its details in a centered popup.
export function BadgesShowcase({ earned }: { earned: Set<string> }) {
  const totalEarned = earned.size;
  // Tap-selected badge (centered popup) and hover-previewed badge (bubble).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const selected = selectedId
    ? BADGES.find((b) => b.id === selectedId) ?? null
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gold">Badges</h2>
          <span className="text-sm text-cream/60">{totalEarned} earned</span>
        </div>
        <p className="text-xs text-cream/50">
          Earn these by playing — tap any badge to see how.
        </p>
      </div>

      {TIER_ORDER.map((tier) => {
        const meta = TIER_META[tier];
        // Within each tier, show unlocked badges first, then locked ones
        // (stable — original order is preserved within each group).
        const badges = [...BADGES_BY_TIER[tier]].sort(
          (a, b) =>
            (earned.has(a.id) ? 0 : 1) - (earned.has(b.id) ? 0 : 1)
        );
        const earnedCount = badges.filter((b) => earned.has(b.id)).length;
        return (
          <div key={tier} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest"
                style={{
                  background: meta.gradient,
                  color: meta.text,
                  boxShadow: meta.glow,
                }}
              >
                {meta.label}
              </span>
              <span className="text-xs text-cream/50">
                {earnedCount}/{badges.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {badges.map((b) => (
                <BadgeMedallion
                  key={b.id}
                  badge={b}
                  earned={earned.has(b.id)}
                  showBubble={hoverId === b.id && selectedId === null}
                  onClick={() => {
                    setHoverId(null);
                    setSelectedId((prev) => (prev === b.id ? null : b.id));
                  }}
                  onMouseEnter={() => setHoverId(b.id)}
                  onMouseLeave={() =>
                    setHoverId((prev) => (prev === b.id ? null : prev))
                  }
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Centered popup — opened by tapping a badge (mainly for phones). */}
      {selected && (
        <BadgeDetailPopup
          badge={selected}
          earned={earned.has(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// Disc glow per tier. Divine/Noble keep their existing TIER_META glow;
// Primal/Verdant get the subtle glow their tier spec calls for; Earthen
// stays glow-free (humble, grounded). Colors are unchanged — these reuse
// each tier's own ring colour.
const DISC_GLOW: Record<BadgeTier, string | undefined> = {
  divine: TIER_META.divine.glow,
  noble: TIER_META.noble.glow,
  primal: "0 0 9px rgba(243,160,90,0.45)",
  verdant: "0 0 8px rgba(143,217,143,0.45)",
  earthen: undefined,
};

// The decorated medallion: a colored core disc (tier gradient + role art
// or icon) wrapped in tier-specific SVG ornamentation. The ornamentation
// escalates by tier — plain stone (Earthen) up to a radiant sunburst
// (Divine) — but every tier keeps its own palette.
function Medallion({
  badge,
  earned,
  sizeClass,
  showLock = false,
}: {
  badge: BadgeDef;
  earned: boolean;
  sizeClass: string;
  showLock?: boolean;
}) {
  const meta = TIER_META[badge.tier];
  return (
    <div
      className={
        "relative shrink-0 " +
        sizeClass +
        (earned ? "" : " opacity-45 grayscale")
      }
    >
      {/* outward ornaments (rays, leaves, fangs, halo) behind the disc */}
      <Decor tier={badge.tier} layer="back" earned={earned} />
      {/* the colored core disc */}
      <div
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-2 isolate"
        style={{
          width: "92%",
          height: "92%",
          background: meta.gradient,
          borderColor: meta.ring,
          boxShadow: earned ? DISC_GLOW[badge.tier] : undefined,
          color: meta.text,
        }}
      >
        {badge.roleId ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/cards/${badge.roleId}.png`}
              alt=""
              className="h-full w-full object-cover"
            />
            {/* Tier-colored tint so the portrait matches its badge tier
                (purple for Noble, gold for Divine, etc.). `color` blend
                keeps the art's detail but recolors it to the tier hue. */}
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                background: meta.gradient,
                mixBlendMode: "color",
                opacity: 0.6,
              }}
            />
          </>
        ) : (
          <Icon name={badge.icon ?? "medal"} />
        )}
        {showLock && !earned && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-cream">
            <LockIcon />
          </span>
        )}
      </div>
      {/* on-disc ornaments (rims, studs, gem, sparkles) over the disc */}
      <Decor tier={badge.tier} layer="front" earned={earned} />
    </div>
  );
}

// Per-tier ornamentation, split into a "back" layer (drawn behind the
// disc — rays/leaves/wings/halo that extend outward) and a "front" layer
// (drawn over the disc face — rims, studs, gems, sparkles). viewBox is a
// fixed 0–100 square centered on (50,50); the disc edge sits at r≈46 and
// the center r<18 is left clear for the role art / icon. overflow is
// visible so outward details can extend past the disc.
//
// Detail escalates by tier to match the kingdom theme — mineral (Earthen)
// → vegetable (Verdant) → animal (Primal) → human (Noble) → heavenly
// (Divine). Every tier draws in its own palette (`c` = the tier ring
// colour); only Divine adds the brief's pale-blue celestial accent.
function Decor({
  tier,
  layer,
  earned,
}: {
  tier: BadgeTier;
  layer: "back" | "front";
  earned: boolean;
}) {
  const c = TIER_META[tier].ring;
  let content: ReactNode = null;

  // ---------------- EARTHEN — mineral: carved, chipped stone ----------
  if (tier === "earthen" && layer === "back") {
    // Rock fragments breaking off the lower rim.
    content = (
      <>
        {[152, 180, 208].map((a, i) => (
          <path
            key={a}
            d={i === 1 ? "M46,46 L54,46 L57,52 L50,57 L43,52 Z" : "M47,46 L53,47 L54,52 L48,54 Z"}
            fill={c}
            opacity="0.45"
            transform={`rotate(${a} 50 50)`}
          />
        ))}
      </>
    );
  } else if (tier === "earthen" && layer === "front") {
    content = (
      <>
        {/* rough double rim */}
        <circle cx="50" cy="50" r="45.5" fill="none" stroke={c} strokeWidth="2" opacity="0.5" />
        <circle cx="50" cy="50" r="41" fill="none" stroke={c} strokeWidth="1" opacity="0.25" />
        {/* chipped notches at irregular angles */}
        {[18, 96, 165, 247, 322].map((a) => (
          <path key={a} d="M46.5,4.5 L53.5,4.5 L50,9.5 Z" fill="#241910" opacity="0.5" transform={`rotate(${a} 50 50)`} />
        ))}
        {/* cracks */}
        <path d="M50,5 L47.5,13 L50.5,19 L48.5,26" fill="none" stroke="#241910" strokeWidth="1" opacity="0.5" />
        <path d="M83,42 L76,45 L79,50" fill="none" stroke="#241910" strokeWidth="0.9" opacity="0.45" />
        {/* pebble bumps + scratches */}
        {([[68, 24, 2], [29, 30, 1.6], [27, 66, 1.7], [73, 70, 1.4], [60, 80, 1.2]] as const).map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={c} opacity="0.38" />
        ))}
        <path d="M33,42 L43,46" stroke={c} strokeWidth="0.6" opacity="0.4" />
        <path d="M62,62 L71,58" stroke={c} strokeWidth="0.6" opacity="0.35" />
        {/* small carved mountain motif near the top rim */}
        <path d="M41,16 L46,9 L50,14 L55,7 L60,16 Z" fill="none" stroke={c} strokeWidth="1" opacity="0.4" />
      </>
    );
  }

  // ---------------- VERDANT — vegetable: leaves, roots, dew -----------
  else if (tier === "verdant" && layer === "back") {
    content = (
      <>
        {/* roots tendrilling from the lower rim */}
        <path
          d="M44,93 L40,101 M50,95 L50,103 M56,93 L60,101 M40,101 L37,104 M60,101 L63,104"
          fill="none"
          stroke={c}
          strokeWidth="1.2"
          opacity="0.6"
          strokeLinecap="round"
        />
        {/* leaves with veins around the upper rim */}
        {[55, 85, 115, 150, 210, 245, 275, 305].map((a) => (
          <g key={a} transform={`rotate(${a} 50 50)`}>
            <path d="M50,5 C44,0 45,-6 50,-8 C55,-6 56,0 50,5 Z" fill={c} opacity="0.85" />
            <path d="M50,4 L50,-7 M50,0 L47.4,-1.6 M50,0 L52.6,-1.6 M50,-3 L48,-4.6 M50,-3 L52,-4.6" fill="none" stroke="#1e3d1e" strokeWidth="0.5" opacity="0.5" />
          </g>
        ))}
        {/* flower bud at the very top */}
        <path d="M50,3 C46,1 47,-4 50,-5 C53,-4 54,1 50,3 Z" fill={c} opacity="0.8" />
      </>
    );
  } else if (tier === "verdant" && layer === "front") {
    content = (
      <>
        {/* bark-like border: ring + short radial ticks */}
        <circle cx="50" cy="50" r="44.5" fill="none" stroke={c} strokeWidth="2.4" opacity="0.5" />
        {Array.from({ length: 36 }).map((_, i) => (
          <line key={i} x1="50" y1="3" x2="50" y2="5.6" stroke={c} strokeWidth="0.8" opacity="0.32" transform={`rotate(${i * 10} 50 50)`} />
        ))}
        <circle cx="50" cy="50" r="40" fill="none" stroke={c} strokeWidth="0.9" opacity="0.28" />
        {/* moss dot clusters */}
        {([[30, 33], [70, 31], [34, 68]] as const).map(([x, y], i) => (
          <g key={i} fill={c} opacity="0.42">
            <circle cx={x} cy={y} r="1" />
            <circle cx={x + 2.5} cy={y + 1} r="0.8" />
            <circle cx={x + 0.8} cy={y + 2.4} r="0.7" />
          </g>
        ))}
        {/* dew drops with highlight */}
        {([[64, 66], [40, 74]] as const).map(([x, y], i) => (
          <g key={i}>
            <ellipse cx={x} cy={y} rx="1.6" ry="2.1" fill="#bfe8c0" opacity="0.6" />
            <circle cx={x - 0.5} cy={y - 0.7} r="0.5" fill="#ffffff" opacity="0.8" />
          </g>
        ))}
      </>
    );
  }

  // ---------------- PRIMAL — animal: eye, claws, wings, feather -------
  else if (tier === "primal" && layer === "back") {
    content = (
      <>
        {/* shield/star points around the frame */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
          <path key={a} d={i % 2 === 0 ? "M45,4 L55,4 L50,-6 Z" : "M46.5,4 L53.5,4 L50,-2 Z"} fill={c} opacity="0.9" transform={`rotate(${a} 50 50)`} />
        ))}
        {/* horn-like curves at the top corners */}
        <path d="M38,10 C30,4 30,-4 36,-7" fill="none" stroke={c} strokeWidth="2" opacity="0.7" strokeLinecap="round" />
        <path d="M62,10 C70,4 70,-4 64,-7" fill="none" stroke={c} strokeWidth="2" opacity="0.7" strokeLinecap="round" />
        {/* feathered wing accents on each side */}
        {[1, -1].map((s) => (
          <g key={s} transform={`translate(${50 + s * 45},56) scale(${s},1)`} fill={c} opacity="0.65">
            <path d="M0,-7 C7,-7 11,-2 12,3 C7,1 3,0 0,-1 Z" />
            <path d="M0,-1 C7,0 10,5 11,9 C6,8 2,7 0,6 Z" />
            <path d="M0,5 C6,6 9,10 10,13 C5,12 2,11 0,10 Z" />
          </g>
        ))}
      </>
    );
  } else if (tier === "primal" && layer === "front") {
    content = (
      <>
        {/* layered frame */}
        <circle cx="50" cy="50" r="46" fill="none" stroke={c} strokeWidth="3" opacity="0.9" />
        <circle cx="50" cy="50" r="42" fill="none" stroke={c} strokeWidth="1.3" opacity="0.5" />
        <circle cx="50" cy="50" r="37" fill="none" stroke={c} strokeWidth="0.9" opacity="0.32" />
        {/* watchful eye at the top with a glowing pupil */}
        <path d="M41,12 Q50,5 59,12 Q50,19 41,12 Z" fill="#2a0d05" opacity="0.85" />
        <path d="M41,12 Q50,5 59,12 Q50,19 41,12 Z" fill="none" stroke={c} strokeWidth="1.1" />
        <circle cx="50" cy="12" r="2.6" fill={c} />
        <circle cx="50" cy="12" r="1.2" fill="#2a0d05" />
        <circle cx="49.3" cy="11.3" r="0.6" fill="#ffefc5" />
        {/* claw scratches across the lower-left */}
        <path d="M28,58 C33,63 38,67 42,72" fill="none" stroke="#ffefc5" strokeWidth="1" opacity="0.6" />
        <path d="M31,55 C36,60 41,64 45,69" fill="none" stroke="#ffefc5" strokeWidth="1" opacity="0.55" />
        <path d="M34,52 C39,57 44,61 48,66" fill="none" stroke="#ffefc5" strokeWidth="1" opacity="0.5" />
        {/* raven feather at the bottom */}
        <g transform="rotate(180 50 50)">
          <path d="M50,2 C47,8 47,14 50,20 C53,14 53,8 50,2 Z" fill={c} opacity="0.8" />
          <path d="M50,4 L50,19" stroke="#2a0d05" strokeWidth="0.6" opacity="0.6" />
        </g>
      </>
    );
  }

  // ---------------- NOBLE — human: crown, laurel, gem, compass --------
  else if (tier === "noble" && layer === "back") {
    content = (
      <>
        {/* fine rays behind the crest */}
        {Array.from({ length: 24 }).map((_, i) => (
          <path key={i} d="M49.3,3 L50.7,3 L50,-5 Z" fill={c} opacity="0.5" transform={`rotate(${i * 15} 50 50)`} />
        ))}
        {/* laurel leaves hugging the lower sides */}
        {[120, 135, 150, 210, 225, 240].map((a) => (
          <path key={a} d="M50,5 C46,2 47,-2 50,-3 C53,-2 54,2 50,5 Z" fill={c} opacity="0.7" transform={`rotate(${a} 50 50)`} />
        ))}
        {/* crown at the top */}
        <g fill={c} opacity="0.9">
          <path d="M40,2 L43,-6 L47,0 L50,-8 L53,0 L57,-6 L60,2 Z" />
          <circle cx="43" cy="-7" r="1.3" />
          <circle cx="50" cy="-9.5" r="1.5" />
          <circle cx="57" cy="-7" r="1.3" />
        </g>
        {/* ribbon tails at the bottom */}
        <g fill={c} opacity="0.5">
          <path d="M44,92 L40,103 L46,99 L48,94 Z" />
          <path d="M56,92 L60,103 L54,99 L52,94 Z" />
        </g>
      </>
    );
  } else if (tier === "noble" && layer === "front") {
    content = (
      <>
        {/* layered rings */}
        <circle cx="50" cy="50" r="47" fill="none" stroke={c} strokeWidth="2.4" opacity="0.9" />
        <circle cx="50" cy="50" r="43" fill="none" stroke={c} strokeWidth="0.9" opacity="0.5" />
        <circle cx="50" cy="50" r="39" fill="none" stroke={c} strokeWidth="0.8" opacity="0.32" />
        {/* pearl studs */}
        {Array.from({ length: 20 }).map((_, i) => (
          <circle key={i} cx="50" cy="5" r="1.1" fill={c} opacity="0.85" transform={`rotate(${i * 18} 50 50)`} />
        ))}
        {/* 8-point compass / sacred geometry framing the icon */}
        {Array.from({ length: 8 }).map((_, i) => (
          <path key={i} d="M50,18 L51.4,23 L50,28 L48.6,23 Z" fill={c} opacity={i % 2 === 0 ? 0.5 : 0.3} transform={`rotate(${i * 45} 50 50)`} />
        ))}
        {/* faceted gemstone at the top */}
        <path d="M50,-1.5 L54.5,5 L50,11.5 L45.5,5 Z" fill={c} />
        <path d="M50,-1.5 L50,11.5 M45.5,5 L54.5,5" stroke="#3a1857" strokeWidth="0.5" opacity="0.7" />
        <path d="M50,0.5 L52.4,5 L50,9.5 L47.6,5 Z" fill="#fffef5" opacity="0.5" />
        {/* scroll curls at the sides */}
        <path d="M16,50 q-3,-3 0,-6 q3,2 1,5" fill="none" stroke={c} strokeWidth="1" opacity="0.55" />
        <path d="M84,50 q3,-3 0,-6 q-3,2 -1,5" fill="none" stroke={c} strokeWidth="1" opacity="0.55" />
      </>
    );
  }

  // ---------------- DIVINE — heavenly: sunburst, halo, sparks ---------
  else if (tier === "divine" && layer === "back") {
    content = (
      <>
        {/* wide light beams */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <path key={a} d="M44,6 L56,6 L50,-8 Z" fill={c} opacity="0.16" transform={`rotate(${a} 50 50)`} />
        ))}
        {/* sunburst: alternating long/short rays */}
        {Array.from({ length: 24 }).map((_, i) => (
          <path key={i} d={i % 2 === 0 ? "M48.8,3 L51.2,3 L50,-9 Z" : "M49.3,3 L50.7,3 L50,-4 Z"} fill={c} opacity={i % 2 === 0 ? 0.8 : 0.5} transform={`rotate(${i * 15} 50 50)`} />
        ))}
        {/* double halo */}
        <circle cx="50" cy="50" r="53" fill="none" stroke={c} strokeWidth="1.2" opacity="0.6" />
        <circle cx="50" cy="50" r="56.5" fill="none" stroke={c} strokeWidth="0.6" opacity="0.32" />
        {/* soft wing-like extensions at the sides */}
        {[1, -1].map((s) => (
          <g key={s} transform={`translate(${50 + s * 44},54) scale(${s},1)`} fill={c} opacity="0.45">
            <path d="M0,-6 C8,-6 12,-1 13,4 C8,2 3,1 0,0 Z" />
            <path d="M0,1 C7,2 11,6 12,10 C7,9 3,8 0,7 Z" />
          </g>
        ))}
        {/* crown of light at the top */}
        <g fill={c} opacity="0.9">
          <path d="M42,1 L45,-7 L50,-2 L55,-7 L58,1 Z" />
          <circle cx="50" cy="-9" r="1.6" fill="#bfe3ff" />
        </g>
      </>
    );
  } else if (tier === "divine" && layer === "front") {
    content = (
      <>
        {/* layered fine rings */}
        <circle cx="50" cy="50" r="45" fill="none" stroke={c} strokeWidth="1.6" opacity="0.7" />
        <circle cx="50" cy="50" r="41" fill="none" stroke={c} strokeWidth="0.8" opacity="0.45" />
        <circle cx="50" cy="50" r="37" fill="none" stroke="#bfe3ff" strokeWidth="0.6" opacity="0.4" />
        {/* inner light glowing from within (stacked translucency) */}
        <circle cx="50" cy="50" r="22" fill="#ffffff" opacity="0.06" />
        <circle cx="50" cy="50" r="15" fill="#ffffff" opacity="0.08" />
        {/* crystal shine streak */}
        <path d="M34,30 L40,26 L58,62 L52,66 Z" fill="#ffffff" opacity="0.07" />
        {/* sparkles + floating particles (twinkle when earned) */}
        <g className={earned ? "animate-pulse" : undefined}>
          {[20, 70, 160, 200, 290, 340].map((a) => (
            <path key={a} d="M50,4 L51,7 L54,8 L51,9 L50,12 L49,9 L46,8 L49,7 Z" fill="#fffef0" opacity="0.95" transform={`rotate(${a} 50 50)`} />
          ))}
          {([[28, 31], [72, 33], [31, 68], [70, 70], [50, 23]] as const).map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 2 ? 0.9 : 1.3} fill={i % 2 ? "#bfe3ff" : "#fffef0"} opacity="0.9" />
          ))}
        </g>
      </>
    );
  }

  if (!content) return null;
  return (
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      {content}
    </svg>
  );
}

// Small hover tooltip shown above a badge on PC — name, earned/locked,
// and the description (i.e. how/why the badge was earned).
function BadgeHoverBubble({ badge, earned }: { badge: BadgeDef; earned: boolean }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-44 -translate-x-1/2 rounded-lg border border-gold/50 bg-home-bg px-3 py-2 text-left shadow-xl">
      <p className="text-xs font-semibold text-cream">
        {badge.name}
        <span
          className={
            "ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase " +
            (earned ? "bg-gold/20 text-gold" : "bg-cream/10 text-cream/50")
          }
        >
          {earned ? "Earned" : "Locked"}
        </span>
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-cream/75">
        {badge.description}
      </p>
      {/* little arrow pointing down at the badge */}
      <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-home-bg" />
    </div>
  );
}

// Centered detail popup for one badge (opened by tapping). Shows the
// medallion, name, earned/locked state, and the description.
function BadgeDetailPopup({
  badge,
  earned,
  onClose,
}: {
  badge: BadgeDef;
  earned: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-2xl border-2 border-gold bg-home-bg p-6 text-center text-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Medallion badge={badge} earned={earned} sizeClass="mx-auto h-28 w-28" />
        <h3 className="mt-3 text-lg font-semibold">{badge.name}</h3>
        <span
          className={
            "mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide " +
            (earned ? "bg-gold/20 text-gold" : "bg-cream/10 text-cream/50")
          }
        >
          {earned ? "Earned" : "Locked"}
        </span>
        <p className="mt-3 text-sm leading-relaxed text-cream/80">
          {badge.description}
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// A self-contained interactive badge: medallion + name, with a hover
// tooltip (PC) and a tap-to-open detail popup (phone + PC). Used on the
// game-over screen so players can see why each newly earned badge was
// earned. Defaults to the earned state (badges shown there are earned).
export function BadgeTile({
  badge,
  earned = true,
}: {
  badge: BadgeDef;
  earned?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <div className="relative flex w-20 flex-col items-center gap-1 text-center">
      {hover && !open && <BadgeHoverBubble badge={badge} earned={earned} />}
      <button
        type="button"
        onClick={() => {
          setHover(false);
          setOpen(true);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="flex flex-col items-center gap-1"
      >
        <Medallion badge={badge} earned={earned} sizeClass="h-20 w-20" />
        <span className="text-[11px] leading-tight text-cream/85">
          {badge.name}
        </span>
      </button>
      {open && (
        <BadgeDetailPopup
          badge={badge}
          earned={earned}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function BadgeMedallion({
  badge,
  earned,
  showBubble,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  badge: BadgeDef;
  earned: boolean;
  showBubble: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="relative flex flex-col items-center gap-1.5 text-center"
    >
      {/* Hover bubble (PC) — a little text balloon above the badge. */}
      {showBubble && <BadgeHoverBubble badge={badge} earned={earned} />}
      <Medallion badge={badge} earned={earned} sizeClass="h-20 w-20" showLock />
      <span className="text-[11px] leading-tight text-cream/85">
        {badge.name}
      </span>
    </button>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

// Emoji-free inline icon set. Star is filled; the rest are stroked.
function Icon({ name }: { name: BadgeIcon }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-7 w-7",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "star":
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
          <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" />
        </svg>
      );
    case "trophy":
      return (
        <svg {...common}>
          <path d="M7 4h10v4a5 5 0 01-10 0V4z" />
          <path d="M7 5H4v1a3 3 0 003 3" />
          <path d="M17 5h3v1a3 3 0 01-3 3" />
          <path d="M12 13v4M9 20h6M10 17h4" />
        </svg>
      );
    case "medal":
      return (
        <svg {...common}>
          <path d="M12 3L9 8M12 3l3 5" />
          <circle cx="12" cy="15" r="5" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
        </svg>
      );
    case "skull":
      return (
        <svg {...common}>
          <path d="M5 11a7 7 0 1114 0v3l-2 1v3H7v-3l-2-1z" />
          <circle cx="9" cy="11" r="1.2" fill="currentColor" />
          <circle cx="15" cy="11" r="1.2" fill="currentColor" />
        </svg>
      );
    case "mask":
      return (
        <svg {...common}>
          <path d="M5 4h14v6a7 7 0 01-14 0z" />
          <path d="M9 8h.01M15 8h.01M9.5 12c1 1 4 1 5 0" />
        </svg>
      );
    case "key":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="4" />
          <path d="M11 11l8 8M16 16l2-2" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0116 0" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M4 5h16v10H9l-4 4v-4H4z" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M10 14a4 4 0 010-6l2-2a4 4 0 016 6l-1 1" />
          <path d="M14 10a4 4 0 010 6l-2 2a4 4 0 01-6-6l1-1" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </svg>
      );
  }
}
