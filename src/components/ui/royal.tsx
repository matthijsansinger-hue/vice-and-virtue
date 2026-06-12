"use client";

/**
 * Shared "royal" UI kit — the visual language established by the hub
 * redesign (src/app/page.tsx): Cinzel display type, gold-leaf plaques,
 * corner brackets, entrance stagger/fade variants, and sliding-gold
 * segmented toggles. Import from here instead of re-declaring per page
 * so every screen stays on the same wood/gold/candlelight base.
 */

import type { CSSProperties, ReactNode } from "react";
import { Cinzel } from "next/font/google";
import { motion, type Variants } from "framer-motion";
import { SoulEnergyIcon } from "@/components/CurrencyIcons";

// The Soul Energy flame, sized to sit inline in a line of text — it now
// stands in for the "SE" abbreviation everywhere the currency is mentioned.
export function SoulFlame({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <SoulEnergyIcon size={size} className={`inline-block shrink-0 align-[-0.15em] ${className}`} />;
}

const SOUL_GLOW = { textShadow: "0 0 10px rgba(125,224,240,.45)" } as const;

// Rustic/royal display face for headings, nav labels, and HUD numbers —
// pairs with the carved-serif "VICE & VIRTUE" wordmark. Body copy stays
// in the default sans for readability.
const cinzel = Cinzel({ subsets: ["latin"], weight: ["500", "600", "700"] });
export const heading = cinzel.className;

// Shared entrance-animation variants: a stagger container plus a
// fade/rise applied to each direct "section" inside it. Pages must wrap
// their tree in <MotionConfig reducedMotion="user"> so the y-translate
// degrades to a plain opacity fade for reduced-motion users.
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

// Four gold corner brackets — gives a card an ornate, framed-plaque look
// instead of a plain rectangle border. `colorClass` overrides the bracket
// colour for stage-accented screens (e.g. border-reflection-fg/60 on the
// purple Reflection phases).
export function CornerFrame({ accent, colorClass }: { accent?: boolean; colorClass?: string }) {
  const color = colorClass ?? (accent ? "border-gold/65" : "border-gold/40");
  const corner = `pointer-events-none absolute h-4 w-4 ${color}`;
  return (
    <>
      <span className={`${corner} left-2 top-2 border-l-2 border-t-2`} aria-hidden />
      <span className={`${corner} right-2 top-2 border-r-2 border-t-2`} aria-hidden />
      <span className={`${corner} left-2 bottom-2 border-l-2 border-b-2`} aria-hidden />
      <span className={`${corner} right-2 bottom-2 border-r-2 border-b-2`} aria-hidden />
    </>
  );
}

// Brown-gradient plaque fill + drop shadow (the Play-card material).
// Apply via the style prop on a `relative overflow-hidden` container.
export function plaqueStyle(accent?: boolean): CSSProperties {
  return {
    background: accent
      ? "linear-gradient(160deg, #6b4d28 0%, #3f2c19 60%, #271a0e 100%)"
      : "linear-gradient(160deg, #4a341f 0%, #2e2010 65%, #21150a 100%)",
    boxShadow: accent
      ? "0 8px 24px rgba(0,0,0,.4), inset 0 0 0 1px rgba(227,181,16,.15)"
      : "0 6px 18px rgba(0,0,0,.35)",
  };
}

// The plaque's texture layers: a faint wood-grain overlay plus (optionally)
// the diagonal shine sweep that fires on `.group:hover`. Render as the first
// children of a `group relative overflow-hidden` plaque; all sibling content
// needs `relative` so it stacks above these absolute layers.
export function PlaqueLayers({ shine }: { shine?: boolean }) {
  return (
    <>
      <span
        className="pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-overlay"
        style={{ backgroundImage: "url('/wood-cartoon.jpg')", backgroundSize: "cover", backgroundPosition: "center" }}
        aria-hidden
      />
      {shine && <span className="play-card-shine pointer-events-none absolute inset-0" aria-hidden />}
    </>
  );
}

// Cream parchment card with gold trim, corner brackets, and a one-shot
// spring scale-in — for payoff moments (ability results, queued
// confirmations, scoreboard highlights). `center` centres the content.
export function ParchmentCard({
  kicker,
  center,
  children,
}: {
  kicker: ReactNode;
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={`relative overflow-hidden rounded-xl border-2 border-gold/70 p-5 text-home-bg shadow-[0_6px_18px_rgba(0,0,0,.35)] ${
        center ? "text-center" : ""
      }`}
      style={{ background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
    >
      <CornerFrame colorClass="border-home-bg/25" />
      <p className={`relative text-sm uppercase tracking-widest text-home-bg/60 ${heading}`}>
        {kicker}
      </p>
      <div className="relative">{children}</div>
    </motion.div>
  );
}

// Soul Energy amount — the in-match currency reads spectral cyan everywhere
// (token --color-soul). The "SE" unit now renders as the blue Soul Energy
// flame; pass label="" for a bare number (when surrounding prose already
// names the currency), or a custom string to keep text. On light parchment
// surfaces pass `onLight` to switch to the darker ink variant for contrast.
export function SoulCost({
  value,
  label = "SE",
  onLight = false,
  className = "",
}: {
  value: number | string;
  label?: string;
  onLight?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`font-semibold ${onLight ? "text-soul-ink" : "text-soul"} ${className}`}
      style={onLight ? undefined : SOUL_GLOW}
    >
      {value}
      {label === "SE" ? <> <SoulFlame /></> : label ? <> {label}</> : null}
    </span>
  );
}

// Renders a text string with every Soul Energy mention marked up: the words
// "Soul Energy" read spectral-cyan with a trailing blue flame, and the "SE"
// abbreviation is replaced outright by the flame glyph (so "150 SE" becomes
// "150 🔥"). Used wherever the currency appears in prose — role descriptions,
// ability lines, cost chips, tips. Non-matching text renders unchanged. Pass
// `onLight` on parchment surfaces for the darker ink variant.
const SOUL_SPLIT = /(Soul Energy|\bSE\b)/g;
const SOUL_TEST = /Soul Energy|\bSE\b/;
export function SoulEnergyText({
  children,
  onLight = false,
}: {
  children: string;
  onLight?: boolean;
}) {
  if (!SOUL_TEST.test(children)) return <>{children}</>;
  return (
    <>
      {children.split(SOUL_SPLIT).map((part, i) => {
        if (part === "Soul Energy")
          return (
            <span
              key={i}
              className={`font-semibold ${onLight ? "text-soul-ink" : "text-soul"}`}
              style={onLight ? undefined : SOUL_GLOW}
            >
              {part}
              <SoulFlame className="ml-0.5" />
            </span>
          );
        if (part === "SE") return <SoulFlame key={i} />;
        return part;
      })}
    </>
  );
}

// Centered "state" plaque for passive screens (dead / hospital / prison /
// done-waiting): a dark panel with corner brackets, an accent border/glow
// (rgb triplet, e.g. "227,181,16" for gold), and a one-shot fade-up entrance.
// `pulse` adds the breathing gold glow for waiting states. `bg` can override
// the fill on non-purple stages.
export function StatePanel({
  accentRgb = "118,120,237",
  pulse = false,
  bg = "rgba(20,12,40,.85)",
  children,
}: {
  accentRgb?: string;
  pulse?: boolean;
  bg?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={`relative w-full max-w-sm overflow-hidden rounded-xl border-2 p-6 text-center ${
        pulse ? "glow-gold-pulse" : ""
      }`}
      style={{
        borderColor: `rgba(${accentRgb},.5)`,
        background: bg,
        boxShadow: `0 6px 18px rgba(0,0,0,.4), 0 0 16px rgba(${accentRgb},.25)`,
      }}
    >
      <CornerFrame colorClass="border-cream/25" />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

// Big phase countdown — Cinzel numerals with a stage-accent text glow that
// switches to a red transform-only heartbeat (.timer-urgent) in the final
// seconds. `glow` is the calm-state text-shadow colour (use the stage accent,
// e.g. periwinkle on Reflection screens).
export function PhaseTimer({
  seconds,
  urgentAt = 10,
  glow = "rgba(118,120,237,.55)",
  onLight = false,
  className = "",
}: {
  seconds: number;
  urgentAt?: number;
  glow?: string;
  // Light-stage variant (e.g. the olive Action courtyard): dark numerals
  // with a soft white lift instead of cream-on-dark with a colour glow.
  onLight?: boolean;
  className?: string;
}) {
  const urgent = seconds <= urgentAt;
  const calmText = onLight ? "text-outreach-outline" : "text-cream";
  const urgentText = onLight ? "timer-urgent text-red-700" : "timer-urgent text-red-300";
  return (
    <p
      className={`mx-auto w-fit text-5xl font-bold tabular-nums ${heading} ${
        urgent ? urgentText : calmText
      } ${className}`}
      style={{
        textShadow: urgent
          ? onLight
            ? "0 0 14px rgba(220,38,38,.35)"
            : "0 0 18px rgba(248,113,113,.6)"
          : onLight
            ? "0 0 18px rgba(255,255,255,.55)"
            : `0 0 24px ${glow}`,
      }}
    >
      {seconds}
      <span
        className={
          "text-2xl " +
          (urgent
            ? onLight
              ? "text-red-700/70"
              : "text-red-300/70"
            : onLight
              ? "text-outreach-outline/60"
              : "text-cream/60")
        }
      >
        s
      </span>
    </p>
  );
}

// Segmented toggle with a sliding gold "plaque" indicator (the hub nav's
// layoutId spring). `layoutId` must be unique per toggle instance on the page.
export function SlidingToggle<T extends string>({
  value,
  options,
  onChange,
  disabled,
  layoutId,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  layoutId: string;
}) {
  return (
    <div className="relative flex rounded-lg border border-gold/40 bg-black/25 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          disabled={disabled}
          aria-pressed={value === o.value}
          className={`relative flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
            value === o.value ? "text-home-bg" : "text-cream/70 hover:text-cream"
          }`}
        >
          {value === o.value && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-md bg-gold shadow-[0_0_12px_rgba(227,181,16,.4)]"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
              aria-hidden
            />
          )}
          <span className="relative z-10">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
