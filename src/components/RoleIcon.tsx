// A character icon for a role. The art lives in public/role-icons/<role>.png:
// each role's hand-drawn head in its own colours, on a round camp-coloured
// disc baked into the image (vices red, virtues blue, the neutral anomaly
// teal), transparent outside the circle. It sits in a camp-coloured rim. Used
// for the role icons in the hub Roles tab, how-to-play guide, cast overview,
// top bar, Certainty reveal and the game-over reveal. Size it via className
// (e.g. "h-8 w-8").
//
// A role whose head hasn't been drawn yet falls back to its card art
// (cover-cropped), and a role with neither shows the dark recessed disc.

export function RoleIcon({
  roleId,
  camp,
  className = "",
}: {
  roleId: string;
  camp: "vice" | "virtue" | "neutral";
  className?: string;
}) {
  return (
    <span
      className={
        "relative inline-flex shrink-0 overflow-hidden rounded-full border-2 " +
        // Neutral anomaly (Wandering Soul) gets a spectral cyan rim.
        (camp === "vice" ? "border-consultation-bg" : camp === "virtue" ? "border-consultation-fg" : "border-soul") +
        (className ? " " + className : "")
      }
    >
      {/* Dark recessed disc: shows through only for art without a baked disc
          (the older filler-role heads) or when no art exists at all. */}
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
        onError={(e) => {
          const img = e.currentTarget;
          if (!img.dataset.fallback) {
            img.dataset.fallback = "card";
            img.src = `/cards/${roleId}.png`;
            img.style.objectFit = "cover";
          } else {
            img.style.visibility = "hidden";
          }
        }}
      />
    </span>
  );
}
