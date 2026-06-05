import { BADGES } from "@/lib/badges";
import { Medallion } from "./BadgesShowcase";

// Renders a player's featured badges (up to 2) as small medallions, shown
// next to their name in the lobby and at game over. Unknown ids are ignored;
// renders nothing when there are no featured badges (e.g. guests).
export function ShowcaseBadges({
  ids,
  sizeClass = "h-7 w-7",
  className = "",
}: {
  ids: string[] | null | undefined;
  sizeClass?: string;
  className?: string;
}) {
  const badges = (ids ?? [])
    .map((id) => BADGES.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .slice(0, 2);
  if (badges.length === 0) return null;
  return (
    <span className={"inline-flex shrink-0 items-center gap-0.5 " + className}>
      {badges.map((b) => (
        <Medallion key={b.id} badge={b} earned sizeClass={sizeClass} />
      ))}
    </span>
  );
}
