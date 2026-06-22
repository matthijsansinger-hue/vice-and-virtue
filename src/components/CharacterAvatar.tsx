"use client";

// Renders a player's customizable character as an inline SVG bust (head, eyes,
// hair, shoulders/collar) drawn parametrically from the config in
// src/lib/character.ts — no image assets. Every part recolours from the chosen
// skin / hair / eye / outfit colours and the hairstyle id. The BUILD differs by
// gender (male = wider jaw + neck + bigger traps; female = bigger eyes + lashes
// + slimmer build — see TRAITS), and the EXPRESSION reshapes the brows, eye
// openness and mouth (see EXPR).
//   - variant="badge" (default): a round head-and-shoulders portrait on a dark
//     backdrop (banners, lobby rows, leaderboard, …).
//   - variant="full": the same bust in a rounded panel with no backdrop (the
//     profile "edit character" widget).

import { useId, type ReactNode } from "react";
import { skinHex, hairHex, eyeHex, outfitHex, type CharacterConfig, type Gender, type Expression, type FacialHair as FacialHairId } from "@/lib/character";

const INK = "#2b2230";

// Shift a hex toward black (amt<0) or white (amt>0) — for shadows / outlines / trims.
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = Math.abs(amt), to = amt < 0 ? 0 : 255;
  r = Math.round(r + (to - r) * t); g = Math.round(g + (to - g) * t); b = Math.round(b + (to - b) * t);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

type Traits = {
  head: string; cheek: string; ears: [number, number, number, number];
  neck: string; neckSh: string; shoulder: string; trim: string; browW: number;
  eyeW: number; eyeTop: number; eyeBot: number; iris: number; lashes: boolean; mouthY: number;
};

const TRAITS: Record<Gender, Traits> = {
  female: {
    head: "M73,92 C73,55 95,39 120,39 C145,39 167,55 167,92 C167,122 152,151 120,156 C88,151 73,122 73,92 Z",
    cheek: "M150,72 C164,86 166,116 154,138 C164,108 158,86 148,76 Z",
    ears: [71, 169, 8, 13],
    neck: "M106,150 L134,150 L133,181 C127,188 113,188 107,181 Z",
    neckSh: "M108,154 C115,163 125,163 132,154 L133,167 C125,174 115,174 108,167 Z",
    shoulder: "M26,240 C26,198 62,180 120,180 C178,180 214,198 214,240 Z",
    trim: "M92,197 C92,183 102,180 120,180 C138,180 148,183 148,197 L148,240 92,240 Z",
    browW: 2.8, eyeW: 14, eyeTop: 93, eyeBot: 117, iris: 9.2, lashes: true, mouthY: 135,
  },
  male: {
    head: "M69,88 C69,51 93,36 120,36 C147,36 171,51 171,88 C171,116 166,139 152,149 C143,156 131,158 120,158 C109,158 97,156 88,149 C74,139 69,116 69,88 Z",
    cheek: "M152,70 C167,86 169,118 156,142 C167,110 161,86 149,75 Z",
    ears: [69, 171, 8, 14],
    neck: "M100,147 L140,147 L139,183 C132,191 108,191 101,183 Z",
    neckSh: "M103,152 C112,162 128,162 137,152 L138,167 C128,176 112,176 102,167 Z",
    shoulder: "M10,240 C10,186 40,175 74,172 C90,164 104,166 120,166 C136,166 150,164 166,172 C200,175 230,186 230,240 Z",
    trim: "M88,196 C88,179 100,173 120,173 C140,173 152,179 152,196 L152,240 88,240 Z",
    browW: 3.8, eyeW: 12, eyeTop: 97, eyeBot: 116, iris: 8, lashes: false, mouthY: 137,
  },
};

// Per-expression: brow y at x(outer 84 / centre 100 / inner 116), eye-open
// deltas (top↑ / bot↓ = wider), and iris vertical nudge (sad looks down).
const EXPR: Record<Expression, { brow: [number, number, number]; top: number; bot: number; dy: number }> = {
  neutral: { brow: [88, 82, 88], top: 0, bot: 0, dy: 0 },
  happy: { brow: [86, 79, 86], top: 0, bot: -3, dy: 0 },
  angry: { brow: [85, 87, 94], top: 3, bot: 0, dy: 0 },
  sad: { brow: [91, 89, 82], top: 1, bot: -1, dy: 1.5 },
  scared: { brow: [83, 78, 85], top: -3, bot: 3, dy: 0.5 },
};

function Brows({ expr, w }: { expr: Expression; w: number }) {
  const [o, c, i] = EXPR[expr].brow;
  return (
    <>
      <path d={`M84,${o} Q100,${c} 116,${i}`} stroke={INK} strokeWidth={w} fill="none" strokeLinecap="round" />
      <path d={`M156,${o} Q140,${c} 124,${i}`} stroke={INK} strokeWidth={w} fill="none" strokeLinecap="round" />
    </>
  );
}

function Mouth({ expr, y }: { expr: Expression; y: number }): ReactNode {
  switch (expr) {
    case "happy":
      return (
        <>
          <path d={`M104,${y - 1} Q120,${y + 13} 136,${y - 1}`} stroke={INK} strokeWidth={2.8} fill="none" strokeLinecap="round" />
          <path d={`M110,${y + 4} Q120,${y + 8} 130,${y + 4}`} stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
        </>
      );
    case "angry":
      return <path d={`M108,${y + 3} Q120,${y - 3} 132,${y + 3}`} stroke={INK} strokeWidth={2.8} fill="none" strokeLinecap="round" />;
    case "sad":
      return <path d={`M108,${y + 4} Q120,${y - 4} 132,${y + 4}`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />;
    case "scared":
      return <ellipse cx={120} cy={y + 2} rx={6.5} ry={8} fill="#3a2230" stroke={INK} strokeWidth={2.4} />;
    default:
      return <path d={`M109,${y} Q120,${y + 6} 131,${y}`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />;
  }
}

function Hair({ style, c, layer }: { style: string; c: string; layer: "back" | "front" }) {
  const o = shade(c, -0.4);
  const P = (d: string) => <path d={d} fill={c} stroke={o} strokeWidth={3} strokeLinejoin="round" />;
  if (layer === "back") {
    if (style === "long")
      return P("M52,86 C52,40 88,24 120,24 C152,24 188,40 188,86 C196,150 190,210 196,242 L150,242 C158,200 150,150 150,120 C150,150 90,150 90,120 C90,150 82,200 90,242 L44,242 C50,210 44,150 52,86 Z");
    if (style === "ponytail")
      return (
        <>
          {P("M170,70 C196,84 206,120 200,150 C196,176 182,196 196,214 C176,210 168,188 170,164 C172,140 168,104 150,92 Z")}
          {P("M150,150 C166,150 176,166 176,184 C176,200 164,210 150,210 C140,210 134,198 138,184 Z")}
        </>
      );
    if (style === "bun") return <circle cx={120} cy={40} r={20} fill={c} stroke={o} strokeWidth={3} />;
    return null;
  }
  switch (style) {
    case "short":
      return P("M62,102 C56,48 92,32 120,32 C148,32 184,48 178,102 C172,82 156,74 150,82 C150,56 132,60 120,60 C108,60 90,56 90,82 C84,74 68,82 62,102 Z");
    case "long":
      return P("M60,104 C54,52 92,34 120,34 C148,34 186,52 180,104 C174,84 158,74 150,84 C150,58 132,62 120,62 C108,62 88,58 90,84 C82,74 66,84 60,104 Z");
    case "ponytail":
      return P("M64,98 C58,50 92,34 120,34 C148,34 182,50 176,98 C170,80 156,74 150,82 C152,58 132,60 120,60 C108,60 90,56 90,82 C84,74 70,80 64,98 Z");
    case "bun":
      return P("M66,96 C60,54 92,42 120,42 C148,42 180,54 174,96 C168,80 156,74 150,80 C150,62 134,66 120,66 C106,66 90,62 90,80 C84,74 72,80 66,96 Z");
    case "curly":
      return P("M58,96 C44,80 50,56 66,50 C66,34 88,26 104,32 C114,22 134,22 144,32 C162,26 182,38 180,56 C196,64 196,90 182,98 C188,84 176,76 168,82 C172,66 154,64 150,72 C152,56 132,56 120,58 C108,56 90,56 92,72 C86,64 70,66 74,82 C66,76 54,84 58,96 Z");
    default:
      return null;
  }
}

// Facial hair sits over the lower face, tinted by facialHairColor. The shapes
// are fixed (they read fine on both the male and female jaw); the mouth is drawn
// over the beard and the mustache over the upper lip so the lips stay visible.
const BEARD_PATH =
  "M74,116 C76,134 84,150 100,158 C108,163 132,163 140,158 C156,150 164,134 166,116 C158,123 151,131 145,139 C139,149 127,151 120,149 C113,151 101,149 95,139 C89,131 82,123 74,116 Z";
const MUSTACHE_PATH =
  "M99,130 C104,126 110,128 114,131 C117,133 123,133 126,131 C130,128 136,126 141,130 C137,137 130,137 125,135 C122,134 118,134 115,135 C110,137 103,137 99,130 Z";

function FacialHair({ style, color, layer }: { style: FacialHairId; color: string; layer: "beard" | "mustache" }) {
  const o = shade(color, -0.4);
  if (layer === "beard" && (style === "beard" || style === "both"))
    return <path d={BEARD_PATH} fill={color} stroke={o} strokeWidth={2.5} strokeLinejoin="round" />;
  if (layer === "mustache" && (style === "mustache" || style === "both"))
    return <path d={MUSTACHE_PATH} fill={color} stroke={o} strokeWidth={2.2} strokeLinejoin="round" />;
  return null;
}

function Eye({ cx, color, t, expr, uid }: { cx: number; color: string; t: Traits; expr: Expression; uid: string }) {
  const e = EXPR[expr];
  const top = t.eyeTop + e.top, bot = t.eyeBot + e.bot;
  const my = (top + bot) / 2;
  const cy = my + 1 + e.dy;
  const id = `${uid}-${cx}`;
  const almond = `M${cx - t.eyeW},${my} Q${cx},${top} ${cx + t.eyeW},${my} Q${cx},${bot} ${cx - t.eyeW},${my} Z`;
  const out = cx < 120 ? cx - t.eyeW : cx + t.eyeW;
  const dir = cx < 120 ? -1 : 1;
  return (
    <>
      <path d={almond} fill="#f6f1e8" stroke={INK} strokeWidth={2} />
      <clipPath id={id}>
        <path d={almond} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <circle cx={cx} cy={cy} r={t.iris} fill={color} />
        <circle cx={cx} cy={cy} r={t.iris} fill="none" stroke={shade(color, -0.4)} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={t.iris * 0.42} fill="#1c1722" />
        <circle cx={cx - t.iris * 0.3} cy={cy - t.iris * 0.6} r={t.iris * 0.22} fill="#fff" opacity={0.9} />
      </g>
      <path d={`M${cx - t.eyeW},${my} Q${cx},${top - 1} ${cx + t.eyeW},${my}`} stroke={INK} strokeWidth={t.lashes ? 3.4 : 2.6} fill="none" strokeLinecap="round" />
      {t.lashes && (
        <>
          <path d={`M${out},${my} q${dir * 5},-1 ${dir * 10},-5`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <path d={`M${out + dir},${my + 2} q${dir * 4},0 ${dir * 7},-2`} stroke={INK} strokeWidth={1.8} fill="none" strokeLinecap="round" />
        </>
      )}
    </>
  );
}

export function CharacterAvatar({
  character,
  initials,
  className = "",
  textClass = "text-xs",
  variant = "badge",
}: {
  character: CharacterConfig | null;
  initials: string;
  className?: string; // box size + ring/border, from the caller
  textClass?: string; // initials font size for the no-character fallback
  variant?: "badge" | "full";
}) {
  const uid = useId().replace(/:/g, "");
  const round = variant === "badge";
  const shape = round ? "rounded-full" : "rounded-2xl";

  if (!character) {
    return (
      <span
        className={`flex items-center justify-center ${shape} ${round ? "bg-[#372155]" : ""} font-semibold text-cream ${textClass} ${className}`}
      >
        {initials}
      </span>
    );
  }

  const t = TRAITS[character.gender === "female" ? "female" : "male"];
  const expr: Expression = EXPR[character.expression] ? character.expression : "neutral";
  const skin = skinHex(character.skin);
  const skinSh = shade(skin, -0.16), skinLo = shade(skin, -0.28);
  const hairColor = hairHex(character.hairColor);
  const facialHairColor = hairHex(character.facialHairColor);
  const eye = eyeHex(character.eyeColor);
  const outfit = outfitHex(character.outfit);

  return (
    <span
      className={`relative block shrink-0 overflow-hidden ${shape} ${round ? "bg-[#2b1f12]" : ""} ${className}`}
    >
      <svg viewBox="0 0 240 240" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {round && (
          <defs>
            {/* The game's warm brown (home-bg / panel family), darkened at the
                edges so skin + hair still separate against it. */}
            <radialGradient id={`${uid}-bg`} cx="50%" cy="36%" r="78%">
              <stop offset="0%" stopColor="#43301e" />
              <stop offset="100%" stopColor="#241710" />
            </radialGradient>
          </defs>
        )}
        {round && <rect width={240} height={240} fill={`url(#${uid}-bg)`} />}
        <g transform="translate(120 122) scale(0.92) translate(-120 -120)">
          <Hair style={character.hair} c={hairColor} layer="back" />
          <path d={t.shoulder} fill={outfit} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <path d={t.trim} fill={shade(outfit, -0.22)} />
          <path d={t.neck} fill={skin} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <path d={t.neckSh} fill={skinLo} opacity={0.5} />
          <ellipse cx={t.ears[0]} cy={102} rx={t.ears[2]} ry={t.ears[3]} fill={skin} stroke={INK} strokeWidth={3} />
          <ellipse cx={t.ears[1]} cy={102} rx={t.ears[2]} ry={t.ears[3]} fill={skin} stroke={INK} strokeWidth={3} />
          <path d={t.head} fill={skin} stroke={INK} strokeWidth={3} />
          <path d={t.cheek} fill={skinSh} opacity={0.45} />
          <FacialHair style={character.facialHair} color={facialHairColor} layer="beard" />
          <Brows expr={expr} w={t.browW} />
          <Eye cx={100} color={eye} t={t} expr={expr} uid={uid} />
          <Eye cx={140} color={eye} t={t} expr={expr} uid={uid} />
          <path d="M118,113 Q115,123 121,126" stroke={skinLo} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          <Mouth expr={expr} y={t.mouthY} />
          <FacialHair style={character.facialHair} color={facialHairColor} layer="mustache" />
          <Hair style={character.hair} c={hairColor} layer="front" />
        </g>
      </svg>
    </span>
  );
}
