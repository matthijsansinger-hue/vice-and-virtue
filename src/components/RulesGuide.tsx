"use client";

import { Fragment, useState } from "react";
import { ROLES, type RoleDef } from "@/lib/roles";
import { Walkthrough } from "./Walkthrough";
import { RoleIcon } from "./RoleIcon";
import { SoulEnergyText } from "@/components/ui/royal";

// Terse phase labels for the horizontal day-cycle strip (the slideshow carries
// the detail).
const PHASES = [
  { title: "Reflection", blurb: "Your role's power, then the Quiz." },
  { title: "Action", blurb: "Outreach chats, then the Market." },
  { title: "Consultation", blurb: "Debate, then vote to imprison." },
];

const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

// A single tap-to-expand role entry, shared by the Vice / Virtue columns and the
// Anomaly section. `tint` washes the head in its camp colour (red vice / blue
// virtue) so every role reads its camp regardless of the source art.
function RoleEntry({
  role,
  isOpen,
  onToggle,
  accent = "gold",
}: {
  role: RoleDef;
  isOpen: boolean;
  onToggle: () => void;
  accent?: "gold" | "soul";
}) {
  const isNeutral = role.camp === "neutral";
  const sub = isNeutral ? "Neutral · Anomaly" : role.camp === "vice" ? "Vice" : "Virtue";
  return (
    <li>
      <button
        onClick={onToggle}
        className={
          "flex w-full items-center gap-3 rounded-lg border bg-cream px-3 py-2 text-left text-home-bg transition-colors hover:bg-cream/90 " +
          (accent === "soul" ? "border-soul/50" : "border-gold/40")
        }
      >
        <RoleIcon roleId={role.id} camp={role.camp} tint={!isNeutral} className="h-8 w-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{role.name}</span>
          <span className="block text-xs text-home-bg/60">
            {sub}
            {!isNeutral && <> &middot; Tier {role.tier}</>} &middot;{" "}
            <SoulEnergyText onLight>{role.cost}</SoulEnergyText>
          </span>
        </span>
        <span className="text-xs text-home-bg/40">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && (
        <div
          className={
            "mt-1 rounded-lg border bg-cream/10 p-3 text-xs leading-relaxed text-cream/90 " +
            (accent === "soul" ? "border-soul/30" : "border-gold/30")
          }
        >
          <p className="font-semibold text-cream">
            Ability (<SoulEnergyText>{role.cost}</SoulEnergyText>)
          </p>
          <p className="mt-1"><SoulEnergyText>{role.ability}</SoulEnergyText></p>
          <p className="mt-2 text-cream/70"><SoulEnergyText>{role.description}</SoulEnergyText></p>
        </div>
      )}
    </li>
  );
}

// Reusable "good to know" card.
function InfoCard({ title, soul, children }: { title: string; soul?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gold/40 bg-cream/10 p-3">
      <p
        className={"text-sm font-semibold " + (soul ? "text-soul" : "text-gold")}
        style={soul ? { textShadow: "0 0 10px rgba(125,224,240,.45)" } : undefined}
      >
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-cream/85">{children}</p>
    </div>
  );
}

// Fullscreen rules overlay shown from the home page when the player taps "How to
// play?". On phones it's a single scrolling column; on desktop it spreads across
// the screen — the explanation on the LEFT, the Vice / Virtue role rosters
// (sorted by tier) on the RIGHT, and the day cycle as a horizontal arrow strip
// along the bottom (so the two columns end on an even line).
export function RulesGuide({ onClose }: { onClose: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

  const allRoles: RoleDef[] = Object.values(ROLES)
    .filter((r) => !r.anomaly)
    .sort((a, b) => {
      const t = (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99);
      if (t !== 0) return t;
      return a.name.localeCompare(b.name);
    });
  const vices = allRoles.filter((r) => r.camp === "vice");
  const virtues = allRoles.filter((r) => r.camp === "virtue");
  const soul = ROLES["wandering_soul"];

  return (
    <div className="wood-desk-startscreen fixed inset-0 z-50 overflow-y-auto">
      <div className="relative mx-auto w-full max-w-md px-5 py-10 text-cream lg:max-w-6xl">
        <button
          onClick={onClose}
          aria-label="Close rules"
          className="absolute right-4 top-4 z-10 rounded-lg border border-gold/60 bg-home-bg/60 px-3 py-1 text-sm font-semibold text-cream backdrop-blur transition-colors hover:bg-cream/10"
        >
          Close
        </button>

        <h1 className="text-center text-3xl font-semibold text-gold">How to play</h1>

        <div className="mt-6 flex flex-col gap-8 lg:grid lg:grid-cols-[25rem_1fr] lg:items-start lg:gap-10">
          {/* LEFT — the explanation: slideshow, the day cycle, then a compact
              reference (Soul Energy + Quiz, and Market beside the states/winning). */}
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-cream/85">
              Every player gets a secret role from one of two camps:{" "}
              <strong>Vice</strong> or <strong>Virtue</strong>. Use your ability,
              deceive the others, and vote to imprison your enemies. The last camp
              with active players wins.
            </p>

            <Walkthrough />

            <InfoCard title="Soul Energy" soul>
              The currency that fuels every ability. Everyone starts with 100; the
              Quiz awards more each day based on your finishing place, and the
              Market hands everyone +50 when it opens. Spend it on your
              role&rsquo;s power and in the Market.
            </InfoCard>
            <InfoCard title="The Quiz">
              Tag every other player as Vice, Virtue, or &ldquo;?&rdquo;. Correct
              tags score the most; &ldquo;?&rdquo; scores a little and is always
              safe. But a single <strong>wrong</strong> Vice/Virtue tag zeroes your
              whole score for that round &mdash; so only commit when you&rsquo;re
              sure. Speed doesn&rsquo;t matter, and tied scores earn the same Soul
              Energy.
            </InfoCard>
            {/* Market beside the player-states + winning stack — compact, so the
                column ends near the role rosters (no dead space). */}
            <div className="grid grid-cols-2 gap-3">
              <InfoCard title="The Market">
                In the Action phase, spend Soul Energy on single-use potions. The{" "}
                <strong>Revealing Eye</strong> (150) shows how many of each camp
                remain, and anyone can chip in <strong>100 toward freeing a
                prisoner</strong> &mdash; 500 sets them loose.
              </InfoCard>
              <div className="flex flex-col gap-3">
                <InfoCard title="Player states">
                  <strong>Active</strong> &mdash; play normally.{" "}
                  <strong>Hospital</strong> &mdash; skip a day.{" "}
                  <strong>Prison</strong> &mdash; out, but fundable for release.{" "}
                  <strong>Dead</strong> &mdash; gone, but you can watch + chat.
                </InfoCard>
                <InfoCard title="Winning">
                  When every player of the other camp is dead or imprisoned, your
                  camp wins.
                </InfoCard>
              </div>
            </div>
          </div>

          {/* RIGHT — the role rosters, Vice + Virtue, sorted by tier. */}
          <div className="lg:pt-1">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">
              Roles
            </h2>
            <p className="mt-1 text-xs text-cream/60">
              {allRoles.length} roles total. Tap one to read the details.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-[#e6889a]">
                  Vices
                </h3>
                <ul className="flex flex-col gap-2">
                  {vices.map((role) => (
                    <RoleEntry key={role.id} role={role} isOpen={expandedId === role.id} onToggle={() => toggle(role.id)} />
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-[#9a9ce0]">
                  Virtues
                </h3>
                <ul className="flex flex-col gap-2">
                  {virtues.map((role) => (
                    <RoleEntry key={role.id} role={role} isOpen={expandedId === role.id} onToggle={() => toggle(role.id)} />
                  ))}
                </ul>
              </div>
            </div>

            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-soul">
                Anomaly
              </h3>
              <p className="mt-1 text-xs text-cream/60">
                A rare neutral role that appears only when the player count is odd.
              </p>
              <ul className="mt-2">
                <RoleEntry role={soul} isOpen={expandedId === soul.id} onToggle={() => toggle(soul.id)} accent="soul" />
              </ul>
            </section>

            {/* The day cycle — under the anomaly, across the wide right column,
                so the left column's reference cards can sit higher. */}
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gold">
                The day cycle
              </h3>
              <p className="mt-1 text-xs text-cream/60">
                Each in-game day runs these three phases in order, then loops.
              </p>
              <div className="mt-2.5 flex items-stretch gap-2">
                {PHASES.map((p, i) => (
                  <Fragment key={p.title}>
                    <div className="flex-1 rounded-lg border border-gold/40 bg-cream/10 p-2.5 text-center">
                      <p className="text-sm font-semibold text-gold">{p.title}</p>
                      <p className="mt-0.5 text-[11px] leading-tight text-cream/80">{p.blurb}</p>
                    </div>
                    {i < PHASES.length - 1 && (
                      <div className="flex shrink-0 items-center text-xl text-gold/70" aria-hidden>→</div>
                    )}
                  </Fragment>
                ))}
                <div className="flex shrink-0 items-center text-xl text-gold/60" aria-hidden>↻</div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
