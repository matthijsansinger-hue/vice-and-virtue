import Image from "next/image";
import type { RoleDef } from "@/lib/roles";
import { SoulEnergyText } from "@/components/ui/royal";

// The role-reveal card a player sees when the game starts. The
// illustrated card art lives in /public/cards/<role-id>.png and
// already includes the role name + tier + tagline, so the text below
// it focuses on the mechanical description.
export function RoleCard({ role }: { role: RoleDef }) {
  const isVice = role.camp === "vice";
  const isNeutral = role.camp === "neutral";

  return (
    <div className="w-full max-w-sm rounded-2xl border-2 border-gold bg-cream p-4 text-home-bg">
      <p className="text-center text-xs uppercase tracking-widest text-home-bg/50">
        Your role
      </p>

      <div className="mt-3 overflow-hidden rounded-xl">
        <Image
          src={`/cards/${role.id}.png`}
          alt={`${role.name} card`}
          width={425}
          height={600}
          priority
          className="h-auto w-full"
        />
      </div>

      <div className="mt-4 flex items-center justify-center">
        {isNeutral ? (
          <span className="rounded bg-soul px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#06363f]">
            Anomaly &middot; Neutral
          </span>
        ) : (
          <span
            className={
              "rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cream " +
              (isVice ? "bg-consultation-bg" : "bg-consultation-fg")
            }
          >
            {isVice ? "Vice" : "Virtue"}
          </span>
        )}
      </div>

      <p className="mt-3 text-center text-sm font-semibold text-home-bg/80">
        {isNeutral
          ? "You win by escaping — name every living player's camp to break free and end the game."
          : `Your camp wins when every ${isVice ? "Virtue" : "Vice"} is imprisoned or dead.`}
      </p>

      <p className="mt-4 text-center text-sm leading-relaxed">
        <SoulEnergyText onLight>{role.description}</SoulEnergyText>
      </p>
    </div>
  );
}
