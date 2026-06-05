"use client";

import { useState } from "react";
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
export function BadgesShowcase({
  earned,
  founderRank,
}: {
  earned: Set<string>;
  // The viewer's 1-based account rank, so the Founder badge can show "n/19".
  founderRank?: number;
}) {
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
                  founderRank={founderRank}
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
          founderRank={founderRank}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// Per-tier center "window" for the badge icon: an ellipse, as a fraction of
// the square medallion box — center (cx/cy) and width/height (w/h).
//
// Two render modes (see PUNCHED):
//  - PUNCHED tiers (Divine/Noble/Primal) have a transparent field hole cut
//    into the frame PNG. The icon is drawn BEHIND the frame and shows through
//    the hole; the ring + inward gems sit in front and overlap the icon edge.
//    Here the window is sized a touch LARGER than the hole so the icon fully
//    fills it (the frame clips the visible shape to the hole).
//  - Other tiers (Verdant/Earthen) keep a solid frame with the icon drawn ON
//    TOP; the window is the visible icon, sized to each frame's inner field.
const FRAME_WINDOW: Record<
  BadgeTier,
  { cx: number; cy: number; w: number; h: number }
> = {
  divine: { cx: 50, cy: 52.5, w: 42, h: 51 },
  noble: { cx: 50, cy: 55.5, w: 49, h: 57 },
  primal: { cx: 50, cy: 49, w: 56, h: 52 },
  verdant: { cx: 50, cy: 51, w: 46, h: 46 },
  earthen: { cx: 50, cy: 52, w: 56, h: 56 },
};

// Tiers whose frame PNG has a punched-out center: draw the icon behind the
// frame so the ring + cardinal gems render in front of (and slightly over)
// the icon. The rest draw the icon on top of a solid frame.
const PUNCHED: Record<BadgeTier, boolean> = {
  divine: true,
  noble: true,
  primal: true,
  verdant: false,
  earthen: false,
};

// The "coin" behind an inline-glyph badge (badges with no character picture).
// Most tiers use a dark recessed coin with a light-gold glyph; Divine and Noble
// get tier-matched coins (white-and-gold / purple-and-gold) so the glyph fits
// their bright frames. The rim always comes from meta.ring (gold on Noble).
const DEFAULT_GLYPH_COIN = {
  bg: "radial-gradient(circle at 50% 38%, #3c2b18 0%, #1b130a 100%)",
  glyph: "#f1d27a",
  shadow: "inset 0 1px 3px rgba(0,0,0,0.55)",
};
const GLYPH_COIN: Partial<
  Record<BadgeTier, { bg: string; glyph: string; shadow: string }>
> = {
  divine: {
    bg: "radial-gradient(circle at 50% 35%, #fffdf3 0%, #efe1b2 100%)",
    glyph: "#bd8b1c",
    shadow: "inset 0 1px 2px rgba(120,90,20,0.25)",
  },
  noble: {
    bg: "radial-gradient(circle at 50% 38%, #7b4bb0 0%, #38195f 100%)",
    glyph: "#f4d77f",
    shadow: "inset 0 1px 3px rgba(0,0,0,0.45)",
  },
};

// The medallion: a painted per-tier frame (public/badge-frame-<tier>.png)
// with the badge's own icon — role-card art or an inline glyph — set into
// the frame's center window. The frame supplies the whole tier look (border,
// gems, glow); the icon distinguishes the badge within its tier.
export function Medallion({
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
  const win = FRAME_WINDOW[badge.tier];
  const punched = PUNCHED[badge.tier];
  const glyphCoin = GLYPH_COIN[badge.tier] ?? DEFAULT_GLYPH_COIN;
  const windowStyle = {
    left: `${win.cx}%`,
    top: `${win.cy}%`,
    width: `${win.w}%`,
    height: `${win.h}%`,
    transform: "translate(-50%,-50%)",
    borderRadius: "50%",
  } as const;

  // The painted tier frame. For PUNCHED tiers it has a transparent center and
  // is drawn IN FRONT of the icon; otherwise it's a solid frame drawn behind.
  // eslint-disable-next-line @next/next/no-img-element
  const frameImg = (
    <img
      src={`/badge-frame-${badge.tier}.png`}
      alt=""
      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      style={
        earned ? { filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.45))" } : undefined
      }
    />
  );

  // The badge icon (role-card art or inline glyph), set into the center window.
  const iconWindow = (
    <div
      className="absolute flex items-center justify-center overflow-hidden"
      style={windowStyle}
    >
      {badge.roleId ? (
        // Per-role character icon (public/badge-icons/<role>-<tier>.png),
        // pre-tinted to the tier colour and normalized to a uniform square,
        // on a dark recessed backing that fills the centre window — this
        // covers the frame's own centre motif and fills the punched hole so
        // every badge has a consistent background.
        <>
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 38%, #3c2b18 0%, #1b130a 100%)",
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/badge-icons/${badge.roleId}-${badge.tier}.png`}
            alt=""
            className="relative h-full w-full object-contain"
          />
        </>
      ) : (
        // Inline-glyph badges sit on a per-tier coin (see GLYPH_COIN) with a
        // meta.ring rim.
        <span
          className="flex h-full w-full items-center justify-center"
          style={{
            borderRadius: "50%",
            background: glyphCoin.bg,
            border: `1.5px solid ${meta.ring}`,
            color: glyphCoin.glyph,
            boxShadow: glyphCoin.shadow,
          }}
        >
          {badge.glyphText ? (
            <svg viewBox="0 0 24 24" className="h-2/3 w-2/3">
              <text
                x="12"
                y="12.5"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="15"
                fontWeight={800}
                fill="currentColor"
              >
                {badge.glyphText}
              </text>
            </svg>
          ) : (
            <Icon name={badge.icon ?? "medal"} />
          )}
        </span>
      )}
    </div>
  );

  // Lock for locked badges in the grid. Drawn with the icon (so on PUNCHED
  // tiers the frame clips it to the hole too).
  const lockOverlay = showLock && !earned && (
    <span
      className="absolute flex items-center justify-center rounded-full bg-black/55 text-cream"
      style={windowStyle}
    >
      <LockIcon />
    </span>
  );

  return (
    <div
      className={
        "relative shrink-0 " +
        sizeClass +
        (earned ? "" : " opacity-45 grayscale")
      }
    >
      {punched ? (
        // icon (+lock) behind, frame in front: ring & gems overlap the icon
        <>
          {iconWindow}
          {lockOverlay}
          {frameImg}
        </>
      ) : (
        // solid frame behind, icon (+lock) on top
        <>
          {frameImg}
          {iconWindow}
          {lockOverlay}
        </>
      )}
    </div>
  );
}

// The Founder badge shows the viewer's own spot (e.g. "3/19") in its
// description once they've earned it; every other badge uses its static text.
function resolveDescription(badge: BadgeDef, founderRank?: number): string {
  if (badge.id === "first_95" && founderRank && founderRank <= 19) {
    return `One of the first 19 players to create an account — you're ${founderRank}/19.`;
  }
  return badge.description;
}

// Small hover tooltip shown above a badge on PC — name, earned/locked,
// and the description (i.e. how/why the badge was earned).
function BadgeHoverBubble({
  badge,
  earned,
  founderRank,
}: {
  badge: BadgeDef;
  earned: boolean;
  founderRank?: number;
}) {
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
        {resolveDescription(badge, founderRank)}
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
  founderRank,
}: {
  badge: BadgeDef;
  earned: boolean;
  onClose: () => void;
  founderRank?: number;
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
          {resolveDescription(badge, founderRank)}
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
  founderRank,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  badge: BadgeDef;
  earned: boolean;
  showBubble: boolean;
  founderRank?: number;
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
      {showBubble && (
        <BadgeHoverBubble
          badge={badge}
          earned={earned}
          founderRank={founderRank}
        />
      )}
      <Medallion badge={badge} earned={earned} sizeClass="h-20 w-20" showLock />
      <span className="text-[11px] leading-tight text-cream/85">
        {badge.name}
      </span>
    </button>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </svg>
  );
}

// Emoji-free inline icon set. Star is filled; the rest are stroked. Sized at
// 60% of the center window so they scale with the medallion.
function Icon({ name }: { name: BadgeIcon }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-2/3 w-2/3",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "star":
      return (
        <svg viewBox="0 0 24 24" className="h-2/3 w-2/3" fill="currentColor">
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
