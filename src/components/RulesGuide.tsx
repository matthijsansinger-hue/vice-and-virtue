"use client";

import { useState } from "react";
import { ROLES, isPlayableRole, type RoleDef } from "@/lib/roles";
import { Walkthrough } from "./Walkthrough";
import { RoleIcon } from "./RoleIcon";
import { SoulEnergyText } from "@/components/ui/royal";

// Concise phase blurbs — pulled from PROJECT.md but written for
// first-time players rather than developers.
const PHASES = [
  {
    title: "Reflection",
    blurb:
      "First use your role's ability secretly (30s). Then a 95s minigame: tag each other player as Vice or Virtue to earn Soul Energy.",
  },
  {
    title: "Outreach",
    blurb:
      "Private one-on-one chats with anyone you choose (120s). Build alliances, plant lies. The host can switch this phase off.",
  },
  {
    title: "Consultation",
    blurb:
      "An optional camp power, group debate, then a vote to send someone to prison (95s).",
  },
];

const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

// Fullscreen rules overlay shown from the home page when the player
// taps "How to play?". Covers: the camps + win condition, the day
// cycle (3 phases that repeat), Soul Energy, and every role with a
// tap-to-expand description.
export function RulesGuide({ onClose }: { onClose: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Roles sorted Vice first, then by tier S → A → B → C → D, then
  // alphabetically — same convention as the in-game Game Overview.
  const allRoles: RoleDef[] = Object.values(ROLES)
    .filter((r) => isPlayableRole(r.id))
    .sort((a, b) => {
    if (a.camp !== b.camp) return a.camp === "vice" ? -1 : 1;
    const t = (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
    if (t !== 0) return t;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="wood-desk-startscreen fixed inset-0 z-50 overflow-y-auto">
      <div className="relative mx-auto w-full max-w-md px-5 py-10 text-cream">
        {/* Close button (sticky at the top-right of the scroll area). */}
        <button
          onClick={onClose}
          aria-label="Close rules"
          className="absolute right-4 top-4 rounded-lg border border-gold/60 bg-home-bg/60 px-3 py-1 text-sm font-semibold text-cream backdrop-blur transition-colors hover:bg-cream/10"
        >
          Close
        </button>

        <h1 className="text-center text-3xl font-semibold text-gold">
          How to play
        </h1>

        <p className="mt-4 text-center text-sm leading-relaxed text-cream/85">
          Every player gets a secret role from one of two camps:{" "}
          <strong>Vice</strong> or <strong>Virtue</strong>. Use your
          ability, deceive the others, and vote to imprison your enemies.
          The last camp with active players wins.
        </p>

        {/* Swipeable walkthrough of a full day cycle */}
        <div className="mt-6">
          <Walkthrough />
        </div>

        {/* The day cycle */}
        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">
            The day cycle
          </h2>
          <p className="mt-1 text-xs text-cream/60">
            Each in-game day moves through these three phases, then loops.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {PHASES.map((p) => (
              <li
                key={p.title}
                className="rounded-lg border border-gold/40 bg-cream/10 p-3"
              >
                <p className="text-sm font-semibold text-gold">{p.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-cream/85">
                  <SoulEnergyText>{p.blurb}</SoulEnergyText>
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Good to know */}
        <section className="mt-8 grid grid-cols-1 gap-2">
          <div className="rounded-lg border border-gold/40 bg-cream/10 p-3">
            <p className="text-sm font-semibold text-soul" style={{ textShadow: "0 0 10px rgba(125,224,240,.45)" }}>Soul Energy</p>
            <p className="mt-1 text-xs leading-relaxed text-cream/85">
              The currency that fuels every ability. Everyone starts with
              100; the minigame awards more each day based on your finishing
              rank. Spend it on your role&rsquo;s power during Reflection.
            </p>
          </div>
          <div className="rounded-lg border border-gold/40 bg-cream/10 p-3">
            <p className="text-sm font-semibold text-gold">The minigame</p>
            <p className="mt-1 text-xs leading-relaxed text-cream/85">
              Tag every other player as Vice, Virtue, or &ldquo;?&rdquo;.
              Correct tags score the most; &ldquo;?&rdquo; scores a little
              and is always safe. But a single <strong>wrong</strong>{" "}
              Vice/Virtue tag zeroes your whole score for that round &mdash;
              so only commit when you&rsquo;re sure, and leave the rest as
              &ldquo;?&rdquo;.
            </p>
          </div>
          <div className="rounded-lg border border-gold/40 bg-cream/10 p-3">
            <p className="text-sm font-semibold text-gold">
              Camp powers (before the vote)
            </p>
            <p className="mt-1 text-xs leading-relaxed text-cream/85">
              Once per game, the <strong>Vices</strong> can open the{" "}
              <strong>Revealing Eye</strong> (shows how many of each camp are
              still active), and the <strong>Virtues</strong> can{" "}
              <strong>free a prisoner</strong>. Each is decided by a majority
              within that camp, at the start of the Consultation.
            </p>
          </div>
          <div className="rounded-lg border border-gold/40 bg-cream/10 p-3">
            <p className="text-sm font-semibold text-gold">Player states</p>
            <p className="mt-1 text-xs leading-relaxed text-cream/85">
              <strong>Active</strong> &mdash; play normally.{" "}
              <strong>Hospital</strong> &mdash; skip one day, then recover.{" "}
              <strong>Prison</strong> &mdash; out of play, but the Virtues can
              free you. <strong>Dead</strong> &mdash; gone for good, but you
              can still watch and chat with the other dead.
            </p>
          </div>
          <div className="rounded-lg border border-gold/40 bg-cream/10 p-3">
            <p className="text-sm font-semibold text-gold">Winning</p>
            <p className="mt-1 text-xs leading-relaxed text-cream/85">
              When every player of the other camp is dead or imprisoned,
              your camp wins.
            </p>
          </div>
        </section>

        {/* Roles */}
        <section className="mt-8 mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">
            Roles
          </h2>
          <p className="mt-1 text-xs text-cream/60">
            12 roles total. Tap one to read the details.
          </p>

          <ul className="mt-3 flex flex-col gap-2">
            {allRoles.map((role) => {
              const isOpen = expandedId === role.id;
              const isVice = role.camp === "vice";
              return (
                <li key={role.id}>
                  <button
                    onClick={() =>
                      setExpandedId(isOpen ? null : role.id)
                    }
                    className="flex w-full items-center gap-3 rounded-lg border border-gold/40 bg-cream px-3 py-2 text-left text-home-bg transition-colors hover:bg-cream/90"
                  >
                    <RoleIcon
                      roleId={role.id}
                      camp={role.camp}
                      className="h-8 w-8"
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">
                        {role.name}
                      </span>
                      <span className="block text-xs text-home-bg/60">
                        {isVice ? "Vice" : "Virtue"} &middot; Tier{" "}
                        {role.tier} &middot; <SoulEnergyText onLight>{role.cost}</SoulEnergyText>
                      </span>
                    </span>
                    <span className="text-xs text-home-bg/40">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-1 rounded-lg border border-gold/30 bg-cream/10 p-3 text-xs leading-relaxed text-cream/90">
                      <p className="font-semibold text-cream">
                        Ability (<SoulEnergyText>{role.cost}</SoulEnergyText>)
                      </p>
                      <p className="mt-1"><SoulEnergyText>{role.ability}</SoulEnergyText></p>
                      <p className="mt-2 text-cream/70">
                        <SoulEnergyText>{role.description}</SoulEnergyText>
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
