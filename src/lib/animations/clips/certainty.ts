/* eslint-disable @typescript-eslint/no-unused-vars */
// Authored clip (no single handoff source — the handoff shipped Certainty only
// as an interactive prototype). Per Matthijs: Certainty is a card-flip that
// flips from its sigil back to reveal the chosen target's real role card
// (/cards/<role>.png), in the blue starfield + sigil style of the prototype.
// params: { role, roleName, targetName }.
import type { ABApi, ClipAssets, ClipConfig, ClipParams } from "../engine";

const CW = 470; // card width
const CH = 660; // card height
const CX = 960; // card centre x
const CY = 512; // card centre y

type Ctx = CanvasRenderingContext2D;

function roundRectPath(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Faint, twinkling starfield — positions are deterministic (index-derived) so
// they're stable across frames without persisting state.
function drawStars(c: Ctx, t: number) {
  c.save();
  for (let i = 0; i < 90; i++) {
    const x = (((i * 137 + 13) % 100) / 100) * 1920;
    const y = (((i * 79 + 7) % 100) / 100) * 1080;
    const r = 0.4 + (((i * 53) % 100) / 100) * 1.5;
    const a = 0.25 + 0.4 * Math.sin(t * 2.2 + i);
    c.globalAlpha = Math.max(0, a);
    c.fillStyle = "#bcd6ff";
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

// The card back: ornate blue plaque with a 10-point star sigil + eye. `w` is
// the current (flip-squished) visible width.
function drawBack(c: Ctx, w: number) {
  c.save();
  c.scale(w / CW, 1);
  const x = -CW / 2;
  const y = -CH / 2;
  roundRectPath(c, x, y, CW, CH, 26);
  const g = c.createLinearGradient(0, y, 0, y + CH);
  g.addColorStop(0, "#16224e");
  g.addColorStop(1, "#0c1838");
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = "#7db4ff";
  c.shadowColor = "rgba(125,180,255,.5)";
  c.shadowBlur = 24;
  c.stroke();
  c.shadowBlur = 0;
  roundRectPath(c, x + 16, y + 16, CW - 32, CH - 32, 18);
  c.lineWidth = 1.5;
  c.strokeStyle = "#33508f";
  c.stroke();
  // star sigil + eye
  c.translate(0, -36);
  c.strokeStyle = "#eaf2ff";
  c.lineWidth = 5;
  c.lineJoin = "round";
  c.lineCap = "round";
  c.shadowColor = "rgba(125,180,255,.8)";
  c.shadowBlur = 16;
  const pts: [number, number][] = [
    [0, -66], [14, -22], [60, -22], [23, 6], [37, 50],
    [0, 22], [-37, 50], [-23, 6], [-60, -22], [-14, -22],
  ];
  c.beginPath();
  pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
  c.closePath();
  c.stroke();
  c.shadowBlur = 0;
  c.fillStyle = "#7db4ff";
  c.beginPath();
  c.arc(0, -8, 17, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(0, -8, 7, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

// The card front: the revealed role portrait (cover-fit) + frame + name plate.
function drawFront(
  c: Ctx,
  w: number,
  img: HTMLImageElement | undefined,
  roleName: string,
  targetName: string,
) {
  c.save();
  c.scale(w / CW, 1);
  const x = -CW / 2;
  const y = -CH / 2;
  roundRectPath(c, x, y, CW, CH, 26);
  c.save();
  c.clip();
  c.fillStyle = "#0c1838";
  c.fillRect(x, y, CW, CH);
  if (img && img.naturalWidth) {
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = CW / CH;
    let dw = CW;
    let dh = CH;
    let dx = x;
    let dy = y;
    if (ir > cr) {
      dh = CH;
      dw = CH * ir;
      dx = x - (dw - CW) / 2;
    } else {
      dw = CW;
      dh = CW / ir;
      dy = y - (dh - CH) / 2;
    }
    c.drawImage(img, dx, dy, dw, dh);
  }
  const pg = c.createLinearGradient(0, y + CH - 210, 0, y + CH);
  pg.addColorStop(0, "rgba(8,16,40,0)");
  pg.addColorStop(1, "rgba(6,12,30,0.94)");
  c.fillStyle = pg;
  c.fillRect(x, y + CH - 210, CW, 210);
  c.restore();
  // frame
  roundRectPath(c, x, y, CW, CH, 26);
  c.lineWidth = 3;
  c.strokeStyle = "#7db4ff";
  c.shadowColor = "rgba(125,180,255,.55)";
  c.shadowBlur = 26;
  c.stroke();
  c.shadowBlur = 0;
  // name plate
  c.textAlign = "center";
  c.fillStyle = "#fff";
  c.font = "700 48px Cinzel, Georgia, serif";
  c.fillText(roleName, 0, y + CH - 74);
  if (targetName) {
    c.fillStyle = "#bcd6ff";
    c.font = "600 22px Cinzel, Georgia, serif";
    c.fillText(targetName.toUpperCase(), 0, y + CH - 38);
  }
  c.restore();
}

const clip: ClipConfig = {
  name: "certainty",
  bg: "#050a1c",
  poster: 1.7,
  duration: 2.0,
  imagesFor: (p: ClipParams) => ({
    card: `/cards/${(p.role as string) || "certainty"}.png`,
  }),
  draw(c: Ctx, t: number, AB: ABApi, assets: ClipAssets, params: ClipParams) {
    const { interp, E, clamp } = AB;
    const roleName = (params.roleName as string) || "Unknown";
    const targetName = (params.targetName as string) || "";
    const img = assets.card;

    // background + stars
    const g = c.createRadialGradient(960, 410, 0, 960, 410, 1200);
    g.addColorStop(0, "#15214a");
    g.addColorStop(0.55, "#0a1230");
    g.addColorStop(1, "#050a1c");
    c.fillStyle = g;
    c.fillRect(0, 0, 1920, 1080);
    drawStars(c, t);

    // entrance → flip → settle
    const appear = interp([0, 0.25], [0, 1], E.easeOutQuad)(t);
    const rise = interp([0, 0.32], [70, 0], E.easeOutCubic)(t);
    const flip = interp([0.45, 1.05], [0, 1], E.easeInOutCubic)(t); // → 0..180°
    const cosw = Math.cos(flip * Math.PI);
    const visW = Math.max(2, Math.abs(cosw) * CW);
    const settle = interp([1.05, 1.55], [0, 1], E.easeOutBack)(t);
    const scale = 0.9 + 0.1 * appear + settle * 0.02;

    c.save();
    c.globalAlpha = clamp(appear, 0, 1);
    c.translate(CX, CY + rise);
    c.scale(scale, scale);

    // reveal glow behind the flipped (front) face
    if (cosw < 0) {
      const rg = c.createRadialGradient(0, 0, 0, 0, 0, 540);
      rg.addColorStop(0, `rgba(125,180,255,${0.35 * settle})`);
      rg.addColorStop(1, "rgba(125,180,255,0)");
      c.save();
      c.globalCompositeOperation = "screen";
      c.fillStyle = rg;
      c.fillRect(-720, -720, 1440, 1440);
      c.restore();
    }

    if (cosw >= 0) drawBack(c, visW);
    else drawFront(c, visW, img, roleName, targetName);
    c.restore();

    // ring pulse at the moment of reveal
    AB.ring(c, CX, CY, interp([1.0, 1.62], [0, 1])(t), "#7db4ff", 80, 540);

    // eyebrow label
    c.save();
    c.globalAlpha = interp([0.05, 0.3, 1.8, 2.0], [0, 1, 1, 0])(t);
    c.textAlign = "center";
    c.fillStyle = "#e3b510";
    c.font = "600 26px Cinzel, Georgia, serif";
    (c as Ctx & { letterSpacing?: string }).letterSpacing = "8px";
    c.fillText("CERTAINTY", 960, 118);
    (c as Ctx & { letterSpacing?: string }).letterSpacing = "0px";
    c.restore();

    // vignette
    const vg = c.createRadialGradient(960, 540, 300, 960, 540, 1250);
    vg.addColorStop(0.4, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(3,6,18,0.85)");
    c.fillStyle = vg;
    c.fillRect(0, 0, 1920, 1080);
  },
};

export default clip;
