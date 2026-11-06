"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GameColor } from "@/lib/gameColors";

// Names in the court are shown as small banners in each player's colour for
// this game (lib/gameColors — the same colours as Outreach), so you can tell
// at a glance who did what.
type Names = { nameOf: (id: string) => string; colorOf: (id: string) => GameColor | undefined };

const Ctx = createContext<Names>({ nameOf: () => "someone", colorOf: () => undefined });

export function CourtNamesProvider({ value, children }: { value: Names; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCourtNames() {
  return useContext(Ctx);
}

export function Name({ id, small = false, suffix }: { id: string | null | undefined; small?: boolean; suffix?: ReactNode }) {
  const { nameOf, colorOf } = useContext(Ctx);
  if (!id) return null;
  const c = colorOf(id);
  return (
    <span
      title={c?.label}
      className={
        "inline-flex max-w-full items-center gap-1 truncate rounded-md border border-black/15 font-semibold align-middle shadow-[0_1px_2px_rgba(0,0,0,.2)] " +
        (small ? "px-1.5 py-0 text-[11px] leading-5 " : "px-2 py-0.5 text-sm ") +
        (c?.lightText ? "text-white" : "text-[#1c140c]")
      }
      style={{ background: c?.background ?? "#e9dcb5" }}
    >
      <span className="truncate">{nameOf(id)}</span>
      {suffix}
    </span>
  );
}

// The beige paper used for cards throughout the game.
export const PAPER = "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)";
