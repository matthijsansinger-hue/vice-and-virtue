"use client";

// Soul Fragment opening cinematic — the hub's forced fragment popup.
//
// Ported from the design handoff "Soul Shard Reveal - Interactive". Unlike the
// earlier fixed-stage version, this one is a full-viewport DOM/CSS animation
// with one canvas for the starfield + particle work, so it's naturally
// responsive on any aspect ratio (no portrait/landscape stage swap).
//
// Flow: idle floating shard -> click -> strain + cracks + inward suck ->
// shatter (canvas fragments/sparks/shockwaves) -> white flash -> tint to the
// rarity colour -> rarity name -> reward panel -> click to continue.
//
// Rarity is DATA: it only swaps the colour wash, the ring/spark intensity and
// the reward line. Every open is driven by the authoritative `open_soul_shard`
// RPC, and the component stays mounted until every held fragment is opened.
//
// The reward shows WHAT YOU ACTUALLY GET rather than a generic badge frame:
// the LP token, the Mano gem, or — for a role unlock — the character's full
// card art, flown in spinning back-side-out so the reveal lands last.

import { useCallback, useEffect, useRef, useState } from "react";
import { ROLES } from "@/lib/roles";
import {
  LE_NAME,
  MANO_NAME,
  SHARD_XP,
  type ShardReward,
  type FragmentRarity,
} from "@/lib/economy";
import { ManoIcon, LifeProficiencyIcon } from "@/components/CurrencyIcons";
import { playWhoosh } from "@/lib/sound";

// ── rarity palette (from the handoff's TIERS) ────────────────────────────────
type Tier = {
  name: string;
  tc: string; // core tier colour (glow)
  tcg: string; // lighter tier colour (rays, rings, the veil tint)
  bg: string;
  bg2: string;
  ink: string; // text colour over the tint veil
  inten: number; // ring / spark count — scales with rarity
};

const TIERS: Record<FragmentRarity, Tier> = {
  earthen: { name: "Earthen", tc: "#a97142", tcg: "#dca86e", bg: "#241608", bg2: "#0e0803", ink: "#241608", inten: 1 },
  verdant: { name: "Verdant", tc: "#3f9d5f", tcg: "#82dc9e", bg: "#0c2314", bg2: "#041108", ink: "#0c2314", inten: 2 },
  primal: { name: "Primal", tc: "#d4542c", tcg: "#ff9563", bg: "#280e05", bg2: "#120502", ink: "#280e05", inten: 3 },
  noble: { name: "Noble", tc: "#7b4bb0", tcg: "#a878dd", bg: "#1c102e", bg2: "#0a0515", ink: "#1c102e", inten: 4 },
  divine: { name: "Divine", tc: "#e3b510", tcg: "#ffe27a", bg: "#2a2004", bg2: "#141002", ink: "#2a2004", inten: 5 },
};

// Card flight = 1.7s, then a .44s squash-flip; the face swaps at its midpoint.
const CARD_FLIP_AT = 1920;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ── canvas particle layer ────────────────────────────────────────────────────
type P = {
  t: "wisp" | "shoot" | "suck" | "frag" | "spark" | "boom" | "wave";
  x: number; y: number; vx?: number; vy?: number; tx?: number; ty?: number;
  age: number; life: number; delay?: number; sw?: number; rot?: number; vr?: number;
  poly?: number[][]; col?: string; cy?: boolean; gold?: boolean;
};

// Diamond shard geometry (viewBox 200x230); the impact point is its core.
const VERTS: number[][] = [[100, 4], [150, 44], [166, 86], [100, 226], [34, 86], [50, 44]];
const IMP: number[] = [100, 90];
const FRAG_COLS = ["#c69cf0", "#9a6ad8", "#7a48c0", "#8a58cc", "#b285e6", "#6a3aa8"];

export function SoulFragmentReveal({
  remaining,
  openOne,
  onAfterOpen,
  onClose,
}: {
  remaining: number;
  openOne: () => Promise<ShardReward>;
  onAfterOpen?: () => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shardRef = useRef<SVGSVGElement>(null);
  const emblemRef = useRef<HTMLDivElement>(null);

  const particles = useRef<P[]>([]);
  const phaseRef = useRef<"idle" | "strain" | "burst" | "reveal" | "reset">("idle");
  const tiltOn = useRef(true);
  const timers = useRef<number[]>([]);

  const [phase, setPhase] = useState<"idle" | "strain" | "burst" | "reveal">("idle");
  const [reward, setReward] = useState<ShardReward | null>(null);
  const [tier, setTier] = useState<Tier>(TIERS.earthen);
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [showReward, setShowReward] = useState(false);
  const [flashState, setFlashState] = useState<"" | "grow" | "tint" | "fade">("");
  const [flashClip, setFlashClip] = useState("circle(0px at 50% 46%)");

  // How many are left to open. Counted from the count we mounted with rather
  // than the live `remaining` prop: the server decrements on every open and
  // onAfterOpen refreshes the parent, so reading the prop AND decrementing
  // locally would burn two fragments per open.
  const initialRef = useRef(remaining);
  const [opened, setOpened] = useState(0);
  const left = Math.max(0, Math.max(initialRef.current, remaining) - opened);

  const reduced =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ── starfield + particles ──────────────────────────────────────────────────
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;

    let W = 0, H = 0, raf = 0;
    let stars: { x: number; y: number; r: number; ph: number; sp: number; b: boolean }[] = [];

    const resize = () => {
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * DPR; cv.height = H * DPR;
      cv.style.width = W + "px"; cv.style.height = H + "px";
      cx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const n = Math.round((W * H) / 9000);
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() < 0.85 ? 0.4 + Math.random() * 0.9 : 1.2 + Math.random() * 0.9,
        ph: Math.random() * 7, sp: 0.4 + Math.random() * 1.4, b: Math.random() < 0.18,
      }));
    };
    resize();
    window.addEventListener("resize", resize);

    let last = performance.now();
    let nextShoot = last + rnd(1200, 4000);

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      cx.clearRect(0, 0, W, H);

      for (const st of stars) {
        const tw = 0.22 + 0.6 * Math.max(0, Math.sin(now * 0.001 * st.sp + st.ph));
        cx.globalAlpha = tw;
        cx.fillStyle = st.b ? "#bcd6ff" : "#ffffff";
        if (st.r > 1.1) { cx.shadowColor = "rgba(190,215,255,.9)"; cx.shadowBlur = 6; }
        cx.beginPath(); cx.arc(st.x, st.y, st.r, 0, 7); cx.fill();
        cx.shadowBlur = 0;
      }

      if (now > nextShoot && !reduced) {
        nextShoot = now + rnd(2500, 7000);
        const fromL = Math.random() < 0.5;
        particles.current.push({
          t: "shoot", x: fromL ? rnd(-40, W * 0.3) : rnd(W * 0.7, W + 40), y: rnd(0, H * 0.45),
          vx: (fromL ? 1 : -1) * rnd(650, 1100), vy: rnd(180, 380), age: 0, life: rnd(0.7, 1.1),
        });
      }

      // Ambient energy bleeding off the idle shard.
      if (phaseRef.current === "idle" && !reduced && Math.random() < dt * 9 && shardRef.current) {
        const r = shardRef.current.getBoundingClientRect();
        const a = rnd(0, Math.PI * 2);
        particles.current.push({
          t: "wisp",
          x: r.left + r.width * (0.5 + Math.cos(a) * 0.42),
          y: r.top + r.height * (0.5 + Math.sin(a) * 0.44),
          vx: rnd(-14, 14), vy: rnd(-46, -20), sw: rnd(0, 7), age: 0, life: rnd(1.2, 2.2),
          cy: Math.random() < 0.6,
        });
      }

      const P_ = particles.current;
      for (let i = P_.length - 1; i >= 0; i--) {
        const p = P_[i];
        if (p.t === "suck" && (p.delay ?? 0) > 0) { p.delay = (p.delay ?? 0) - dt; continue; }
        p.age += dt;
        if (p.age > p.life) { P_.splice(i, 1); continue; }
        const k = p.age / p.life;

        if (p.t === "wisp") {
          p.x += ((p.vx ?? 0) + Math.sin(now * 0.003 + (p.sw ?? 0)) * 16) * dt;
          p.y += (p.vy ?? 0) * dt;
          cx.globalAlpha = Math.sin(Math.PI * k) * 0.85;
          cx.fillStyle = p.cy ? "rgba(155,230,246,1)" : "rgba(216,180,255,1)";
          cx.shadowColor = p.cy ? "rgba(125,224,240,.9)" : "rgba(168,120,221,.9)";
          cx.shadowBlur = 8;
          cx.beginPath(); cx.arc(p.x, p.y, 1.6 + 1.2 * (1 - k), 0, 7); cx.fill();
          cx.shadowBlur = 0;
        } else if (p.t === "shoot") {
          p.x += (p.vx ?? 0) * dt; p.y += (p.vy ?? 0) * dt;
          const al = Math.sin(Math.PI * k);
          const tx = p.x - (p.vx ?? 0) * 0.11, ty = p.y - (p.vy ?? 0) * 0.11;
          const g = cx.createLinearGradient(p.x, p.y, tx, ty);
          g.addColorStop(0, `rgba(255,255,255,${0.9 * al})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          cx.strokeStyle = g; cx.lineWidth = 1.6; cx.globalAlpha = 1;
          cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(tx, ty); cx.stroke();
          cx.globalAlpha = al; cx.fillStyle = "#fff";
          cx.beginPath(); cx.arc(p.x, p.y, 1.4, 0, 7); cx.fill();
        } else if (p.t === "suck") {
          const e = 1 - Math.pow(1 - k, 3);
          p.x += ((p.tx ?? p.x) - p.x) * e * 0.35;
          p.y += ((p.ty ?? p.y) - p.y) * e * 0.35;
          cx.globalAlpha = (1 - k) * 0.9;
          cx.fillStyle = "rgba(191,242,255,1)";
          cx.beginPath(); cx.arc(p.x, p.y, 2.2 * (1 - k) + 0.6, 0, 7); cx.fill();
        } else if (p.t === "frag") {
          p.vy = (p.vy ?? 0) + 880 * dt;
          p.vx = (p.vx ?? 0) * (1 - 1.4 * dt);
          p.vy = p.vy * (1 - 0.4 * dt);
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.rot = (p.rot ?? 0) + (p.vr ?? 0) * dt;
          cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot);
          cx.globalAlpha = k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
          cx.fillStyle = p.col ?? "#fff";
          cx.strokeStyle = "rgba(255,255,255,.65)"; cx.lineWidth = 1;
          cx.shadowColor = "rgba(168,120,221,.9)"; cx.shadowBlur = 14;
          const poly = p.poly!;
          cx.beginPath(); cx.moveTo(poly[0][0], poly[0][1]);
          cx.lineTo(poly[1][0], poly[1][1]); cx.lineTo(poly[2][0], poly[2][1]);
          cx.closePath(); cx.fill(); cx.stroke(); cx.restore();
        } else if (p.t === "spark") {
          p.vy = (p.vy ?? 0) + (p.gold ? 540 : 760) * dt;
          p.vx = (p.vx ?? 0) * (1 - 1.1 * dt);
          p.x += p.vx * dt; p.y += p.vy * dt;
          cx.globalAlpha = 1 - k;
          cx.strokeStyle = p.cy ? "rgba(125,224,240,1)" : "rgba(255,220,130,1)";
          cx.lineWidth = p.gold ? 2 : 1.6;
          cx.beginPath(); cx.moveTo(p.x, p.y);
          cx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); cx.stroke();
        } else if (p.t === "boom") {
          const e = 1 - Math.pow(1 - k, 3);
          const r = Math.max(2, e * Math.max(W, H) * 0.85);
          const g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, `rgba(255,255,255,${1 - k * 0.5})`);
          g.addColorStop(0.45, `rgba(226,200,255,${0.8 * (1 - k)})`);
          g.addColorStop(0.75, `rgba(150,110,230,${0.4 * (1 - k)})`);
          g.addColorStop(1, "rgba(150,110,230,0)");
          cx.globalAlpha = 1; cx.fillStyle = g;
          cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.fill();
        } else if (p.t === "wave") {
          if (p.age < 0) continue;
          const r = k * Math.max(W, H) * 0.32;
          cx.globalAlpha = (1 - k) * 0.85;
          cx.strokeStyle = "rgba(255,255,255,1)";
          cx.lineWidth = Math.max(1, 11 * (1 - k));
          cx.beginPath(); cx.arc(p.x, p.y, r, 0, 7); cx.stroke();
        }
      }
      cx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);

  // ── parallax tilt ──────────────────────────────────────────────────────────
  const tiltRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let tx = 0, ty = 0, cx2 = 0, cy2 = 0, raf = 0;
    const move = (e: PointerEvent) => {
      if (!tiltOn.current) return;
      tx = (e.clientX / window.innerWidth - 0.5) * 12;
      ty = (e.clientY / window.innerHeight - 0.5) * -12;
    };
    window.addEventListener("pointermove", move);
    const tl = () => {
      cx2 += (tx - cx2) * 0.06; cy2 += (ty - cy2) * 0.06;
      if (tiltRef.current) {
        tiltRef.current.style.transform = `rotateY(${cx2}deg) rotateX(${cy2}deg)`;
      }
      raf = requestAnimationFrame(tl);
    };
    raf = requestAnimationFrame(tl);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", move); };
  }, []);

  // ── particle emitters ──────────────────────────────────────────────────────
  const suck = (cxp: number, cyp: number) => {
    for (let i = 0; i < (reduced ? 10 : 26); i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(150, 300);
      particles.current.push({
        t: "suck", x: cxp + Math.cos(a) * r, y: cyp + Math.sin(a) * r,
        tx: cxp, ty: cyp, age: 0, life: rnd(0.45, 0.8), delay: rnd(0, 0.35),
      });
    }
  };

  const fountain = (cxp: number, cyp: number) => {
    for (let i = 0; i < (reduced ? 10 : 26); i++) {
      const a = rnd(-Math.PI, 0), sp = rnd(120, 420);
      particles.current.push({
        t: "spark", x: cxp + rnd(-40, 40), y: cyp + rnd(-20, 20),
        vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp - rnd(40, 160),
        age: 0, life: rnd(0.8, 1.5), cy: Math.random() < 0.4, gold: true,
      });
    }
  };

  const shatterAt = (rect: DOMRect): number[] => {
    const sx = rect.width / 200, sy = rect.height / 230, ox = rect.left, oy = rect.top;
    const map = (p: number[]) => [ox + p[0] * sx, oy + p[1] * sy];
    const imp = map(IMP);
    for (let i = 0; i < 6; i++) {
      const A = map(VERTS[i]), B = map(VERTS[(i + 1) % 6]), C = imp;
      const M = [(A[0] + B[0] + C[0]) / 3 + rnd(-6, 6), (A[1] + B[1] + C[1]) / 3 + rnd(-6, 6)];
      [[A, B, M], [B, C, M], [C, A, M]].forEach((tri) => {
        const cxp = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
        const cyp = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        let dx = cxp - imp[0], dy = cyp - imp[1];
        const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
        const sp = rnd(460, 900) * (0.6 + d / 220);
        particles.current.push({
          t: "frag", x: cxp, y: cyp, vx: dx * sp + rnd(-70, 70), vy: dy * sp - rnd(140, 300),
          rot: 0, vr: rnd(-7, 7), age: 0, life: rnd(0.9, 1.3),
          poly: tri.map((p) => [p[0] - cxp, p[1] - cyp]), col: FRAG_COLS[i % 6],
        });
      });
    }
    particles.current.push({ t: "boom", x: imp[0], y: imp[1], age: 0, life: 0.6 });
    particles.current.push({ t: "wave", x: imp[0], y: imp[1], age: 0, life: 0.5 });
    particles.current.push({ t: "wave", x: imp[0], y: imp[1], age: -0.07, life: 0.55 });
    particles.current.push({ t: "wave", x: imp[0], y: imp[1], age: -0.15, life: 0.6 });
    for (let i = 0; i < (reduced ? 18 : 64); i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(300, 1200);
      particles.current.push({
        t: "spark", x: imp[0], y: imp[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 180,
        age: 0, life: rnd(0.5, 1), cy: Math.random() < 0.35,
      });
    }
    return imp;
  };

  // ── the open sequence ──────────────────────────────────────────────────────
  async function breakShard() {
    if (phaseRef.current !== "idle") return;
    phaseRef.current = "strain";
    setPhase("strain");
    tiltOn.current = false;
    try { playWhoosh(900); } catch { /* audio not unlocked yet */ }

    const el = shardRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      suck(r.left + r.width * 0.5, r.top + r.height * 0.42);
    }

    // Ask the server what this fragment actually holds while the shard strains.
    const rewardPromise = openOne();

    after(920, async () => {
      let res: ShardReward;
      try {
        res = await rewardPromise;
      } catch {
        // The open failed — back out cleanly rather than showing a fake reward.
        phaseRef.current = "idle";
        setPhase("idle");
        tiltOn.current = true;
        onClose();
        return;
      }
      if (res.kind === "none") { onClose(); return; }

      const t = TIERS[res.rarity] ?? TIERS.earthen;
      setReward(res);
      setTier(t);
      phaseRef.current = "burst";
      setPhase("burst");
      onAfterOpen?.();

      const el2 = shardRef.current;
      const imp = el2 ? shatterAt(el2.getBoundingClientRect())
                      : [window.innerWidth / 2, window.innerHeight / 2];

      setFlashClip(`circle(0px at ${imp[0]}px ${imp[1]}px)`);
      after(120, () => {
        setFlashState("grow");
        setFlashClip(`circle(150vmax at ${imp[0]}px ${imp[1]}px)`);
      });
      after(1500, () => { setFlashState("tint"); setShowAnnounce(true); });
      after(2900, () => {
        phaseRef.current = "reveal";
        setPhase("reveal");
        setShowAnnounce(false);
        setShowReward(true);
        setFlashState("fade");
        for (let i = 0; i < t.inten; i++) {
          after(300 + i * 240, () => {
            const box = emblemRef.current?.getBoundingClientRect();
            fountain(window.innerWidth / 2, (box?.top ?? window.innerHeight / 2) + 100);
          });
        }
      });
    });
  }

  // Click anywhere on the reward to continue: either the next fragment or out.
  function continueFromReward() {
    if (phaseRef.current !== "reveal") return;
    phaseRef.current = "reset";
    setOpened((n) => n + 1);

    if (left - 1 <= 0) { onClose(); return; }

    // Reset for the next fragment.
    setShowReward(false);
    setReward(null);
    setFlashState("");
    setFlashClip("circle(0px at 50% 46%)");
    particles.current.length = 0;
    tiltOn.current = true;
    phaseRef.current = "idle";
    setPhase("idle");
  }

  const cracking = phase === "strain" || phase === "burst";
  const shardHidden = phase === "burst" || phase === "reveal";

  return (
    <div
      className="fixed inset-0 z-[200] overflow-hidden select-none"
      style={{
        fontFamily: "Cinzel, Georgia, serif",
        color: "var(--color-cream)",
        background:
          "radial-gradient(120vmax 90vmax at 50% 42%,#0a1226 0%,#060b1a 46%,#02040c 100%)",
      }}
      onPointerDown={showReward ? continueFromReward : undefined}
    >
      <style>{fragmentCss}</style>

      <div className="vvfog" id="vvfogA" />
      <div className="vvfog" id="vvfogB" />
      <canvas ref={canvasRef} className="fixed inset-0" style={{ zIndex: 1 }} />

      {/* ── scene: the shard ── */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 2, opacity: shardHidden ? 0 : 1, transition: "opacity .45s ease" }}
      >
        <div className="vvstage">
          <div ref={tiltRef} style={{ transformStyle: "preserve-3d", willChange: "transform" }}>
            <div className="vvbob" style={{ animationPlayState: cracking ? "paused" : "running" }}>
              <div className={"vvshake" + (cracking ? " on" : "")}>
                <div className="vvhalo" />
                <svg
                  ref={shardRef}
                  className={"vvshard" + (cracking ? " cracking" : "")}
                  viewBox="0 0 200 230"
                  onClick={breakShard}
                  aria-label="Soul fragment — click to break it open"
                >
                  <defs>
                    <linearGradient id="vvf1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c69cf0" /><stop offset="1" stopColor="#7a4fc0" /></linearGradient>
                    <linearGradient id="vvf2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9a6ad8" /><stop offset="1" stopColor="#5a2f98" /></linearGradient>
                    <linearGradient id="vvf3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a48c0" /><stop offset="1" stopColor="#3a1857" /></linearGradient>
                    <linearGradient id="vvf4" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a58cc" /><stop offset="1" stopColor="#41206a" /></linearGradient>
                    <linearGradient id="vvf5" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor="#b285e6" /><stop offset="1" stopColor="#6a3aa8" /></linearGradient>
                    <radialGradient id="vvcoreG" cx=".5" cy=".5" r=".5">
                      <stop offset="0" stopColor="#ffffff" /><stop offset=".35" stopColor="#bff2ff" /><stop offset="1" stopColor="rgba(125,224,240,0)" />
                    </radialGradient>
                    <clipPath id="vvshardClip"><polygon points="100,4 150,44 166,86 100,226 34,86 50,44" /></clipPath>
                  </defs>
                  <g clipPath="url(#vvshardClip)">
                    <polygon points="100,4 150,44 100,90" fill="url(#vvf1)" />
                    <polygon points="150,44 166,86 100,90" fill="url(#vvf5)" />
                    <polygon points="166,86 100,226 100,90" fill="url(#vvf4)" />
                    <polygon points="100,226 34,86 100,90" fill="url(#vvf3)" />
                    <polygon points="34,86 50,44 100,90" fill="url(#vvf2)" />
                    <polygon points="50,44 100,4 100,90" fill="url(#vvf5)" />
                    <polygon points="100,4 126,25 100,90" fill="rgba(255,255,255,.12)" />
                    <polygon points="100,226 76,140 100,90" fill="rgba(0,0,0,.18)" />
                    <g stroke="rgba(255,255,255,.16)" strokeWidth="1.4" fill="none">
                      <line x1="100" y1="4" x2="100" y2="90" /><line x1="150" y1="44" x2="100" y2="90" />
                      <line x1="166" y1="86" x2="100" y2="90" /><line x1="100" y1="226" x2="100" y2="90" />
                      <line x1="34" y1="86" x2="100" y2="90" /><line x1="50" y1="44" x2="100" y2="90" />
                      <line x1="50" y1="44" x2="150" y2="44" stroke="rgba(255,255,255,.10)" />
                      <line x1="34" y1="86" x2="166" y2="86" stroke="rgba(255,255,255,.10)" />
                    </g>
                    <ellipse cx="100" cy="96" rx="46" ry="66" fill="url(#vvcoreG)" opacity=".5">
                      <animate attributeName="opacity" values=".34;.72;.34" dur="2.6s" repeatCount="indefinite" />
                      <animate attributeName="ry" values="62;78;62" dur="2.6s" repeatCount="indefinite" />
                      <animate attributeName="rx" values="42;52;42" dur="2.6s" repeatCount="indefinite" />
                    </ellipse>
                    <ellipse className="vvcore" cx="100" cy="90" rx="80" ry="110" fill="url(#vvcoreG)" opacity="0" />
                    <g className="vvglint">
                      <rect x="-60" y="-20" width="56" height="270" fill="rgba(255,255,255,.22)" />
                      <rect x="4" y="-20" width="14" height="270" fill="rgba(255,255,255,.30)" />
                    </g>
                    <g className="vvleak" stroke="rgba(255,255,255,.95)" strokeWidth="7" fill="none" opacity="0">
                      <path d="M100 90 L101 46 L100 4" /><path d="M100 90 L128 64 L150 44" />
                      <path d="M100 90 L136 88 L166 86" /><path d="M100 90 L102 160 L100 226" />
                      <path d="M100 90 L64 90 L34 86" /><path d="M100 90 L72 65 L50 44" />
                    </g>
                  </g>
                  <g stroke="rgba(255,250,255,.96)" fill="none" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 5px rgba(255,240,220,.9))" }}>
                    {[
                      ["M100 90 L96 48 L100 4", 2.6, 0.04], ["M100 90 L130 62 L150 44", 2.6, 0.10],
                      ["M100 90 L138 92 L166 86", 2.6, 0.16], ["M100 90 L106 162 L100 226", 2.6, 0.22],
                      ["M100 90 L62 94 L34 86", 2.6, 0.28], ["M100 90 L70 62 L50 44", 2.6, 0.32],
                      ["M96 48 L82 38", 1.5, 0.38], ["M106 162 L122 152", 1.5, 0.44], ["M62 94 L54 108", 1.5, 0.5],
                    ].map(([d, w, delay], i) => (
                      <path key={i} className="vvcrack" pathLength={1} strokeWidth={w as number}
                            d={d as string} style={{ animationDelay: `${delay}s` }} />
                    ))}
                  </g>
                  <polygon points="100,4 150,44 166,86 100,226 34,86 50,44" fill="none"
                           stroke="var(--color-gold)" strokeWidth="3" strokeLinejoin="round" opacity=".95" />
                </svg>
                <div className="vvorb" style={{ animationDuration: "9s" }}><div className="vvmote" style={{ transform: "translate(112px,-10px)" }} /></div>
                <div className="vvorb" style={{ animationDuration: "13s", animationDirection: "reverse" }}><div className="vvmote" style={{ transform: "translate(-126px,26px)", width: 3, height: 3 }} /></div>
                <div className="vvorb" style={{ animationDuration: "17s" }}><div className="vvmote" style={{ transform: "translate(30px,146px)", width: 4, height: 4, background: "#bff2ff", boxShadow: "0 0 10px 2px rgba(125,224,240,.8)" }} /></div>
                <div className="vvorb" style={{ animationDuration: "7s", animationDirection: "reverse" }}><div className="vvmote" style={{ transform: "translate(88px,60px)", width: 3, height: 3, background: "#bff2ff", boxShadow: "0 0 8px 2px rgba(125,224,240,.8)" }} /></div>
              </div>
            </div>
          </div>
        </div>

        <div className={"vvprompt" + (phase !== "idle" ? " gone" : "")}>
          <div className="eyebrow">Soul Fragment</div>
          <div className="hint">Tap the fragment to break it open</div>
          {left > 1 && <div className="count">{left} to open</div>}
        </div>
      </div>

      {/* ── reward ── */}
      {showReward && reward && reward.kind !== "none" && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 2, ["--tc" as string]: tier.tc, ["--tcg" as string]: tier.tcg,
                   background: `radial-gradient(120vmax 90vmax at 50% 42%, ${tier.bg} 0%, ${tier.bg2} 100%)` }}
        >
          <div
            className="relative text-center"
            style={{ ["--emblemH" as string]: reward.kind === "role" ? "300px" : "200px" }}
          >
            <div className="vvrays" /><div className="vvaura" />
            {Array.from({ length: tier.inten }).map((_, i) => (
              <div key={i} className="vvtring" style={{ animationDelay: `${0.18 + i * 0.17}s` }} />
            ))}

            {/* THE REWARD ITSELF — the icon of what you're actually getting.
                A role unlock instead flies its CARD in from the distance,
                spinning back-side-out so you know a character is coming but not
                which one until it lands. */}
            <div
              ref={emblemRef}
              className={"vvemblem" + (reward.kind === "role" ? " vvemblem-card" : "")}
            >
              <RewardIcon reward={reward} />
            </div>

            {/* For a role the text would spoil the card mid-spin, so its rows
                wait until the card has landed. */}
            <div className={"vvrrow vvline1" + (reward.kind === "role" ? " vvlate" : "")}>
              {rewardLine(reward)}
            </div>
            <div className={"vvrrow vvline2" + (reward.kind === "role" ? " vvlate" : "")}>
              <span className="vvpill">
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M6 0l1.6 4.1L12 4.5 8.7 7.3l1 4.7L6 9.4 2.3 12l1-4.7L0 4.5l4.4-.4z" fill="#7de0f0" />
                </svg>
                <b>+{SHARD_XP}</b>&nbsp;XP
              </span>
            </div>
            <div className={"vvrrow vvline3" + (reward.kind === "role" ? " vvlate" : "")}>
              <span className="vvtap">
                {left > 1 ? `Tap to open the next (${left - 1} left)` : "Tap anywhere to continue"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── rarity name announce ── */}
      {showAnnounce && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 5 }}>
          <div className="vvannName" style={{ color: tier.ink }}>{tier.name}</div>
          {Array.from({ length: tier.inten }).map((_, i) => (
            <div key={i} className="vvannRing" style={{ animationDelay: `${0.35 + i * 0.16}s` }} />
          ))}
          {Array.from({ length: tier.inten * 8 }).map((_, i) => (
            <div key={"s" + i} className="vvspk"
                 style={{ left: `${rnd(6, 94)}%`, top: `${rnd(8, 92)}%`,
                          width: rnd(3, 7), height: rnd(3, 7), animationDelay: `${rnd(0, 0.8)}s` }} />
          ))}
        </div>
      )}

      <div className="vvvign" />
      <div
        className={"vvflash" + (flashState ? " " + flashState : "")}
        style={{ clipPath: flashClip, background: flashState === "tint" || flashState === "fade" ? tier.tcg : "#fff" }}
      />
    </div>
  );
}

// ── the reward icon: what you're actually getting ────────────────────────────
function RewardIcon({ reward }: { reward: ShardReward }) {
  if (reward.kind === "le") return <LifeProficiencyIcon size={168} />;
  if (reward.kind === "mano") return <ManoIcon size={168} />;
  if (reward.kind === "role") return <RoleCardReveal role={reward.role} />;
  return null;
}

// A role unlock flies its full card art in from the distance, spinning on its
// vertical axis. The BACK faces you for most of the spin — you can tell a
// character is coming without knowing which — and the deceleration lands it
// face-up. Full colour art rather than the flat head icon.
function RoleCardReveal({ role }: { role: string }) {
  // The card flies in spinning with its BACK out, then flips to reveal the role.
  //
  // The flip is a scaleX squash with the face swapped at the midpoint, NOT a
  // 3D backface: Chromium ignores `backface-visibility` on an element that
  // clips (an <img> has overflow:clip inherently), which showed the art during
  // the spin and gave the reveal away. A squash needs no backface test and
  // reads exactly like a card turning over.
  const [face, setFace] = useState<"back" | "front">("back");
  useEffect(() => {
    const t = window.setTimeout(() => setFace("front"), CARD_FLIP_AT);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="vvcardPersp">
      <div className="vvcardInner">
        <div className="vvcardSquash">
          {face === "front" ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img className="vvcardFront" src={`/cards/${role}.png`} alt="" />
          ) : (
            <div className="vvcardBack">
              <svg viewBox="0 0 200 230" className="vvcardSigil" aria-hidden>
                <polygon
                  points="100,4 150,44 166,86 100,226 34,86 50,44"
                  fill="rgba(150,90,220,.28)"
                  stroke="#e3b510"
                  strokeWidth="6"
                  strokeLinejoin="round"
                />
                <g stroke="rgba(227,181,16,.55)" strokeWidth="2.5" fill="none">
                  <line x1="100" y1="4" x2="100" y2="90" /><line x1="150" y1="44" x2="100" y2="90" />
                  <line x1="166" y1="86" x2="100" y2="90" /><line x1="100" y1="226" x2="100" y2="90" />
                  <line x1="34" y1="86" x2="100" y2="90" /><line x1="50" y1="44" x2="100" y2="90" />
                </g>
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function rewardLine(reward: ShardReward): string {
  if (reward.kind === "le") return `+${reward.amount} ${LE_NAME}`;
  if (reward.kind === "mano") return `+${reward.amount} ${MANO_NAME}`;
  if (reward.kind === "role") {
    return `${ROLES[reward.role]?.name ?? reward.role} unlocked`;
  }
  return "";
}

// Scoped to this overlay (all class names are vv-prefixed).
const fragmentCss = `
.vvfog{position:fixed;width:70vmax;height:70vmax;border-radius:50%;filter:blur(90px);pointer-events:none;opacity:.55}
#vvfogA{left:-20vmax;top:-24vmax;background:radial-gradient(circle,rgba(96,72,190,.12),transparent 65%);animation:vvfogDrift 26s ease-in-out infinite alternate}
#vvfogB{right:-24vmax;bottom:-28vmax;background:radial-gradient(circle,rgba(64,140,220,.07),transparent 65%);animation:vvfogDrift 32s ease-in-out infinite alternate-reverse}
@keyframes vvfogDrift{from{transform:translate(0,0)}to{transform:translate(6vmax,4vmax)}}
.vvvign{position:fixed;inset:0;z-index:3;pointer-events:none;background:radial-gradient(130% 110% at 50% 45%,transparent 48%,rgba(1,2,6,.55) 82%,rgba(1,2,6,.85) 100%)}
.vvflash{position:fixed;inset:0;z-index:4;pointer-events:none;opacity:0}
.vvflash.grow{opacity:1;transition:clip-path .5s cubic-bezier(.3,0,.6,1)}
.vvflash.tint{opacity:1;transition:background 1s cubic-bezier(.22,1,.36,1)}
.vvflash.fade{opacity:0;transition:opacity 1.1s cubic-bezier(.22,1,.36,1),background 1s cubic-bezier(.22,1,.36,1)}
.vvstage{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);perspective:900px}
.vvbob{animation:vvbob 3.6s ease-in-out infinite}
@keyframes vvbob{0%,100%{transform:translateY(0) rotate(-1.1deg)}50%{transform:translateY(-17px) rotate(1.2deg)}}
.vvshake.on{animation:vvstrain .92s cubic-bezier(.65,0,.35,1) forwards}
@keyframes vvstrain{0%{transform:translate(0,0) rotate(0) scale(.985)}26%{transform:translate(2.5px,-1.5px) rotate(1deg) scale(.99)}54%{transform:translate(4.5px,-2.5px) rotate(1.8deg)}82%{transform:translate(6px,-3.5px) rotate(2.6deg) scale(1.05)}100%{transform:translate(0,0) rotate(0) scale(1.085)}}
.vvhalo{position:absolute;left:50%;top:47%;width:340px;height:400px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(150,90,220,.30),rgba(125,224,240,.07) 55%,transparent 72%);filter:blur(22px);pointer-events:none;animation:vvhaloPulse 2.8s ease-in-out infinite}
@keyframes vvhaloPulse{0%,100%{opacity:.6;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.14)}}
.vvshard{width:min(230px,24vh);height:auto;display:block;cursor:pointer;overflow:visible;animation:vvshardGlow 2.8s ease-in-out infinite}
@keyframes vvshardGlow{0%,100%{filter:drop-shadow(0 0 22px rgba(150,90,220,.5)) drop-shadow(0 10px 55px rgba(123,75,176,.3))}50%{filter:drop-shadow(0 0 40px rgba(178,120,245,.85)) drop-shadow(0 0 90px rgba(125,224,240,.35))}}
.vvcrack{stroke-dasharray:1;stroke-dashoffset:1}
.vvshard.cracking .vvcrack{animation:vvcrackDraw .42s cubic-bezier(.22,1,.36,1) forwards}
@keyframes vvcrackDraw{to{stroke-dashoffset:0}}
.vvshard.cracking .vvleak{animation:vvleakIn .82s cubic-bezier(.65,0,.35,1) forwards}
@keyframes vvleakIn{0%{opacity:0}55%{opacity:.45}100%{opacity:1}}
.vvshard.cracking .vvcore{animation:vvcoreHot .9s cubic-bezier(.65,0,.35,1) forwards}
@keyframes vvcoreHot{to{opacity:1}}
.vvglint{animation:vvglintSweep 4.6s ease-in-out infinite}
@keyframes vvglintSweep{0%,64%,100%{transform:translateX(-260px) skewX(-18deg)}80%{transform:translateX(260px) skewX(-18deg)}}
.vvmote{position:absolute;left:50%;top:50%;width:5px;height:5px;border-radius:50%;background:#ffe9a8;box-shadow:0 0 10px 2px rgba(255,220,130,.75);pointer-events:none}
.vvorb{position:absolute;left:50%;top:50%;width:0;height:0;animation:vvorbit linear infinite;pointer-events:none}
@keyframes vvorbit{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.vvprompt{position:absolute;left:50%;top:calc(46% + min(230px,24vh)*.92);transform:translateX(-50%);text-align:center;white-space:nowrap;transition:opacity .3s ease}
.vvprompt .eyebrow{font-size:13px;font-weight:700;letter-spacing:.5em;color:var(--color-gold);text-transform:uppercase;margin-bottom:10px}
.vvprompt .hint{font-size:16px;letter-spacing:.14em;color:rgba(255,239,197,.85);animation:vvhintPulse 2.6s ease-in-out infinite}
.vvprompt .count{margin-top:10px;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:rgba(255,239,197,.5)}
@keyframes vvhintPulse{0%,100%{opacity:.55}50%{opacity:1}}
.vvprompt.gone{opacity:0}
.vvrays{position:absolute;left:50%;top:calc(var(--emblemH,200px)/2);width:440px;height:440px;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;background:repeating-conic-gradient(from 0deg,color-mix(in oklab,var(--tcg) 24%,transparent) 0deg 8deg,transparent 8deg 24deg);-webkit-mask:radial-gradient(circle,#000 16%,transparent 66%);mask:radial-gradient(circle,#000 16%,transparent 66%);animation:vvraysSpin 18s linear infinite}
@keyframes vvraysSpin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}
.vvaura{position:absolute;left:50%;top:calc(var(--emblemH,200px)/2);width:350px;height:350px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,color-mix(in oklab,var(--tcg) 45%,transparent),transparent 68%);filter:blur(14px);pointer-events:none;animation:vvauraPulse 3.2s ease-in-out infinite}
@keyframes vvauraPulse{0%,100%{opacity:.5;transform:translate(-50%,-50%) scale(1)}50%{opacity:.9;transform:translate(-50%,-50%) scale(1.07)}}
.vvemblem{width:200px;height:var(--emblemH,200px);margin:0 auto;display:flex;align-items:center;justify-content:center;animation:vvmedalPop .9s cubic-bezier(.34,1.56,.64,1) both;animation-delay:.12s;filter:drop-shadow(0 0 38px color-mix(in oklab,var(--tc) 85%,transparent))}
@keyframes vvmedalPop{0%{opacity:0;transform:scale(2.6) rotate(-14deg);filter:blur(16px)}55%{filter:blur(0)}78%{transform:scale(.94) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
/* A role card brings its own entrance, so the medallion pop is dropped. */
.vvemblem-card{animation:none;filter:none}
/* ---- role card: spins in from the distance, back-side-out, then flips ---- */
.vvcardPersp{perspective:1300px;width:200px;height:300px}
.vvcardInner{position:relative;width:100%;height:100%;animation:vvcardFly 1.7s cubic-bezier(.14,.72,.22,1) both}
@keyframes vvcardFly{
  0%{opacity:0;transform:translateZ(-1600px) rotateY(0deg)}
  7%{opacity:1}
  100%{opacity:1;transform:translateZ(0) rotateY(1080deg)}
}
/* Squash to edge-on and back; the face is swapped at the midpoint. */
.vvcardSquash{width:100%;height:100%;animation:vvcardSquash .44s ease-in-out 1.7s both}
@keyframes vvcardSquash{0%{transform:scaleX(1)}50%{transform:scaleX(.04)}100%{transform:scaleX(1)}}
.vvcardFront{width:100%;height:100%;object-fit:cover;border-radius:14px;box-shadow:0 0 34px color-mix(in oklab,var(--tc) 70%,transparent),0 10px 40px rgba(0,0,0,.55)}
.vvcardBack{width:100%;height:100%;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#2a1a4e 0%,#150c2b 60%,#0b0618 100%);border:3px solid var(--color-gold);box-shadow:0 0 34px rgba(150,90,220,.55),0 10px 40px rgba(0,0,0,.55)}
.vvcardSigil{width:64%;height:64%;filter:drop-shadow(0 0 12px rgba(178,120,245,.75))}
/* Text would spoil the card mid-spin, so it waits for the landing. */
.vvlate.vvline1{animation-delay:2.25s}
.vvlate.vvline2{animation-delay:2.38s}
.vvlate.vvline3{animation-delay:2.65s}
.vvtring{position:absolute;left:50%;top:calc(var(--emblemH,200px)/2);width:200px;height:200px;transform:translate(-50%,-50%);border-radius:50%;border:3px solid var(--tcg);pointer-events:none;opacity:0;animation:vvtierRing 1s cubic-bezier(.22,1,.36,1) both}
@keyframes vvtierRing{0%{opacity:.9;transform:translate(-50%,-50%) scale(.8)}100%{opacity:0;transform:translate(-50%,-50%) scale(3.6)}}
.vvannName{font-size:min(11vw,96px);font-weight:800;letter-spacing:.14em;text-transform:uppercase;text-shadow:0 3px 40px rgba(0,0,0,.3);animation:vvnameSettle .75s cubic-bezier(.22,1,.36,1) both}
@keyframes vvnameSettle{from{opacity:0;letter-spacing:.42em;transform:translateY(12px)}to{opacity:1;letter-spacing:.14em;transform:none}}
.vvannRing{position:absolute;left:50%;top:50%;width:220px;height:220px;transform:translate(-50%,-50%);border-radius:50%;border:3px solid rgba(0,0,0,.25);pointer-events:none;opacity:0;animation:vvtierRing 1.1s cubic-bezier(.22,1,.36,1) both}
.vvspk{position:absolute;border-radius:50%;background:#fff;box-shadow:0 0 12px 3px rgba(255,255,255,.8);animation:vvspkTw .9s ease-in-out infinite alternate}
@keyframes vvspkTw{from{opacity:.15;transform:scale(.6)}to{opacity:1;transform:scale(1.15)}}
.vvrrow{opacity:0;animation:vvriseIn .6s cubic-bezier(.22,1,.36,1) forwards}
@keyframes vvriseIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.vvline1{font-family:var(--font-geist-sans),'Segoe UI',sans-serif;font-size:19px;letter-spacing:.04em;color:var(--color-cream);margin-top:18px;animation-delay:.55s}
.vvline2{margin-top:10px;animation-delay:.68s}
.vvpill{display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border-radius:999px;font-family:var(--font-geist-sans),'Segoe UI',sans-serif;font-size:13px;background:rgba(0,0,0,.35);border:1px solid rgba(125,224,240,.5);color:#7de0f0;box-shadow:inset 0 1px 0 rgba(255,239,197,.1)}
.vvline3{margin-top:34px;animation-delay:.95s}
.vvtap{font-size:13px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:rgba(255,239,197,.7);animation:vvhintPulse 2.2s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.vvbob,.vvglint,.vvorb,.vvrays,.vvaura,.vvhalo,.vvprompt .hint{animation:none !important}}
`;
