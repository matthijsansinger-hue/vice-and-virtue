import type { RoleDef } from "@/lib/roles";

// The role-reveal card a player sees when the game starts.
export function RoleCard({ role }: { role: RoleDef }) {
  const isVice = role.camp === "vice";

  return (
    <div className="w-full max-w-sm rounded-2xl border-2 border-gold bg-cream p-6 text-home-bg">
      <p className="text-center text-xs uppercase tracking-widest text-home-bg/50">
        Your role
      </p>

      <h1 className="mt-3 text-center text-4xl font-semibold">{role.name}</h1>

      <div className="mt-3 flex items-center justify-center">
        <span
          className={
            "rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cream " +
            (isVice ? "bg-consultation-bg" : "bg-consultation-fg")
          }
        >
          {isVice ? "Vice" : "Virtue"}
        </span>
      </div>

      <p className="mt-5 text-center text-sm leading-relaxed">
        {role.description}
      </p>

      <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-home-bg/40">
        Tier {role.tier}
      </p>
    </div>
  );
}
