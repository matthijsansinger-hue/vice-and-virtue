"use client";

import {
  BADGES_BY_TIER,
  TIER_META,
  TIER_ORDER,
  type BadgeDef,
  type BadgeIcon,
} from "@/lib/badges";

// Renders every badge grouped by tier (Divine → Earthen). Earned badges
// glow in their tier's theme; locked ones are dimmed but still shown as
// goals, with the requirement in the tooltip.
export function BadgesShowcase({ earned }: { earned: Set<string> }) {
  const totalEarned = earned.size;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gold">Badges</h2>
        <span className="text-sm text-cream/60">{totalEarned} earned</span>
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
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BadgeMedallion({
  badge,
  earned,
}: {
  badge: BadgeDef;
  earned: boolean;
}) {
  const meta = TIER_META[badge.tier];
  return (
    <div
      title={`${badge.name} — ${badge.description}${earned ? "" : " (locked)"}`}
      className="flex flex-col items-center gap-1.5 text-center"
    >
      <div
        className={
          "relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 transition " +
          (earned ? "" : "opacity-40 grayscale")
        }
        style={{
          background: meta.gradient,
          borderColor: meta.ring,
          boxShadow: earned ? meta.glow : undefined,
          color: meta.text,
        }}
      >
        {badge.roleId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/cards/${badge.roleId}.png`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <Icon name={badge.icon ?? "medal"} />
        )}
        {!earned && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-cream">
            <LockIcon />
          </span>
        )}
      </div>
      <span className="text-[11px] leading-tight text-cream/85">
        {badge.name}
      </span>
    </div>
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
