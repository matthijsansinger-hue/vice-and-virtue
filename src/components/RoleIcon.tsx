// A camp-tinted character icon for a role. The art lives in
// public/role-icons/<role>.png — each role's character head, pre-tinted to
// its camp (vices red, virtues blue) and normalized to a uniform square. It
// sits on a dark recessed disc (so the transparent head reads consistently on
// any background) with a camp-coloured rim. Used for the small role icons in
// the how-to-play guide, game overview, top bar, Certainty reveal and the
// game-over reveal. Size it via className (e.g. "h-8 w-8").

import { ROLES, roleArtVariant } from "@/lib/roles";

// Roles without a dedicated /role-icons/ head (the 8 unlockable roles) fall back
// to their tier-tinted badge-icon — a clean character head that exists for every
// role — keyed by the role's tier, then to the card art as a last resort.
const TIER_BADGE: Record<string, string> = {
  S: "divine", A: "noble", B: "primal", C: "verdant", D: "earthen",
};

// When `tint` is set, the HEAD image (only — the brown disc stays brown) is
// recoloured to its camp via a grayscale→sepia→hue-rotate CSS filter, so every
// role reads its camp regardless of the source art's own tint. Tuned to the
// game's deep camp colours (consultation-bg #800020 burgundy vice / consultation-fg
// #000080 navy virtue) — the same reds/blues shown when the cast is revealed.
// Applied to the img, so transparent areas keep showing the disc.
const TINT_FILTER: Record<string, string> = {
  vice: "grayscale(1) sepia(1) saturate(6.5) hue-rotate(-53deg) brightness(0.6)",
  virtue: "grayscale(1) sepia(1) saturate(6) hue-rotate(202deg) brightness(0.55)",
};

export function RoleIcon({
  roleId,
  camp,
  className = "",
  tint = false,
}: {
  roleId: string;
  camp: "vice" | "virtue" | "neutral";
  className?: string;
  tint?: boolean; // recolour the head to its camp colour (red vice / blue virtue)
}) {
  const filter = tint ? TINT_FILTER[camp] : undefined; // undefined for neutral
  return (
    <span
      className={
        "relative inline-flex shrink-0 overflow-hidden rounded-full border-2 " +
        // Neutral anomaly (Wandering Soul) gets a spectral cyan rim.
        (camp === "vice" ? "border-consultation-bg" : camp === "virtue" ? "border-consultation-fg" : "border-soul") +
        (className ? " " + className : "")
      }
    >
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
        src={`/role-icons/${roleId}.png`}
        alt=""
        className="relative h-full w-full object-contain"
        style={filter ? { filter } : undefined}
        // No dedicated head icon (the 8 unlockable roles): fall back to the
        // tier-tinted badge-icon head, then to the card art, instead of a broken
        // img. The camp filter (if any) stays applied across the fallback.
        onError={(e) => {
          const img = e.currentTarget;
          const step = img.dataset.fallback;
          const def = ROLES[roleId];
          const badge = def ? roleArtVariant(def) : null;
          if (!step && badge) {
            img.dataset.fallback = "badge";
            img.src = `/badge-icons/${roleId}-${badge}.png`;
          } else if (step !== "card") {
            img.dataset.fallback = "card";
            img.src = `/cards/${roleId}.png`;
            img.style.objectFit = "cover";
          }
        }}
      />
    </span>
  );
}
