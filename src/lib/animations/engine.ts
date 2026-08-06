// ── Vice & Virtue · shared clip engine ──────────────────────────────────────
// Ported from the design handoff's `trailer/ability-fx.js`, minus the page
// chrome and MediaRecorder export (those only existed to record an MP4 in the
// browser). What remains is the pure procedural drawing kit each ability /
// phase clip uses: easing, interpolation, camp palettes and a few canvas
// primitives (figure, grade, ring, motes). Clips render at 1920×1080 and are
// drawn at a time `t` in seconds. The React player lives in
// `src/components/animations/CanvasClip.tsx`.

import { createRig } from "./rig";

export const FW = 1920;
export const FH = 1080;
export const DEFAULT_DURATION = 2.0;

type Ctx = CanvasRenderingContext2D;
type EaseFn = (t: number) => number;
type Stop = [number, string];

// ── math / easing ──────────────────────────────────────────────────────────
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frac = (x: number) => x - Math.floor(x);

// Easing functions — equivalent to the handoff's, written without parameter
// reassignment so the engine itself stays lint-clean.
const E: Record<string, EaseFn> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInQuart: (t) => t * t * t * t,
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  easeInExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

// interp([0,0.5,1],[0,100,50], ease?) -> fn(t). Maps t across the input
// keyframes to the output values with optional per-segment easing.
function interp(
  input: number[],
  output: number[],
  ease?: EaseFn | EaseFn[],
): (t: number) => number {
  const e = ease || E.linear;
  return (t: number) => {
    if (t <= input[0]) return output[0];
    if (t >= input[input.length - 1]) return output[output.length - 1];
    for (let i = 0; i < input.length - 1; i++) {
      if (t >= input[i] && t <= input[i + 1]) {
        const span = input[i + 1] - input[i];
        const local = span === 0 ? 0 : (t - input[i]) / span;
        const ef = Array.isArray(e) ? e[i] || E.linear : e;
        return output[i] + (output[i + 1] - output[i]) * ef(local);
      }
    }
    return output[output.length - 1];
  };
}

// ── canvas helpers ─────────────────────────────────────────────────────────
function radial(c: Ctx, cx: number, cy: number, r: number, stops: Stop[]) {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
function vlin(
  c: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: Stop[],
) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

type CampPalette = {
  key: string;
  deep: string;
  glow: string;
  soft: string;
  bg0: string;
  bg1: string;
};
// Camp palettes (Vice red, Virtue navy/blue, Neutral teal-white).
const CAMP: Record<string, CampPalette> = {
  vice: { key: "#b8001c", deep: "#800020", glow: "#ff5a3c", soft: "#ff8a6a", bg0: "#1a060a", bg1: "#0c0406" },
  virtue: { key: "#2a6fdb", deep: "#0a2a6e", glow: "#7db4ff", soft: "#bcd6ff", bg0: "#0a1230", bg1: "#050818" },
  neutral: { key: "#7fe9d6", deep: "#2a6f66", glow: "#d8fff6", soft: "#bdfff2", bg0: "#0a1a1c", bg1: "#05100f" },
};

const GOLD = "#e3b510";
const WARM = "#ffcf7a";
const CREAM = "#ffefc5";
const FIG = "#050406";
const STEEL = "#e7eef6";

type FigureOpts = {
  x: number;
  base: number;
  s?: number;
  fill?: string;
  female?: boolean;
  alpha?: number;
};
// A standing silhouette (legs / optional skirt / torso / head).
function figure(c: Ctx, o: FigureOpts) {
  const { x, base, s = 1, fill = FIG, female = false, alpha = 1 } = o;
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, base);
  c.scale(s, s);
  c.fillStyle = fill;
  c.beginPath(); c.moveTo(-46, 0); c.lineTo(-34, -200); c.lineTo(-4, -200); c.lineTo(-12, 0); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(12, 0); c.lineTo(4, -200); c.lineTo(34, -200); c.lineTo(46, 0); c.closePath(); c.fill();
  if (female) {
    c.beginPath(); c.moveTo(-52, -150); c.lineTo(-66, -300); c.quadraticCurveTo(0, -320, 66, -300); c.lineTo(52, -150); c.quadraticCurveTo(0, -128, -52, -150); c.closePath(); c.fill();
  }
  c.beginPath(); c.moveTo(-52, -300); c.lineTo(-62, -460); c.quadraticCurveTo(0, -496, 62, -460); c.lineTo(52, -300); c.quadraticCurveTo(0, -322, -52, -300); c.closePath(); c.fill();
  c.beginPath(); c.arc(0, -528, 44, 0, Math.PI * 2); c.fill();
  c.restore();
}

// Common post-grade: warm/camp screen tint + vignette.
function grade(c: Ctx, camp: string, amt = 0.4) {
  const p = CAMP[camp] || CAMP.neutral;
  c.save();
  c.globalCompositeOperation = "screen";
  c.globalAlpha = amt;
  c.fillStyle = radial(c, 960, 520, 1000, [[0, p.key], [1, "rgba(0,0,0,0)"]]);
  c.fillRect(0, 0, FW, FH);
  c.restore();
  c.fillStyle = radial(c, 960, 540, 1240, [[0.42, "rgba(0,0,0,0)"], [1, "rgba(2,1,3,0.9)"]]);
  c.fillRect(0, 0, FW, FH);
}

// Expanding ring pulse.
function ring(c: Ctx, cx: number, cy: number, p: number, col: string, r0: number, r1: number, w0 = 14, w1 = 2) {
  if (p <= 0.001 || p >= 1) return;
  c.save();
  c.globalCompositeOperation = "screen";
  c.globalAlpha = (1 - p) * 0.7;
  c.strokeStyle = col;
  c.lineWidth = lerp(w0, w1, p);
  c.shadowColor = col;
  c.shadowBlur = 24;
  c.beginPath();
  c.arc(cx, cy, lerp(r0, r1, p), 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

// Floating embers / motes.
function motes(c: Ctx, t: number, col: string, n = 20, up = true) {
  c.save();
  c.globalCompositeOperation = "screen";
  for (let i = 0; i < n; i++) {
    const sp = 6 + (i % 5) * 3;
    const life = frac((t * sp) / 100 + ((i * 61) % 100) / 100);
    const x = (((i * 113 + 20) % 100) / 100) * FW + Math.sin(t * 1.1 + i) * 22;
    const y = up ? FH * (1 - life * 0.92) : FH * life * 0.92;
    c.globalAlpha = Math.sin(life * Math.PI) * 0.4;
    c.fillStyle = col;
    c.beginPath();
    c.arc(x, y, 1.3 + (i % 3), 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// The articulated character rig + staging kit (2026 handoff rework) — clips
// destructure `AB.RIG`. Built via a factory so rig.ts needs no engine import.
const RIG = createRig({ lerp, clamp, frac, radial, vlin, CAMP });

// ── public API ───────────────────────────────────────────────────────────--
// The object passed to every clip's draw() as its `AB` argument. Ported clip
// bodies destructure the helpers they need from it, exactly as in the handoff.
export const AB = {
  FW,
  FH,
  DURATION: DEFAULT_DURATION,
  E,
  interp,
  lerp,
  clamp,
  smooth,
  frac,
  radial,
  vlin,
  CAMP,
  GOLD,
  WARM,
  CREAM,
  FIG,
  STEEL,
  figure,
  grade,
  ring,
  motes,
  RIG,
};

export type ABApi = typeof AB;
export type ClipAssets = Record<string, HTMLImageElement>;
export type ClipParams = Record<string, unknown>;

// One animation clip. `draw` paints a single frame at time `t` (seconds, in
// [0, duration]). Shared-engine clips set `fadeFromBlack: true` so the player
// adds the universal open-from-black fade; self-contained clips handle their
// own fades. `images` maps a key to a /public src; the loaded HTMLImageElements
// arrive in `assets` keyed the same way. `params` carries per-play data (e.g.
// Certainty's revealed role).
export type ClipConfig = {
  name: string;
  bg?: string;
  poster?: number;
  duration: number;
  // Pre-rendered recording of this clip (public/ path, e.g.
  // "/animations/wrath.mp4"). When set, CanvasClip plays the video instead of
  // the live canvas draw — weak devices get a smooth clip — and falls back to
  // the canvas draw if the video can't load or play. Recorded from the design
  // handoff's export pages at 1920×1080.
  video?: string;
  // Native timeline length (seconds). When set and shorter than `duration`, the
  // clip plays slower (stretched) to fill `duration`. Defaults to `duration`.
  sourceDuration?: number;
  fadeFromBlack?: boolean;
  images?: Record<string, string>;
  // Per-play dynamic images (merged over `images`) — e.g. Certainty loads
  // /cards/<revealed-role>.png from params. Computed by the player before play.
  imagesFor?: (params: ClipParams) => Record<string, string>;
  draw: (
    c: CanvasRenderingContext2D,
    t: number,
    AB: ABApi,
    assets: ClipAssets,
    params: ClipParams,
  ) => void;
};
