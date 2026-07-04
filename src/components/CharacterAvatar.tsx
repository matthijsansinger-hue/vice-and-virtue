"use client";

// Renders a player's customizable character as an inline SVG bust (head, eyes,
// hair, shoulders/collar) drawn parametrically from the config in
// src/lib/character.ts — no image assets. Every part recolours from the chosen
// skin / hair / eye / outfit colours and the hairstyle id.
//   - BUILD differs by gender (male = wider jaw + neck + bigger traps; female =
//     bigger eyes + lashes + slimmer build — see TRAITS) and by faceShape
//     (oval / round / angular — see FACE, gender-specific jaw geometry).
//   - EXPRESSION reshapes the brows, eye openness and mouth (see EXPR).
//   - Rendering detail: radial skin shading, sheen-graded hair with strand +
//     highlight work, gradient irises with limbal rings + double catchlights,
//     tapered hair-tinted brows, contoured nose and tinted lips.
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

// Blend two hexes — for skin-aware lips / blush that read on every tone.
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t);
  return "#" + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
}

type Traits = {
  ears: [number, number, number, number];
  neck: string; neckSh: string; shoulder: string; trim: string; browW: number;
  eyeW: number; eyeTop: number; eyeBot: number; iris: number; lashes: boolean; mouthY: number;
};

// Build traits (everything but the head silhouette) per gender.
const TRAITS: Record<Gender, Traits> = {
  female: {
    ears: [71, 169, 8, 13],
    neck: "M106,150 L134,150 L133,181 C127,188 113,188 107,181 Z",
    neckSh: "M108,154 C115,163 125,163 132,154 L133,167 C125,174 115,174 108,167 Z",
    shoulder: "M26,240 C26,198 62,180 120,180 C178,180 214,198 214,240 Z",
    trim: "M92,197 C92,183 102,180 120,180 C138,180 148,183 148,197 L148,240 92,240 Z",
    browW: 3.4, eyeW: 14, eyeTop: 93, eyeBot: 117, iris: 9.2, lashes: true, mouthY: 135,
  },
  male: {
    ears: [69, 171, 8, 14],
    neck: "M100,147 L140,147 L139,183 C132,191 108,191 101,183 Z",
    neckSh: "M103,152 C112,162 128,162 137,152 L138,167 C128,176 112,176 102,167 Z",
    shoulder: "M10,240 C10,186 40,175 74,172 C90,164 104,166 120,166 C136,166 150,164 166,172 C200,175 230,186 230,240 Z",
    trim: "M88,196 C88,179 100,173 120,173 C140,173 152,179 152,196 L152,240 88,240 Z",
    browW: 4.4, eyeW: 12, eyeTop: 97, eyeBot: 116, iris: 8, lashes: false, mouthY: 137,
  },
};

// Head silhouette + cheek contour per gender per face shape. Same three ids for
// both genders, drawn gender-appropriately (male jaws heavier throughout).
const FACE: Record<Gender, Record<string, { head: string; cheek: string }>> = {
  female: {
    oval: {
      head: "M73,92 C73,55 95,39 120,39 C145,39 167,55 167,92 C167,122 152,151 120,156 C88,151 73,122 73,92 Z",
      cheek: "M150,72 C164,86 166,116 154,138 C164,108 158,86 148,76 Z",
    },
    round: {
      head: "M69,94 C69,55 94,38 120,38 C146,38 171,55 171,94 C171,126 153,153 120,157 C87,153 69,126 69,94 Z",
      cheek: "M152,72 C168,88 170,120 156,140 C168,110 162,88 150,76 Z",
    },
    angular: {
      head: "M72,90 C72,53 95,38 120,38 C145,38 168,53 168,90 C168,106 165,120 158,132 C150,146 136,155 120,157 C104,155 90,146 82,132 C75,120 72,106 72,90 Z",
      cheek: "M151,70 C164,84 166,112 156,134 C165,106 159,84 148,74 Z",
    },
  },
  male: {
    oval: {
      head: "M69,88 C69,51 93,36 120,36 C147,36 171,51 171,88 C171,116 166,139 152,149 C143,156 131,158 120,158 C109,158 97,156 88,149 C74,139 69,116 69,88 Z",
      cheek: "M152,70 C167,86 169,118 156,142 C167,110 161,86 149,75 Z",
    },
    round: {
      head: "M66,92 C66,52 92,36 120,36 C148,36 174,52 174,92 C174,122 166,144 150,152 C141,158 130,160 120,160 C110,160 99,158 90,152 C74,144 66,122 66,92 Z",
      cheek: "M154,72 C170,88 172,120 158,144 C170,112 164,88 151,77 Z",
    },
    angular: {
      head: "M70,86 C70,50 94,36 120,36 C146,36 170,50 170,86 L170,118 C170,132 165,143 154,149 C144,156 131,158 120,158 C109,158 96,156 86,149 C75,143 70,132 70,118 Z",
      cheek: "M151,68 C166,84 168,116 157,142 C166,110 160,84 148,73 Z",
    },
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

// Tapered, hair-tinted brows: filled shapes, blunt at the inner head and
// tapering to a point at the outer tail (more realistic than a uniform stroke).
function Brows({ expr, w, color }: { expr: Expression; w: number; color: string }) {
  const [o, c, i] = EXPR[expr].brow;
  const h = w; // max thickness at the arch
  const left = `M84,${o} Q100,${c - h * 0.7} 116,${i - h * 0.45} Q118.5,${i} 116,${i + h * 0.55} Q100,${c + h * 0.5} 84.5,${o + 1.6} Z`;
  const right = `M156,${o} Q140,${c - h * 0.7} 124,${i - h * 0.45} Q121.5,${i} 124,${i + h * 0.55} Q140,${c + h * 0.5} 155.5,${o + 1.6} Z`;
  return (
    <>
      <path d={left} fill={color} stroke={shade(color, -0.25)} strokeWidth={0.8} strokeLinejoin="round" />
      <path d={right} fill={color} stroke={shade(color, -0.25)} strokeWidth={0.8} strokeLinejoin="round" />
    </>
  );
}

// Mouth = tinted lips (skin-aware) + expression stroke, so lips read on every
// skin tone while the expression stays crisp.
function Mouth({ expr, y, lip }: { expr: Expression; y: number; lip: string }): ReactNode {
  const lipHi = shade(lip, 0.22);
  switch (expr) {
    case "happy":
      return (
        <>
          <path d={`M104,${y - 1} Q120,${y + 12} 136,${y - 1} Q120,${y + 4} 104,${y - 1} Z`} fill={lip} opacity={0.55} />
          <path d={`M104,${y - 1} Q120,${y + 13} 136,${y - 1}`} stroke={INK} strokeWidth={2.8} fill="none" strokeLinecap="round" />
          <path d={`M110,${y + 5} Q120,${y + 9} 130,${y + 5}`} stroke={lipHi} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.8} />
        </>
      );
    case "angry":
      return (
        <>
          <path d={`M108,${y + 3} Q120,${y - 3} 132,${y + 3} Q120,${y + 6} 108,${y + 3} Z`} fill={lip} opacity={0.5} />
          <path d={`M108,${y + 3} Q120,${y - 3} 132,${y + 3}`} stroke={INK} strokeWidth={2.8} fill="none" strokeLinecap="round" />
        </>
      );
    case "sad":
      return (
        <>
          <path d={`M108,${y + 4} Q120,${y - 4} 132,${y + 4} Q120,${y + 7} 108,${y + 4} Z`} fill={lip} opacity={0.5} />
          <path d={`M108,${y + 4} Q120,${y - 4} 132,${y + 4}`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        </>
      );
    case "scared":
      return (
        <>
          <ellipse cx={120} cy={y + 2} rx={6.5} ry={8} fill="#3a2230" stroke={INK} strokeWidth={2.4} />
          <ellipse cx={120} cy={y + 6.5} rx={3.4} ry={2.4} fill={lipHi} opacity={0.7} />
        </>
      );
    default:
      return (
        <>
          <path d={`M107,${y} Q120,${y - 3.5} 133,${y} Q120,${y + 3} 107,${y} Z`} fill={lip} opacity={0.5} />
          <path d={`M107,${y} Q120,${y + 8} 133,${y} Q120,${y + 2.5} 107,${y} Z`} fill={lip} opacity={0.62} />
          <path d={`M109,${y} Q120,${y + 5} 131,${y}`} stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" />
          <path d={`M113,${y + 5} Q120,${y + 7} 127,${y + 5}`} stroke={lipHi} strokeWidth={1.6} fill="none" strokeLinecap="round" opacity={0.75} />
        </>
      );
  }
}

// ——— Hair ————————————————————————————————————————————————————————————————
// Every style is layered: base silhouette (sheen-gradient fill + dark outline),
// optional shadow regions, thin dark strand lines and light highlight strands.
// `fill` is a url() to the per-avatar hair gradient; `c` is the flat hex for
// deriving strand / outline shades.

type HairInk = {
  base: (d: string, key?: string) => ReactNode;
  sh: (d: string, key?: string) => ReactNode; // darker under-layer / depth
  ln: (d: string, key?: string, w?: number) => ReactNode; // dark strand line
  hi: (d: string, key?: string, w?: number) => ReactNode; // light sheen strand
};

function hairInk(c: string, fill: string): HairInk {
  const o = shade(c, -0.45);
  return {
    base: (d, key) => <path key={key} d={d} fill={fill} stroke={o} strokeWidth={2.6} strokeLinejoin="round" />,
    sh: (d, key) => <path key={key} d={d} fill={shade(c, -0.24)} opacity={0.75} />,
    ln: (d, key, w = 1.5) => <path key={key} d={d} stroke={shade(c, -0.32)} strokeWidth={w} fill="none" strokeLinecap="round" opacity={0.75} />,
    hi: (d, key, w = 2) => <path key={key} d={d} stroke={shade(c, 0.3)} strokeWidth={w} fill="none" strokeLinecap="round" opacity={0.65} />,
  };
}

// Long flowing back-of-head mass shared by the long-family styles.
function LongBack({ k }: { k: HairInk }) {
  return (
    <>
      {k.base("M50,92 C50,42 86,22 120,22 C154,22 190,42 190,92 C190,138 196,188 198,232 C186,240 170,240 160,236 C165,198 159,152 152,118 C151,111 148,105 144,101 L96,101 C92,105 89,111 88,118 C81,152 75,198 80,236 C70,240 54,240 42,232 C44,188 50,138 50,92 Z")}
      {k.sh("M96,101 C91,122 88,152 87,182 C93,152 96,124 101,106 Z")}
      {k.sh("M144,101 C149,122 152,152 153,182 C147,152 144,124 139,106 Z")}
      {k.ln("M62,84 C56,140 62,190 68,226")}
      {k.ln("M178,84 C184,140 178,190 172,226")}
      {k.ln("M70,66 C64,120 68,170 72,210")}
      {k.ln("M170,66 C176,120 172,170 168,210")}
      {k.hi("M58,96 C55,140 58,180 62,214")}
      {k.hi("M182,96 C185,140 182,180 178,214")}
    </>
  );
}

function Hair({ style, c, fill, layer }: { style: string; c: string; fill: string; layer: "back" | "front" }) {
  const k = hairInk(c, fill);

  if (layer === "back") {
    switch (style) {
      case "long":
      case "middlepart-long":
      case "curtain-bangs":
        return <LongBack k={k} />;
      case "sidepart-long":
        return (
          <>
            {k.base("M52,92 C52,44 88,24 120,24 C152,24 188,44 188,92 C190,132 194,176 196,220 C186,228 172,228 164,224 C168,190 162,150 154,118 C152,110 149,104 145,100 L95,100 C91,104 88,110 86,118 C78,150 72,190 76,224 C68,228 54,228 44,220 C46,176 50,132 52,92 Z")}
            {k.sh("M95,100 C90,122 87,150 86,178 C92,150 95,122 100,105 Z")}
            {k.sh("M145,100 C150,122 153,150 154,178 C148,150 145,122 140,105 Z")}
            {k.ln("M62,82 C57,136 62,182 68,214")}
            {k.ln("M178,82 C183,136 178,182 172,214")}
            {k.hi("M58,94 C56,136 59,174 63,204")}
          </>
        );
      case "curls-long":
        return (
          <>
            {k.base("M54,94 C44,86 44,66 56,58 C52,40 70,26 86,30 C94,16 122,12 134,22 C150,12 172,22 172,38 C186,40 194,58 186,70 C198,80 196,100 184,108 C194,124 188,144 174,148 C182,164 172,182 156,180 C160,196 144,208 130,200 C122,212 100,212 92,200 C76,208 60,196 64,180 C48,182 38,164 46,148 C32,144 28,122 40,110 C30,100 34,84 46,80 C42,90 48,92 54,94 Z")}
            {k.sh("M84,104 C76,130 76,160 84,186 C90,160 90,130 90,108 Z")}
            {k.sh("M156,104 C164,130 164,160 156,186 C150,160 150,130 150,108 Z")}
            {k.ln("M60,120 c-6,6 -5,16 2,20")}
            {k.ln("M178,122 c6,6 5,16 -2,20")}
            {k.ln("M68,158 c-5,6 -3,14 4,17")}
            {k.ln("M172,160 c5,6 3,14 -4,17")}
            {k.ln("M84,186 c-3,7 1,14 8,15")}
            {k.ln("M156,188 c3,7 -1,14 -8,15")}
            {k.hi("M56,104 c-5,7 -3,16 4,20")}
            {k.hi("M184,106 c5,7 3,16 -4,20")}
          </>
        );
      case "dreads":
        return (
          <>
            {k.base("M56,84 C56,36 88,18 120,18 C152,18 184,36 184,84 C186,108 186,128 183,146 C179,152 173,150 171,144 C173,156 167,162 161,157 C162,167 154,171 149,164 C149,174 140,176 136,168 L104,168 C100,176 91,174 91,164 C86,171 78,167 79,157 C73,162 67,156 69,144 C67,150 61,152 57,146 C54,128 54,108 56,84 Z")}
            {k.sh("M70,90 C68,116 68,136 71,150 C74,136 74,114 76,92 Z")}
            {k.sh("M170,90 C172,116 172,136 169,150 C166,136 166,114 164,92 Z")}
            {k.ln("M84,60 C80,92 79,124 82,152")}
            {k.ln("M100,44 C96,84 96,124 98,158")}
            {k.ln("M140,44 C144,84 144,124 142,158")}
            {k.ln("M156,60 C160,92 161,124 158,152")}
            {k.hi("M92,50 C89,86 88,120 90,150")}
            {k.hi("M148,52 C151,86 152,120 150,150")}
          </>
        );
      case "ponytail":
        return (
          <>
            {k.base("M166,62 C194,74 208,110 202,146 C198,174 186,194 194,216 C176,210 166,190 169,164 C172,136 168,102 148,86 Z")}
            {k.sh("M170,90 C186,104 192,130 188,154 C192,128 186,104 172,92 Z")}
            {k.ln("M176,96 C188,116 190,144 184,168")}
            {k.ln("M170,110 C178,130 179,156 174,178")}
            {k.hi("M182,102 C192,122 193,148 188,170")}
            {/* tie band */}
            <path d="M154,74 C160,70 168,72 172,78 C168,86 158,88 152,82 Z" fill={shade(c, -0.5)} />
          </>
        );
      case "bun":
        return (
          <>
            {k.base("M98,32 C92,14 112,4 126,8 C144,4 156,20 150,34 C154,44 144,52 132,52 C116,54 100,48 98,32 Z")}
            {k.ln("M106,26 C112,16 130,14 140,22")}
            {k.ln("M102,36 C114,44 134,44 144,34")}
            {k.hi("M110,18 C118,12 132,12 140,18")}
          </>
        );
      default:
        return null;
    }
  }

  // front layer
  switch (style) {
    case "short":
      return (
        <>
          {k.base("M64,98 C58,50 90,28 120,28 C150,28 182,50 176,98 C174,86 170,78 164,76 C168,64 150,54 138,56 Q120,50 102,56 C90,54 72,64 76,76 C70,78 66,86 64,98 Z")}
          {k.sh("M76,76 C90,62 150,62 164,76 C150,68 90,68 76,76 Z")}
          {k.ln("M96,38 C106,33 116,32 126,33")}
          {k.ln("M80,58 C90,46 104,38 118,36")}
          {k.ln("M160,58 C150,46 136,38 124,36")}
          {k.hi("M92,42 C102,34 118,31 132,33")}
        </>
      );
    case "long":
      return (
        <>
          {k.base("M62,100 C56,48 90,26 120,26 C150,26 184,48 178,100 C174,84 166,76 158,78 C161,60 140,52 120,52 C100,52 79,60 82,78 C74,76 66,84 62,100 Z")}
          {k.ln("M84,64 C92,52 106,45 118,43")}
          {k.ln("M156,64 C148,52 134,45 122,43")}
          {k.hi("M94,40 C106,32 132,32 146,39")}
        </>
      );
    case "sidepart-short":
      return (
        <>
          {k.base("M64,98 C58,48 88,27 120,27 C152,27 182,48 176,96 C173,82 167,73 158,75 C163,58 148,50 132,53 C118,48 106,51 99,58 L95,63 C85,65 77,73 79,84 C71,84 66,90 64,98 Z")}
          {k.sh("M99,58 C112,50 130,48 144,52 C130,50 112,53 101,60 Z")}
          {k.ln("M100,56 C112,46 130,42 146,45")}
          {k.ln("M98,45 C110,36 128,32 142,35")}
          {k.ln("M96,66 C106,58 118,54 130,53")}
          {k.hi("M104,50 C118,40 138,38 152,43")}
          {/* the part line */}
          {k.ln("M96,61 C94,52 92,42 94,33", undefined, 2)}
        </>
      );
    case "sidepart-long":
      return (
        <>
          {k.base("M62,100 C56,46 90,25 120,25 C152,25 184,46 178,100 C176,88 170,80 162,83 C167,62 150,52 134,55 C120,49 106,52 98,60 L94,65 C84,68 77,76 79,88 C71,87 66,92 62,100 Z")}
          {k.base("M62,100 C58,128 60,158 55,188 C64,184 70,168 70,146 C70,128 67,112 65,101 Z")}
          {k.base("M178,100 C182,128 180,158 185,188 C176,184 170,168 170,146 C170,128 173,112 175,102 Z")}
          {k.sh("M98,60 C112,52 130,50 146,54 C130,52 112,55 100,62 Z")}
          {k.ln("M99,58 C112,47 132,43 149,47")}
          {k.ln("M97,46 C110,36 128,33 143,36")}
          {k.hi("M104,52 C118,42 140,40 156,46")}
          {k.ln("M95,63 C93,53 91,43 93,32", undefined, 2)}
        </>
      );
    case "middlepart-short":
      return (
        <>
          {k.base("M66,100 C60,46 92,27 120,27 C148,27 180,46 174,100 C171,84 165,76 157,79 C160,62 141,55 124,58 L120,63 L116,58 C99,55 80,62 83,79 C75,76 69,84 66,100 Z")}
          {k.base("M66,100 C63,108 63,116 66,122 C71,118 72,108 71,100 Z")}
          {k.base("M174,100 C177,108 177,116 174,122 C169,118 168,108 169,100 Z")}
          {k.ln("M117,44 C106,40 94,44 87,54")}
          {k.ln("M123,44 C134,40 146,44 153,54")}
          {k.ln("M116,56 C107,54 98,58 92,66")}
          {k.ln("M124,56 C133,54 142,58 148,66")}
          {k.hi("M112,38 C102,36 92,40 85,49")}
          {k.hi("M128,38 C138,36 148,40 155,49")}
          {k.ln("M120,60 L120,31", undefined, 2)}
        </>
      );
    case "middlepart-long":
      return (
        <>
          {k.base("M64,102 C58,44 92,25 120,25 C148,25 182,44 176,102 C173,86 167,78 159,82 C162,63 142,56 124,59 L120,65 L116,59 C98,56 78,63 81,82 C73,78 67,86 64,102 Z")}
          {k.base("M64,102 C60,138 62,168 57,196 C67,192 73,172 73,148 C73,130 69,113 67,102 Z")}
          {k.base("M176,102 C180,138 178,168 183,196 C173,192 167,172 167,148 C167,130 171,113 173,102 Z")}
          {k.ln("M116,46 C104,42 92,46 85,57")}
          {k.ln("M124,46 C136,42 148,46 155,57")}
          {k.ln("M115,58 C105,56 96,60 90,69")}
          {k.ln("M125,58 C135,56 144,60 150,69")}
          {k.hi("M111,38 C100,36 90,42 84,52")}
          {k.hi("M129,38 C140,36 150,42 156,52")}
          {k.ln("M120,62 L120,30", undefined, 2)}
        </>
      );
    case "curtain-bangs":
      return (
        <>
          {k.base("M66,100 C60,44 92,25 120,25 C148,25 180,44 174,100 C171,82 163,72 152,70 C142,62 98,62 88,70 C77,72 69,82 66,100 Z")}
          {/* left + right curtain sweeps hug the temples (clear of the eyes), feathered tips at the cheekbones */}
          {k.base("M118,56 C100,60 86,70 80,86 C76,100 76,112 80,124 L82,112 L87,119 C83,106 84,92 90,80 C96,70 106,62 118,56 Z")}
          {k.base("M122,56 C140,60 154,70 160,86 C164,100 164,112 160,124 L158,112 L153,119 C157,106 156,92 150,80 C144,70 134,62 122,56 Z")}
          {k.ln("M112,60 C98,66 88,78 83,94")}
          {k.ln("M128,60 C142,66 152,78 157,94")}
          {k.hi("M108,60 C96,68 86,82 81,102")}
          {k.hi("M132,60 C144,68 154,82 159,102")}
          {k.ln("M120,60 L120,30", undefined, 2)}
        </>
      );
    case "curly":
      return (
        <>
          {k.base("M66,100 C54,92 52,74 62,66 C54,52 66,36 80,38 C82,24 100,18 110,26 C118,14 138,16 144,26 C158,18 172,30 170,42 C184,44 188,62 178,70 C188,80 182,96 172,100 C174,90 166,84 160,88 C162,74 148,68 140,74 C142,60 126,56 118,62 C110,54 94,58 96,70 C84,64 74,72 80,84 C70,82 64,90 66,100 Z")}
          {k.ln("M88,48 c-4,2 -4,8 0,10")}
          {k.ln("M112,36 c-5,1 -6,7 -1,9")}
          {k.ln("M136,40 c5,1 6,7 1,9")}
          {k.ln("M156,58 c4,3 3,9 -2,10")}
          {k.ln("M100,64 c-4,2 -4,7 0,9")}
          {k.ln("M128,60 c4,2 4,7 0,9")}
          {k.hi("M94,30 c6,-4 14,-4 20,0")}
          {k.hi("M74,50 c2,-6 8,-9 14,-8")}
        </>
      );
    case "curls-long":
      return (
        <>
          {k.base("M66,102 C54,94 52,76 62,68 C54,54 66,38 80,40 C82,26 100,20 110,28 C118,16 138,18 144,28 C158,20 172,32 170,44 C184,46 188,64 178,72 C188,82 182,98 172,102 C174,92 166,86 160,90 C162,76 148,70 140,76 C142,62 126,58 118,64 C110,56 94,60 96,72 C84,66 74,74 80,86 C70,84 64,92 66,102 Z")}
          {k.base("M68,98 C60,110 62,124 70,130 C77,124 77,110 73,102 Z")}
          {k.base("M172,98 C180,110 178,124 170,130 C163,124 163,110 167,102 Z")}
          {k.ln("M88,50 c-4,2 -4,8 0,10")}
          {k.ln("M112,38 c-5,1 -6,7 -1,9")}
          {k.ln("M136,42 c5,1 6,7 1,9")}
          {k.ln("M156,60 c4,3 3,9 -2,10")}
          {k.ln("M100,66 c-4,2 -4,7 0,9")}
          {k.ln("M128,62 c4,2 4,7 0,9")}
          {k.ln("M70,108 c-3,4 -2,10 2,13")}
          {k.ln("M170,110 c3,4 2,10 -2,13")}
          {k.hi("M94,32 c6,-4 14,-4 20,0")}
          {k.hi("M74,52 c2,-6 8,-9 14,-8")}
        </>
      );
    case "mohawk":
      return (
        <>
          {/* shaved-side shadow */}
          <path d="M72,80 C76,58 88,44 102,40 C94,54 90,68 88,84 C82,82 76,81 72,80 Z" fill={shade(c, -0.1)} opacity={0.22} />
          <path d="M168,80 C164,58 152,44 138,40 C146,54 150,68 152,84 C158,82 164,81 168,80 Z" fill={shade(c, -0.1)} opacity={0.22} />
          {k.base("M103,60 C100,44 104,22 111,10 L116,26 L120,5 L124,24 L129,8 L134,22 L139,13 C141,30 140,48 137,60 C126,53 114,53 103,60 Z")}
          {k.sh("M103,60 C112,54 128,54 137,60 C128,56 112,56 103,60 Z")}
          {k.ln("M111,18 C111,32 111,44 110,55")}
          {k.ln("M120,12 C120,28 120,42 119,55")}
          {k.ln("M129,16 C129,30 128,44 127,55")}
          {k.hi("M115,14 C115,28 115,42 114,54")}
          {k.hi("M124,12 C124,28 123,42 122,54")}
        </>
      );
    case "dreads":
      return (
        <>
          {k.base("M62,86 C58,40 90,22 120,22 C150,22 182,40 178,86 C170,64 156,52 140,50 C128,44 112,44 100,50 C84,52 70,64 62,86 Z")}
          {/* front-hanging dreads */}
          {k.base("M86,40 C81,58 79,76 82,94 C85,98 91,98 94,94 C93,76 92,56 96,42 Z")}
          {k.base("M104,32 C100,52 99,74 102,96 C105,100 111,100 114,96 C113,74 113,52 116,34 Z")}
          {k.base("M124,34 C127,52 127,74 126,96 C129,100 135,100 138,96 C141,74 140,52 136,34 Z")}
          {k.base("M144,42 C148,56 149,76 146,94 C149,98 155,98 158,94 C161,76 159,58 154,40 Z")}
          {k.base("M68,58 C62,80 60,102 64,124 C67,128 73,128 76,124 C76,102 74,80 78,60 Z")}
          {k.base("M172,58 C178,80 180,102 176,124 C173,128 167,128 164,124 C164,102 166,80 162,60 Z")}
          {/* twist ticks on the hanging dreads */}
          {k.ln("M84,60 l8,3")}
          {k.ln("M83,76 l8,3")}
          {k.ln("M103,56 l9,3")}
          {k.ln("M102,76 l9,3")}
          {k.ln("M128,56 l9,-2")}
          {k.ln("M128,76 l9,-2")}
          {k.ln("M148,62 l8,-3")}
          {k.ln("M148,78 l8,-3")}
          {k.ln("M66,84 l8,2")}
          {k.ln("M66,104 l8,2")}
          {k.ln("M166,84 l-8,2")}
          {k.ln("M166,104 l-8,2")}
          {k.hi("M108,40 C106,60 106,78 107,92")}
          {k.hi("M130,40 C132,60 132,78 131,92")}
        </>
      );
    case "ponytail":
      return (
        <>
          {k.base("M66,96 C60,44 92,26 120,26 C148,26 180,44 174,96 C170,79 162,71 154,74 C158,56 140,49 120,49 C100,49 82,56 86,74 C78,71 70,79 66,96 Z")}
          {/* taut strands sweeping back toward the tail */}
          {k.ln("M88,42 C104,33 126,32 144,39")}
          {k.ln("M80,58 C96,46 120,42 140,46")}
          {k.ln("M74,76 C88,66 104,60 120,58")}
          {k.hi("M92,38 C108,30 132,30 148,38")}
        </>
      );
    case "bun":
      return (
        <>
          {k.base("M68,94 C62,48 94,32 120,32 C146,32 178,48 172,94 C168,78 160,71 152,74 C155,58 138,52 120,52 C102,52 85,58 88,74 C80,71 72,78 68,94 Z")}
          {k.ln("M92,44 C104,36 136,36 148,44")}
          {k.ln("M84,58 C98,48 142,48 156,58")}
          {k.ln("M78,72 C92,62 148,62 162,72")}
          {k.hi("M96,40 C108,33 132,33 144,40")}
        </>
      );
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

function Eye({ cx, color, t, expr, uid, skin }: { cx: number; color: string; t: Traits; expr: Expression; uid: string; skin: string }) {
  const e = EXPR[expr];
  const top = t.eyeTop + e.top, bot = t.eyeBot + e.bot;
  const my = (top + bot) / 2;
  const cy = my + 1 + e.dy;
  const id = `${uid}-${cx}`;
  const almond = `M${cx - t.eyeW},${my} Q${cx},${top} ${cx + t.eyeW},${my} Q${cx},${bot} ${cx - t.eyeW},${my} Z`;
  const out = cx < 120 ? cx - t.eyeW : cx + t.eyeW;
  const dir = cx < 120 ? -1 : 1;
  const r = t.iris;
  // Iris texture spokes (drawn inside the clip, over the gradient fill).
  const spokes: ReactNode[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    spokes.push(
      <line
        key={i}
        x1={cx + Math.cos(a) * r * 0.42}
        y1={cy + Math.sin(a) * r * 0.42}
        x2={cx + Math.cos(a) * r * 0.92}
        y2={cy + Math.sin(a) * r * 0.92}
        stroke={shade(color, -0.3)}
        strokeWidth={0.9}
        opacity={0.5}
      />
    );
  }
  return (
    <>
      {/* eyelid crease above */}
      <path d={`M${cx - t.eyeW + 2},${top - 4} Q${cx},${top - 8} ${cx + t.eyeW - 2},${top - 4}`} stroke={shade(skin, -0.18)} strokeWidth={1.6} fill="none" strokeLinecap="round" opacity={0.7} />
      <path d={almond} fill="#f8f3ea" stroke={INK} strokeWidth={2} />
      <clipPath id={id}>
        <path d={almond} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        {/* corner shading on the sclera */}
        <ellipse cx={cx - t.eyeW + 2} cy={my} rx={3.5} ry={4} fill={shade(skin, -0.2)} opacity={0.18} />
        <ellipse cx={cx + t.eyeW - 2} cy={my} rx={3.5} ry={4} fill={shade(skin, -0.2)} opacity={0.18} />
        <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-iris)`} />
        {spokes}
        {/* limbal ring */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={shade(color, -0.55)} strokeWidth={1.8} />
        <circle cx={cx} cy={cy} r={r * 0.42} fill="#14101c" />
        {/* lid shadow across the top of the iris */}
        <path d={`M${cx - t.eyeW},${my - 1} Q${cx},${top + 2} ${cx + t.eyeW},${my - 1} L${cx + t.eyeW},${top - 4} L${cx - t.eyeW},${top - 4} Z`} fill={INK} opacity={0.16} />
        {/* double catchlight */}
        <circle cx={cx - r * 0.32} cy={cy - r * 0.55} r={r * 0.24} fill="#fff" opacity={0.95} />
        <circle cx={cx + r * 0.42} cy={cy + r * 0.38} r={r * 0.11} fill="#fff" opacity={0.55} />
      </g>
      <path d={`M${cx - t.eyeW},${my} Q${cx},${top - 1} ${cx + t.eyeW},${my}`} stroke={INK} strokeWidth={t.lashes ? 3 : 2.6} fill="none" strokeLinecap="round" />
      {/* soft lower lash line */}
      <path d={`M${cx - t.eyeW + 3},${my + (bot - my) * 0.75} Q${cx},${bot + 1} ${cx + t.eyeW - 2},${my + (bot - my) * 0.6}`} stroke={INK} strokeWidth={1.1} fill="none" strokeLinecap="round" opacity={0.35} />
      {/* single short wing so small sizes don't read as spider lashes */}
      {t.lashes && (
        <path d={`M${out},${my} q${dir * 4},-1 ${dir * 7},-4`} stroke={INK} strokeWidth={2.2} fill="none" strokeLinecap="round" />
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

  const gender: Gender = character.gender === "female" ? "female" : "male";
  const t = TRAITS[gender];
  const face = FACE[gender][character.faceShape] ?? FACE[gender].oval;
  const expr: Expression = EXPR[character.expression] ? character.expression : "neutral";
  const skin = skinHex(character.skin);
  const skinSh = shade(skin, -0.16), skinLo = shade(skin, -0.28);
  const hairColor = hairHex(character.hairColor);
  const facialHairColor = hairHex(character.facialHairColor);
  const eye = eyeHex(character.eyeColor);
  const outfit = outfitHex(character.outfit);
  const browColor = shade(hairColor, -0.35);
  const lip = mix(skin, "#9c4a44", 0.5);
  const blush = mix(skin, "#d96a5a", 0.5);
  const hairFill = `url(#${uid}-hairg)`;

  return (
    <span
      className={`relative block shrink-0 overflow-hidden ${shape} ${round ? "bg-[#2b1f12]" : ""} ${className}`}
    >
      <svg viewBox="0 0 240 240" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          {round && (
            /* The game's warm brown (home-bg / panel family), darkened at the
               edges so skin + hair still separate against it. */
            <radialGradient id={`${uid}-bg`} cx="50%" cy="36%" r="78%">
              <stop offset="0%" stopColor="#43301e" />
              <stop offset="100%" stopColor="#241710" />
            </radialGradient>
          )}
          {/* soft centre-lit skin so the face reads dimensional */}
          <radialGradient id={`${uid}-skin`} cx="50%" cy="42%" r="72%">
            <stop offset="0%" stopColor={shade(skin, 0.07)} />
            <stop offset="62%" stopColor={skin} />
            <stop offset="100%" stopColor={shade(skin, -0.07)} />
          </radialGradient>
          {/* vertical sheen for every hairstyle */}
          <linearGradient id={`${uid}-hairg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shade(hairColor, 0.14)} />
            <stop offset="45%" stopColor={hairColor} />
            <stop offset="100%" stopColor={shade(hairColor, -0.16)} />
          </linearGradient>
          {/* lit iris: bright core → base → dark rim */}
          <radialGradient id={`${uid}-iris`} cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor={shade(eye, 0.3)} />
            <stop offset="65%" stopColor={eye} />
            <stop offset="100%" stopColor={shade(eye, -0.3)} />
          </radialGradient>
        </defs>
        {round && <rect width={240} height={240} fill={`url(#${uid}-bg)`} />}
        <g transform="translate(120 122) scale(0.92) translate(-120 -120)">
          <Hair style={character.hair} c={hairColor} fill={hairFill} layer="back" />
          <path d={t.shoulder} fill={outfit} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <path d={t.trim} fill={shade(outfit, -0.22)} />
          <path d={t.neck} fill={skin} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <path d={t.neckSh} fill={skinLo} opacity={0.5} />
          <ellipse cx={t.ears[0]} cy={102} rx={t.ears[2]} ry={t.ears[3]} fill={skin} stroke={INK} strokeWidth={3} />
          <ellipse cx={t.ears[1]} cy={102} rx={t.ears[2]} ry={t.ears[3]} fill={skin} stroke={INK} strokeWidth={3} />
          {/* inner-ear contour */}
          <path d={`M${t.ears[0] - 2},97 q-3.5,5 0,10`} stroke={skinLo} strokeWidth={1.6} fill="none" strokeLinecap="round" opacity={0.7} />
          <path d={`M${t.ears[1] + 2},97 q3.5,5 0,10`} stroke={skinLo} strokeWidth={1.6} fill="none" strokeLinecap="round" opacity={0.7} />
          <path d={face.head} fill={`url(#${uid}-skin)`} stroke={INK} strokeWidth={3} />
          <path d={face.cheek} fill={skinSh} opacity={0.45} />
          {/* forehead sheen + soft cheek blush */}
          <path d="M96,58 C104,50 136,50 144,58 C136,54 104,54 96,58 Z" fill="#ffffff" opacity={0.10} />
          <ellipse cx={97} cy={124} rx={9} ry={5.5} fill={blush} opacity={gender === "female" ? 0.30 : 0.16} />
          <ellipse cx={143} cy={124} rx={9} ry={5.5} fill={blush} opacity={gender === "female" ? 0.30 : 0.16} />
          {character.hair === "none" && (
            /* scalp sheen so bald reads deliberate */
            <path d="M92,50 Q120,36 148,50" stroke="#ffffff" strokeWidth={6} strokeLinecap="round" fill="none" opacity={0.10} />
          )}
          <FacialHair style={character.facialHair} color={facialHairColor} layer="beard" />
          <Brows expr={expr} w={t.browW} color={browColor} />
          <Eye cx={100} color={eye} t={t} expr={expr} uid={uid} skin={skin} />
          <Eye cx={140} color={eye} t={t} expr={expr} uid={uid} skin={skin} />
          {/* nose: bridge, base + nostrils, tip light */}
          <path d="M117,106 Q115,116 116,121" stroke={skinLo} strokeWidth={1.8} fill="none" strokeLinecap="round" opacity={0.55} />
          <path d="M113,124 Q120,128.5 127,124" stroke={skinLo} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <path d="M112.5,123 q-2,1.5 -1,3.2" stroke={skinLo} strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.8} />
          <path d="M127.5,123 q2,1.5 1,3.2" stroke={skinLo} strokeWidth={1.5} fill="none" strokeLinecap="round" opacity={0.8} />
          <ellipse cx={120} cy={121} rx={2.4} ry={1.6} fill="#ffffff" opacity={0.14} />
          <Mouth expr={expr} y={t.mouthY} lip={lip} />
          <FacialHair style={character.facialHair} color={facialHairColor} layer="mustache" />
          <Hair style={character.hair} c={hairColor} fill={hairFill} layer="front" />
        </g>
      </svg>
    </span>
  );
}
