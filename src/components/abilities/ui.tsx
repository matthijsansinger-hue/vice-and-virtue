"use client";

/**
 * Shared UI primitives for the role-ability components (Reflection stage).
 * Every ability renders inside an enchanted purple AbilityPanel; queued /
 * result states land on a cream ParchmentCard with a spring entrance; target
 * pickers and mode choosers share the parchment button rows. Logic stays in
 * each ability component — these are presentation only.
 */

import type { ReactNode } from "react";
import { heading, CornerFrame, SoulCost, SoulEnergyText } from "@/components/ui/royal";

// Re-exported so ability components keep a single import site; the card
// itself lives in the royal kit (Result and other screens use it too).
export { ParchmentCard } from "@/components/ui/royal";

// Enchanted plaque wrapper: periwinkle corner brackets + Cinzel kicker.
export function AbilityPanel({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border-2 border-[#7678ed]/40 bg-[#190f2e]/85 p-5 text-cream"
      style={{ boxShadow: "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(118,120,237,.18)" }}
    >
      <CornerFrame colorClass="border-[#7678ed]/60" />
      <p className={`relative text-sm uppercase tracking-widest text-[#a9aaf0] ${heading}`}>
        {title}
      </p>
      <div className="relative">{children}</div>
    </div>
  );
}

// "Soul Energy: N · cost: M" line shown inside an AbilityPanel — both
// numbers in the spectral-cyan SE colour.
export function CostLine({ have, cost }: { have: number; cost?: number }) {
  return (
    <p className="mt-2 text-xs text-cream/60">
      <SoulEnergyText>Soul Energy</SoulEnergyText>: <SoulCost value={have} label="" />
      {cost !== undefined && (
        <>
          {" "}
          &middot; cost: <SoulCost value={cost} label="" />
        </>
      )}
    </p>
  );
}

// Parchment row button shared by target lists and mode choosers. The hover
// lift is a plain CSS transform transition — cheap at any list size.
const rowClass =
  "flex w-full items-center justify-between gap-3 rounded-lg border border-gold bg-cream px-4 py-2.5 text-left text-home-bg shadow-[0_2px_8px_rgba(0,0,0,.25)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,.3)] active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[0_2px_8px_rgba(0,0,0,.25)]";

// Shared target picker: parchment rows; `tag` renders a per-player note
// (e.g. "(in prison)"). Generic so it accepts Player rows or the minimal
// {id, name} shapes some abilities fetch from the server.
export function TargetList<T extends { id: string; name: string }>({
  targets,
  onPick,
  disabled,
  tag,
}: {
  targets: T[];
  onPick: (p: T) => void;
  disabled?: boolean;
  tag?: (p: T) => ReactNode;
}) {
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {targets.map((p) => (
        <li key={p.id}>
          <button onClick={() => onPick(p)} disabled={disabled} className={rowClass}>
            <span className="min-w-0 flex-1 truncate font-medium">
              {p.name}
              {tag?.(p)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Mode-chooser / primary action button with an optional SE-cost chip.
export function AbilityOption({
  onClick,
  disabled,
  cost,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  cost?: number;
  children: ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className={rowClass}>
      <span className="min-w-0 flex-1">{children}</span>
      {cost !== undefined && (
        <span className="flex shrink-0 items-center rounded-full border border-soul-ink/40 bg-soul-ink/10 px-2 py-0.5 text-xs font-bold">
          <SoulCost value={cost} onLight />
        </span>
      )}
    </button>
  );
}

export function BackButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-2 w-full rounded-lg border border-gold/50 px-4 py-2 text-sm text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
    >
      Back
    </button>
  );
}
