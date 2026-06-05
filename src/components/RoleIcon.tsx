// A camp-tinted character icon for a role. The art lives in
// public/role-icons/<role>.png — each role's character head, pre-tinted to
// its camp (vices red, virtues blue) and normalized to a uniform square. It
// sits on a dark recessed disc (so the transparent head reads consistently on
// any background) with a camp-coloured rim. Used for the small role icons in
// the how-to-play guide, game overview, top bar, Certainty reveal and the
// game-over reveal. Size it via className (e.g. "h-8 w-8").

export function RoleIcon({
  roleId,
  camp,
  className = "",
}: {
  roleId: string;
  camp: "vice" | "virtue";
  className?: string;
}) {
  return (
    <span
      className={
        "relative inline-flex shrink-0 overflow-hidden rounded-full border-2 " +
        (camp === "vice" ? "border-consultation-bg" : "border-consultation-fg") +
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
      />
    </span>
  );
}
