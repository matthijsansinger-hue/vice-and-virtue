"use client";

// Soul Fragment opening cinematic — a full-screen lootbox reveal, RESPONSIVE:
// a portrait 1080×1920 stage on mobile, a landscape 1920×1080 stage on desktop
// (the two Claude Design handoffs). Ported faithfully; rarity is data — it only
// swaps the colour wash, particles, glow, and reward. The shard, shatter, and
// whiteout are identical for every tier.
//
// A full-window Backdrop sits behind the centred stage (so wide screens aren't
// black around the canvas) and crossfades to the rarity wash on reveal. Divine's
// wash is bright, so it carries an `ink` colour for dark text.
//
// Every open is driven by the authoritative `open_soul_shard` RPC — the returned
// rarity + reward feed the visuals. Used by the hub's forced fragment popup.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ROLES } from "@/lib/roles";
import { LE_NAME, MANO_NAME, type ShardReward, type FragmentRarity } from "@/lib/economy";
import { ManoIcon, LifeProficiencyIcon } from "@/components/CurrencyIcons";
import { playWhoosh } from "@/lib/sound";

// ── tiny math helpers ────────────────────────────────────────────────────────
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutCubic = (t: number) => --t * t * t + 1;

// ── timeline constants (seconds) ─────────────────────────────────────────────
const T = {
  charge: 0.0,
  shatter: 2.2,
  whiteFull: 2.55,
  whiteHold: 3.2,
  rarityName: 4.0,
  colorFull: 4.9,
  reveal: 5.0,
  continueShow: 7.2,
  end: 10.0,
};
// You can advance early (respect the player's time on bulk pulls) once the
// reward has fully landed.
const CONTINUE_AT = T.reveal + 1.3;

// ── rarity visual profiles (colour/particles/glow only — rewards come from the
//    server). `ink` = dark text colour for the bright Divine wash. ────────────
type RarityCfg = {
  name: string;
  tier: string;
  wash: [string, string, string, string];
  glow: string;
  accent: string;
  particles: number;
  intensity: number;
  ink?: string;
};
const RARITIES: Record<FragmentRarity, RarityCfg> = {
  earthen: { name: "Earthen", tier: "Common", wash: ["#0c0a07", "#2e2114", "#7a5a2e", "#caa05a"], glow: "#d8a44e", accent: "#ecc887", particles: 16, intensity: 0.55 },
  verdant: { name: "Verdant", tier: "Uncommon", wash: ["#070d09", "#13301c", "#2f6b3a", "#7fd08a"], glow: "#5fc873", accent: "#a4e7b0", particles: 22, intensity: 0.72 },
  primal: { name: "Primal", tier: "Rare", wash: ["#100503", "#3a120a", "#8a2c18", "#ef6330"], glow: "#f0612e", accent: "#ff9b5a", particles: 30, intensity: 0.92 },
  noble: { name: "Noble", tier: "Epic", wash: ["#08081a", "#1a1442", "#3f2f9a", "#8a78f4"], glow: "#8a6cf0", accent: "#bcb0ff", particles: 38, intensity: 1.08 },
  divine: { name: "Divine", tier: "Legendary", wash: ["#4a4326", "#a99463", "#ecddb0", "#fffbef"], glow: "#fff1cc", accent: "#fffaf2", ink: "#4a3a12", particles: 54, intensity: 1.3 },
};

const DISPLAY = "var(--font-cinzel), Georgia, serif";
const UI = "'Space Grotesk', system-ui, sans-serif";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";

// ── responsive layout: portrait (mobile) vs landscape (desktop) ──────────────
type Layout = {
  key: "portrait" | "landscape";
  W: number; H: number; CX: number; CY: number;
  wrapH: number;
  rarityTop: number; raritySize: number; rarityLift: number;
  itemOffset: number;
  iconRole: number; iconCur: number;
  amountSize: number; unitSize: number; roleSize: number;
  subSize: number; subMt: number; iconMb: number;
  xpMt: number; xpPad: string; xpNum: number; xpLabel: number;
  idleHintTop: number; idleTapTop: number;
};
const PORTRAIT: Layout = {
  key: "portrait", W: 1080, H: 1920, CX: 540, CY: 860, wrapH: 1960,
  rarityTop: 470, raritySize: 104, rarityLift: -150, itemOffset: 210,
  iconRole: 150, iconCur: 168, amountSize: 150, unitSize: 54, roleSize: 80,
  subSize: 26, subMt: 22, iconMb: 24, xpMt: 40, xpPad: "14px 30px", xpNum: 46, xpLabel: 30,
  idleHintTop: 230, idleTapTop: 1320,
};
const LANDSCAPE: Layout = {
  key: "landscape", W: 1920, H: 1080, CX: 960, CY: 470, wrapH: 1120,
  rarityTop: 330, raritySize: 88, rarityLift: -210, itemOffset: 110,
  iconRole: 120, iconCur: 132, amountSize: 116, unitSize: 42, roleSize: 62,
  subSize: 24, subMt: 18, iconMb: 18, xpMt: 30, xpPad: "12px 26px", xpNum: 40, xpLabel: 26,
  idleHintTop: 175, idleTapTop: 800,
};

// ── stage context: current time + active layout ──────────────────────────────
const StageCtx = createContext<{ t: number; L: Layout }>({ t: 0, L: PORTRAIT });
const useStage = () => useContext(StageCtx);

// ── derived reward (from the server's ShardReward) ───────────────────────────
type Reward =
  | { type: "mano" | "lp"; amount: number; xp: number }
  | { type: "role"; role: string | null; xp: number };

function toReward(r: ShardReward): Reward | null {
  if (r.kind === "none") return null;
  if (r.kind === "role") return { type: "role", role: r.role, xp: r.xp_gained };
  return { type: r.kind === "le" ? "lp" : "mano", amount: r.amount, xp: r.xp_gained };
}

// ── shared idle shard SVG ────────────────────────────────────────────────────
function ShardSvg() {
  return (
    <svg viewBox="0 0 200 400" width={200} height={400} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="ishardFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#efe9ff" /><stop offset="42%" stopColor="#b9a3ff" /><stop offset="100%" stopColor="#6f55c9" />
        </linearGradient>
        <radialGradient id="ishardCore" cx="50%" cy="42%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="60%" stopColor="#cbb8ff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#cbb8ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <polygon points="100,8 168,118 100,392 32,118" fill="url(#ishardFill)" stroke="#efe7ff" strokeWidth="1.5" strokeOpacity="0.7" />
      <polygon points="100,8 168,118 100,196" fill="#ffffff" fillOpacity="0.16" />
      <polygon points="100,8 32,118 100,196" fill="#000000" fillOpacity="0.10" />
      <polygon points="32,118 100,196 100,392" fill="#000000" fillOpacity="0.18" />
      <polygon points="168,118 100,196 100,392" fill="#ffffff" fillOpacity="0.10" />
      <line x1="100" y1="8" x2="100" y2="392" stroke="#fff" strokeOpacity="0.25" strokeWidth="1" />
      <line x1="32" y1="118" x2="168" y2="118" stroke="#fff" strokeOpacity="0.18" strokeWidth="1" />
      <ellipse cx="100" cy="170" rx="70" ry="120" fill="url(#ishardCore)" />
    </svg>
  );
}

// ── full-window living backdrop (fills wide screens around the centred stage,
//    crossfades to the rarity wash on reveal). Driven by a continuous root clock. ─
function Backdrop({ c, cfg, revealed }: { c: number; cfg: RarityCfg; revealed: boolean }) {
  const [c0, c1, c2, c3] = cfg.wash;
  const blobs = useMemo(() => {
    const r = mulberry32(404);
    return Array.from({ length: 5 }, () => ({
      x: 10 + r() * 80, y: 8 + r() * 84, sz: 30 + r() * 36,
      sp: 0.05 + r() * 0.12, ph: r() * Math.PI * 2, dx: 6 + r() * 10, dy: 5 + r() * 9,
    }));
  }, []);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "radial-gradient(120% 90% at 50% 46%, #161320 0%, #0b0a11 48%, #050409 100%)" }}>
      {blobs.map((b, i) => {
        const x = b.x + Math.sin(c * b.sp + b.ph) * b.dx;
        const y = b.y + Math.cos(c * b.sp * 1.2 + b.ph) * b.dy;
        const tint = revealed ? cfg.glow : "#6b53c9";
        return <div key={i} style={{ position: "absolute", left: `${x}vw`, top: `${y}vh`, width: `${b.sz}vmax`, height: `${b.sz}vmax`, marginLeft: `-${b.sz / 2}vmax`, marginTop: `-${b.sz / 2}vmax`, borderRadius: "50%", background: `radial-gradient(circle, ${tint}, transparent 70%)`, opacity: revealed ? 0.22 : 0.1, transition: "opacity 1.4s ease, background 1.4s ease", filter: "blur(40px)" }} />;
      })}
      <div style={{ position: "absolute", inset: 0, opacity: revealed ? 0.7 : 0, transition: "opacity 1.6s ease", background: `radial-gradient(120% 80% at 50% 46%, ${c3} 0%, ${c2} 30%, ${c1} 62%, ${c0} 100%)` }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 100% at 50% 48%, transparent 40%, rgba(0,0,0,0.5) 100%)" }} />
    </div>
  );
}

// ── void background: faint drifting motes ────────────────────────────────────
function VoidBackground() {
  const { t, L } = useStage();
  const motes = useMemo(() => {
    const r = mulberry32(99);
    return Array.from({ length: 34 }, () => ({
      x: r() * L.W, y: r() * L.H, r: 0.6 + r() * 2.2,
      sp: 4 + r() * 10, ph: r() * Math.PI * 2, drift: (r() - 0.5) * 30,
      base: 0.06 + r() * 0.16,
    }));
  }, [L.W, L.H]);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "radial-gradient(120% 90% at 50% 46%, #161320 0%, #0b0a11 48%, #050409 100%)" }}>
      {motes.map((m, i) => {
        const y = (((m.y - t * m.sp) % L.wrapH) + L.wrapH) % L.wrapH - 20;
        const x = m.x + Math.sin(t * 0.4 + m.ph) * m.drift;
        const tw = m.base * (0.6 + 0.4 * Math.sin(t * 1.3 + m.ph));
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: m.r, height: m.r, borderRadius: "50%", background: "#cdbdff", opacity: tw, boxShadow: `0 0 ${m.r * 3}px #9d86ff` }} />;
      })}
    </div>
  );
}

// ── soul particles around the shard (idle + charge) ──────────────────────────
function SoulParticles() {
  const { t, L } = useStage();
  const specs = useMemo(() => {
    const r = mulberry32(7);
    return Array.from({ length: 26 }, () => ({
      ang: r() * Math.PI * 2, dist: 150 + r() * 230, sp: 0.5 + r() * 0.9,
      ph: r() * Math.PI * 2, sz: 1.5 + r() * 3.5, hue: r(),
    }));
  }, []);
  if (t >= T.shatter) return null;
  const charge = clamp((t - T.charge) / (T.shatter - T.charge), 0, 1);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {specs.map((p, i) => {
        const orbit = t * p.sp + p.ph;
        const pull = charge * charge;
        const dist = p.dist * (1 - 0.92 * pull) + Math.sin(t * 1.6 + p.ph) * 8 * (1 - pull);
        const x = L.CX + Math.cos(orbit) * dist;
        const y = L.CY + Math.sin(orbit) * dist * 0.9;
        const op = (0.18 + 0.5 * charge) * (0.5 + 0.5 * Math.sin(t * 2 + p.ph));
        const sz = p.sz * (1 + charge * 0.8);
        const col = p.hue > 0.5 ? "#e7deff" : "#b59bff";
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: sz, height: sz, marginLeft: -sz / 2, marginTop: -sz / 2, borderRadius: "50%", background: "#dccffd", opacity: clamp(op, 0, 1), boxShadow: `0 0 ${sz * 4}px ${col}` }} />;
      })}
    </div>
  );
}

// ── the charging shard ───────────────────────────────────────────────────────
function Shard() {
  const { t, L } = useStage();
  if (t >= T.shatter) return null;
  const charge = clamp((t - T.charge) / (T.shatter - T.charge), 0, 1);
  const ch2 = charge * charge;
  const floatY = Math.sin(t * 1.05) * 16 * (1 - charge);
  const idleRot = Math.sin(t * 0.5) * 4 * (1 - charge);
  const pulse = 1 + Math.sin(t * 2.2) * 0.035;
  const freq = 22 + charge * 34;
  const shx = Math.sin(t * freq) * ch2 * 13;
  const shy = Math.cos(t * freq * 1.27) * ch2 * 11;
  const flash = Math.sin(t * 38) * ch2 * 0.06;
  const scale = pulse * (1 + ch2 * 0.1 + flash);
  const glow = (0.5 + 0.5 * Math.sin(t * 2.2)) * 0.4 + 0.6 + charge * 1.4;
  const crackOp = smoothstep(0.12, 0.65, charge);
  const coreBright = 0.55 + charge * 0.45;
  return (
    <div style={{ position: "absolute", left: L.CX + shx, top: L.CY + floatY + shy, transform: `translate(-50%,-50%) rotate(${idleRot}deg) scale(${scale})`, width: 200, height: 400, filter: `drop-shadow(0 0 ${24 + glow * 30}px rgba(157,134,255,${0.5 + charge * 0.45}))` }}>
      <svg viewBox="0 0 200 400" width={200} height={400} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="cshardFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#efe9ff" /><stop offset="42%" stopColor="#b9a3ff" /><stop offset="100%" stopColor="#6f55c9" />
          </linearGradient>
          <radialGradient id="cshardCore" cx="50%" cy="42%" r="55%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={coreBright} />
            <stop offset="60%" stopColor="#cbb8ff" stopOpacity={coreBright * 0.5} />
            <stop offset="100%" stopColor="#cbb8ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <polygon points="100,8 168,118 100,392 32,118" fill="url(#cshardFill)" stroke="#efe7ff" strokeWidth="1.5" strokeOpacity="0.7" />
        <polygon points="100,8 168,118 100,196" fill="#ffffff" fillOpacity="0.16" />
        <polygon points="100,8 32,118 100,196" fill="#000000" fillOpacity="0.10" />
        <polygon points="32,118 100,196 100,392" fill="#000000" fillOpacity="0.18" />
        <polygon points="168,118 100,196 100,392" fill="#ffffff" fillOpacity="0.10" />
        <line x1="100" y1="8" x2="100" y2="392" stroke="#fff" strokeOpacity="0.25" strokeWidth="1" />
        <line x1="32" y1="118" x2="168" y2="118" stroke="#fff" strokeOpacity="0.18" strokeWidth="1" />
        <ellipse cx="100" cy="170" rx="70" ry="120" fill="url(#cshardCore)" />
        <g stroke="#fff7ff" strokeWidth="2" fill="none" opacity={crackOp} style={{ filter: "drop-shadow(0 0 6px #d9c4ff)" }}>
          <polyline points="100,120 88,150 104,180 92,214 108,250" />
          <polyline points="100,150 120,176 110,210 126,240" />
          <polyline points="100,150 80,176 90,206 74,232" />
          <polyline points="100,80 110,108 96,128" opacity={smoothstep(0.4, 0.8, charge)} />
        </g>
      </svg>
    </div>
  );
}

// ── shatter burst ────────────────────────────────────────────────────────────
function ShatterBurst() {
  const { t, L } = useStage();
  const pieces = useMemo(() => {
    const r = mulberry32(21);
    return Array.from({ length: 16 }, () => ({
      ang: r() * Math.PI * 2, spread: 240 + r() * 360, rot: (r() - 0.5) * 900,
      sz: 16 + r() * 34, sp: 0.7 + r() * 0.6, shape: r() > 0.5,
    }));
  }, []);
  if (t < T.shatter || t > T.shatter + 1.6) return null;
  const p = clamp((t - T.shatter) / 1.0, 0, 1);
  const ringP = clamp((t - T.shatter) / 0.55, 0, 1);
  const ease = easeOutCubic(p);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: L.CX, top: L.CY, width: 8, height: 8, marginLeft: -4, marginTop: -4, borderRadius: "50%", background: "#fff", transform: `scale(${1 + ringP * 70})`, opacity: (1 - ringP) * 0.9, boxShadow: "0 0 120px 60px rgba(213,196,255,0.9)" }} />
      <div style={{ position: "absolute", left: L.CX, top: L.CY, width: 60, height: 60, marginLeft: -30, marginTop: -30, borderRadius: "50%", border: "3px solid rgba(220,205,255,0.9)", transform: `scale(${0.2 + ringP * 14})`, opacity: 1 - ringP }} />
      {pieces.map((pc, i) => {
        const d = pc.spread * ease * pc.sp;
        const x = L.CX + Math.cos(pc.ang) * d;
        const y = L.CY + Math.sin(pc.ang) * d - ease * 40;
        const op = (1 - p) * (1 - p);
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: pc.sz, height: pc.sz * 1.7, marginLeft: -pc.sz / 2, marginTop: -pc.sz, background: "linear-gradient(160deg,#efe9ff,#8a72e0)", clipPath: pc.shape ? "polygon(50% 0,100% 60%,50% 100%,0 60%)" : "polygon(50% 0,100% 50%,70% 100%,0 70%)", opacity: op, transform: `rotate(${pc.rot * ease}deg)`, boxShadow: "0 0 10px rgba(180,160,255,0.7)" }} />;
      })}
    </div>
  );
}

// ── whiteout flash ───────────────────────────────────────────────────────────
function Whiteout() {
  const { t } = useStage();
  let w: number;
  if (t < T.shatter) w = 0;
  else if (t < T.whiteHold) w = clamp((t - T.shatter) / (T.whiteFull - T.shatter), 0, 1);
  else w = 1 - smoothstep(T.whiteHold, T.colorFull, t);
  if (w <= 0.001) return null;
  return <div style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: w, pointerEvents: "none" }} />;
}

// ── rarity colour wash ───────────────────────────────────────────────────────
function ColorWash({ cfg }: { cfg: RarityCfg }) {
  const { t } = useStage();
  if (t < T.shatter - 0.1) return null;
  const op = clamp((t - T.shatter) / 0.6, 0, 1);
  const breathe = 0.5 + 0.5 * Math.sin(t * 0.7);
  const [c0, c1, c2, c3] = cfg.wash;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: op, pointerEvents: "none", background: `radial-gradient(${110 + breathe * 20}% ${90 + breathe * 15}% at 50% ${44 - breathe * 4}%, ${c3} 0%, ${c2} 26%, ${c1} 58%, ${c0} 100%)` }}>
      <div style={{ position: "absolute", inset: "-40%", opacity: 0.1 + cfg.intensity * 0.07, background: `conic-gradient(from ${t * 12}deg at 50% 46%, transparent 0deg, ${cfg.accent} 14deg, transparent 30deg, transparent 90deg, ${cfg.accent} 104deg, transparent 120deg, transparent 180deg, ${cfg.accent} 194deg, transparent 210deg, transparent 270deg, ${cfg.accent} 284deg, transparent 300deg)`, mixBlendMode: "screen" }} />
    </div>
  );
}

// ── rising rarity motes during the reveal ────────────────────────────────────
function RevealParticles({ cfg }: { cfg: RarityCfg }) {
  const { t, L } = useStage();
  const specs = useMemo(() => {
    const r = mulberry32(303);
    return Array.from({ length: cfg.particles }, () => ({
      x: r() * L.W, y0: r() * L.H, sp: 18 + r() * 60, sz: 1.6 + r() * 4.5,
      ph: r() * Math.PI * 2, drift: (r() - 0.5) * 90, base: 0.2 + r() * 0.6,
    }));
  }, [cfg.particles, L.W, L.H]);
  if (t < T.shatter) return null;
  const fade = clamp((t - T.whiteHold) / 1.2, 0, 1);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {specs.map((p, i) => {
        const y = (((p.y0 - (t - T.shatter) * p.sp) % L.wrapH) + L.wrapH) % L.wrapH - 20;
        const x = p.x + Math.sin(t * 0.5 + p.ph) * p.drift;
        const op = p.base * fade * (0.5 + 0.5 * Math.sin(t * 1.8 + p.ph));
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: p.sz, height: p.sz, marginLeft: -p.sz / 2, borderRadius: "50%", background: cfg.accent, opacity: clamp(op, 0, 1), boxShadow: `0 0 ${p.sz * 4}px ${cfg.glow}` }} />;
      })}
    </div>
  );
}

// ── rarity name + tier ───────────────────────────────────────────────────────
function RarityName({ cfg }: { cfg: RarityCfg }) {
  const { t, L } = useStage();
  if (t < T.rarityName) return null;
  const inOp = smoothstep(T.rarityName, T.rarityName + 0.6, t);
  const lift = smoothstep(T.reveal, T.reveal + 0.7, t) * L.rarityLift;
  const scaleIn = lerp(0.9, 1, easeOutBack(inOp));
  const ink = cfg.ink || "#fff";
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: L.rarityTop + lift, textAlign: "center", opacity: inOp, transform: `scale(${scaleIn})` }}>
      <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.42em", color: cfg.ink || cfg.accent, textTransform: "uppercase", paddingLeft: "0.42em", opacity: 0.85 }}>{cfg.tier}</div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: L.raritySize, lineHeight: 1.04, color: ink, letterSpacing: "0.02em", marginTop: 14, textShadow: `0 0 40px ${cfg.glow}, 0 0 90px ${cfg.glow}` }}>{cfg.name}</div>
    </div>
  );
}

// role-unlock badge: radiant gold disc with a keyhole
function RoleUnlockIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: "drop-shadow(0 0 12px rgba(255,228,154,0.9))" }}>
      <defs>
        <radialGradient id="roleRevealG" cx="50%" cy="40%" r="62%">
          <stop offset="0%" stopColor="#fff7da" /><stop offset="55%" stopColor="#ffd86a" /><stop offset="100%" stopColor="#c79c2c" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="42" fill="url(#roleRevealG)" stroke="#fff3c4" strokeWidth="2.5" strokeOpacity="0.9" />
      <circle cx="50" cy="44" r="11" fill="#7a5b12" />
      <polygon points="44,50 56,50 60,76 40,76" fill="#7a5b12" />
    </svg>
  );
}

function RewardIcon({ reward, L }: { reward: Reward; L: Layout }) {
  if (reward.type === "mano") return <ManoIcon size={L.iconCur} />;
  if (reward.type === "lp") return <LifeProficiencyIcon size={L.iconCur} />;
  return <RoleUnlockIcon size={L.iconRole} />;
}

// ── reward reveal ────────────────────────────────────────────────────────────
function ItemReveal({ cfg, reward }: { cfg: RarityCfg; reward: Reward }) {
  const { t, L } = useStage();
  if (t < T.reveal) return null;
  const p = smoothstep(T.reveal, T.reveal + 0.7, t);
  const iconP = smoothstep(T.reveal, T.reveal + 0.6, t);
  const textP = smoothstep(T.reveal + 0.22, T.reveal + 0.95, t);
  const xpP = smoothstep(T.reveal + 0.7, T.reveal + 1.3, t);
  const auraRot = t * 26;
  const auraPulse = 0.85 + 0.15 * Math.sin(t * 2);
  const bob = Math.sin(t * 1.5) * 12;
  const iconScale = lerp(0.5, 1, easeOutBack(clamp(iconP, 0, 1)));
  const tShift = (1 - clamp(textP, 0, 1)) * 16;
  const ink = cfg.ink || "#fff";
  const inkSoft = cfg.ink ? "rgba(74,58,18,0.82)" : "rgba(255,255,255,0.72)";
  const chipBg = cfg.ink ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.08)";
  const chipBorder = cfg.ink ? "rgba(74,58,18,0.30)" : "rgba(255,255,255,0.28)";
  const roleName = reward.type === "role" ? (reward.role ? ROLES[reward.role]?.name ?? "New Role" : "New Role") : "";

  return (
    <div style={{ position: "absolute", left: L.CX, top: L.CY + L.itemOffset, transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", width: 940, pointerEvents: "none" }}>
      {/* aura halo */}
      <div style={{ position: "absolute", left: "50%", top: 90, width: 780, height: 780, marginLeft: -390, marginTop: -390, borderRadius: "50%", opacity: p * 0.85, transform: `rotate(${auraRot}deg) scale(${auraPulse})`, background: `conic-gradient(from 0deg, transparent, ${cfg.glow}, transparent 38%, transparent 62%, ${cfg.glow}, transparent)`, filter: "blur(30px)", mixBlendMode: "screen" }} />
      <div style={{ position: "absolute", left: "50%", top: 90, width: 540, height: 540, marginLeft: -270, marginTop: -270, borderRadius: "50%", opacity: p, background: `radial-gradient(circle, ${cfg.glow}55 0%, transparent 60%)` }} />

      {/* floating icon */}
      <div style={{ opacity: clamp(iconP, 0, 1), transform: `translateY(${bob}px) scale(${iconScale})`, marginBottom: L.iconMb, position: "relative" }}>
        <RewardIcon reward={reward} L={L} />
      </div>

      {/* amount + label */}
      <div style={{ opacity: clamp(textP, 0, 1), transform: `translateY(${tShift}px)`, textAlign: "center", position: "relative" }}>
        {reward.type !== "role" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: L.amountSize, color: ink, lineHeight: 0.92, textShadow: `0 0 60px ${cfg.glow}` }}>{reward.amount}</span>
            <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: L.unitSize, color: ink, marginTop: 4, textShadow: `0 0 40px ${cfg.glow}aa` }}>{reward.type === "mano" ? MANO_NAME : LE_NAME}</span>
          </div>
        ) : (
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: L.roleSize, lineHeight: 1.04, color: ink, textShadow: `0 0 60px ${cfg.glow}` }}>{roleName}</div>
        )}
        <div style={{ fontFamily: UI, fontSize: L.subSize, color: inkSoft, marginTop: L.subMt, letterSpacing: "0.02em" }}>
          {reward.type === "mano" ? "Premium currency added" : reward.type === "lp" ? "Added to your balance" : "Role unlocked — pick it in any game"}
        </div>
      </div>

      {/* flat XP earned for opening the fragment */}
      <div style={{ marginTop: L.xpMt, opacity: clamp(xpP, 0, 1), transform: `translateY(${(1 - clamp(xpP, 0, 1)) * 18}px) scale(${lerp(0.8, 1, easeOutBack(clamp(xpP, 0, 1)))})` }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: L.xpPad, borderRadius: 999, background: chipBg, border: `1.5px solid ${chipBorder}`, backdropFilter: "blur(6px)", boxShadow: `0 0 30px ${cfg.glow}44` }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: L.xpNum, color: ink, lineHeight: 1, textShadow: `0 0 24px ${cfg.glow}` }}>+{reward.xp}</span>
          <span style={{ fontFamily: UI, fontSize: L.xpLabel, fontWeight: 600, letterSpacing: "0.12em", color: ink, opacity: 0.85 }}>XP</span>
        </div>
      </div>
    </div>
  );
}

// ── vignette ─────────────────────────────────────────────────────────────────
function Vignette() {
  return <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 100% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />;
}

// ── continue prompt ──────────────────────────────────────────────────────────
function ContinuePrompt({ cfg, remaining }: { cfg: RarityCfg; remaining: number }) {
  const { t } = useStage();
  const op = smoothstep(CONTINUE_AT, CONTINUE_AT + 0.6, t);
  if (op <= 0.01) return null;
  const pulse = 0.55 + 0.45 * Math.sin(t * 2);
  const ink = cfg.ink || "#fff";
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 150, textAlign: "center", opacity: op * (0.55 + pulse * 0.45), pointerEvents: "none" }}>
      <div style={{ fontFamily: UI, fontSize: 32, fontWeight: 500, color: ink, letterSpacing: "0.04em" }}>
        {remaining > 0 ? `Tap to open the next (${remaining} left)` : "Tap to continue"}
      </div>
    </div>
  );
}

// ── idle phase visuals ───────────────────────────────────────────────────────
function IdleShard() {
  const { t, L } = useStage();
  const floatY = Math.sin(t * 1.05) * 16;
  const idleRot = Math.sin(t * 0.5) * 4;
  const pulse = 1 + Math.sin(t * 2.2) * 0.04;
  const glow = 0.6 + (0.5 + 0.5 * Math.sin(t * 2.2)) * 0.55;
  const ringP = (t % 2.6) / 2.6;
  return (
    <div style={{ position: "absolute", left: L.CX, top: L.CY + floatY, transform: "translate(-50%,-50%)" }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 220, height: 220, marginLeft: -110, marginTop: -110, borderRadius: "50%", border: "2px solid rgba(185,163,255,0.5)", transform: `scale(${0.6 + ringP * 1.8})`, opacity: (1 - ringP) * 0.5 }} />
      <div style={{ transform: `rotate(${idleRot}deg) scale(${pulse})`, width: 200, height: 400, filter: `drop-shadow(0 0 ${30 + glow * 28}px rgba(157,134,255,0.6))` }}>
        <ShardSvg />
      </div>
    </div>
  );
}

function IdleParticles() {
  const { t, L } = useStage();
  const specs = useMemo(() => {
    const r = mulberry32(7);
    return Array.from({ length: 26 }, () => ({
      ang: r() * Math.PI * 2, dist: 150 + r() * 230, sp: 0.5 + r() * 0.9,
      ph: r() * Math.PI * 2, sz: 1.5 + r() * 3.5,
    }));
  }, []);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {specs.map((p, i) => {
        const orbit = t * p.sp + p.ph;
        const dist = p.dist + Math.sin(t * 1.6 + p.ph) * 10;
        const x = L.CX + Math.cos(orbit) * dist;
        const y = L.CY + Math.sin(orbit) * dist * 0.9;
        const op = 0.2 * (0.5 + 0.5 * Math.sin(t * 2 + p.ph));
        return <div key={i} style={{ position: "absolute", left: x, top: y, width: p.sz, height: p.sz, marginLeft: -p.sz / 2, marginTop: -p.sz / 2, borderRadius: "50%", background: "#dccffd", opacity: clamp(op, 0, 1), boxShadow: `0 0 ${p.sz * 4}px #b59bff` }} />;
      })}
    </div>
  );
}

function IdleHint({ remaining }: { remaining: number }) {
  const { t, L } = useStage();
  const tap = 0.5 + 0.5 * Math.sin(t * 2);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: L.idleHintTop, textAlign: "center" }}>
        <div style={{ fontFamily: MONO, fontSize: 22, letterSpacing: "0.5em", color: "#9d86ff", textTransform: "uppercase", paddingLeft: "0.5em" }}>
          {remaining > 1 ? `${remaining} Soul Fragments` : "Soul Fragment"}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: L.idleTapTop, textAlign: "center", opacity: 0.5 + tap * 0.5 }}>
        <div style={{ fontFamily: UI, fontSize: 32, fontWeight: 500, color: "#fff", letterSpacing: "0.04em" }}>Tap to open</div>
      </div>
    </div>
  );
}

// ── clocks ───────────────────────────────────────────────────────────────────
// Phase clock: resets each open, holds at T.end (for the reveal hold).
function usePhaseClock(runKey: unknown, max: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    setT(0);
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last == null) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      setT((v) => Math.min(max, v + dt));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [runKey, max]);
  return t;
}
// Root clock: never resets — drives the persistent backdrop drift.
function useRootClock() {
  const [c, setC] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last: number | null = null;
    const step = (ts: number) => {
      if (last == null) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      setC((v) => v + dt);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return c;
}

// ── orientation (portrait = mobile, landscape = desktop) ─────────────────────
function useOrientation(): "portrait" | "landscape" {
  const [o, setO] = useState<"portrait" | "landscape">(() =>
    typeof window !== "undefined" && window.innerWidth >= window.innerHeight ? "landscape" : "portrait"
  );
  useEffect(() => {
    const onResize = () => setO(window.innerWidth >= window.innerHeight ? "landscape" : "portrait");
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return o;
}

// ── public component ─────────────────────────────────────────────────────────
// `remaining` = unopened fragments currently in the account (after any opens so
// far). `openOne` opens one server-side and returns the rolled reward;
// `onAfterOpen` refreshes the caller's economy; `onClose` finishes the popup.
export function SoulFragmentReveal({
  remaining,
  openOne,
  onAfterOpen,
  onClose,
}: {
  remaining: number;
  openOne: () => Promise<ShardReward>;
  onAfterOpen: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "playing">("idle");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState(0); // bumps to reset the phase clock per open
  const [current, setCurrent] = useState<ShardReward | null>(null);

  const orientation = useOrientation();
  const L = orientation === "landscape" ? LANDSCAPE : PORTRAIT;

  const t = usePhaseClock(phase + run, phase === "playing" ? T.end : Infinity);
  const cRoot = useRootClock();

  // viewport-fit scale for the centred stage
  const rootRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setScale(Math.max(0.05, Math.min(el.clientWidth / L.W, el.clientHeight / L.H)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [L.W, L.H]);

  // one-shot shatter whoosh per open
  const whooshed = useRef(false);
  useEffect(() => { whooshed.current = false; }, [run]);
  useEffect(() => {
    if (phase === "playing" && !whooshed.current && t >= T.shatter) {
      whooshed.current = true;
      try { playWhoosh(700); } catch { /* fail-silent */ }
    }
  }, [phase, t]);

  async function openNext() {
    if (busy || remaining <= 0) return;
    setBusy(true);
    try {
      const r = await openOne();
      await onAfterOpen();
      if (r.kind === "none") { onClose(); return; }
      setCurrent(r);
      setRun((n) => n + 1);
      setPhase("playing");
    } catch {
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    if (t < CONTINUE_AT) return; // let the reveal land first
    if (remaining > 0) {
      setCurrent(null);
      setRun((n) => n + 1);
      setPhase("idle");
    } else {
      onClose();
    }
  }

  const reward = current ? toReward(current) : null;
  const cfg = current && current.kind !== "none" ? RARITIES[current.rarity] : RARITIES.earthen;
  const revealed = phase === "playing" && t >= T.whiteHold;
  const onClick = phase === "idle" ? (busy ? undefined : openNext) : t >= CONTINUE_AT ? advance : undefined;

  return (
    <div
      ref={rootRef}
      onClick={onClick}
      style={{ position: "fixed", inset: 0, zIndex: 120, overflow: "hidden", background: "#050409", cursor: onClick ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <Backdrop c={cRoot} cfg={cfg} revealed={revealed} />
      <div style={{ width: L.W, height: L.H, position: "relative", flexShrink: 0, overflow: "hidden", background: "transparent", transform: `scale(${scale})`, transformOrigin: "center" }}>
        <StageCtx.Provider value={{ t, L }}>
          {phase === "idle" ? (
            <>
              <VoidBackground />
              <IdleParticles />
              <IdleShard />
              <Vignette />
              <IdleHint remaining={remaining} />
            </>
          ) : (
            <>
              <VoidBackground />
              <ColorWash cfg={cfg} />
              <SoulParticles />
              <RevealParticles cfg={cfg} />
              <Shard />
              <ShatterBurst />
              <RarityName cfg={cfg} />
              {reward && <ItemReveal cfg={cfg} reward={reward} />}
              <Whiteout />
              <Vignette />
              <ContinuePrompt cfg={cfg} remaining={remaining} />
            </>
          )}
        </StageCtx.Provider>
      </div>
    </div>
  );
}
