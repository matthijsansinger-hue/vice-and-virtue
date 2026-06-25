// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Envy Ability - Video Export.html".
// Shared-engine clip: the draw body only touches the `AB` helpers, copied as-is.
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "envy",
  bg: "#0c0406",
  poster: 1.55,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const { interp, E, lerp, clamp, radial, figure, grade, ring, motes, CAMP, FIG } = AB;
    const P = CAMP.vice;
    c.fillStyle = radial(c, 960, 480, 1180, [[0, P.bg0], [1, P.bg1]]);
    c.fillRect(0, 0, 1920, 1080);
    motes(c, t, "rgba(255,120,90,0.7)", 14);
    const base = 940, Lx = 680, Rx = 1240;

    const swap = interp([0.45, 1.2], [0, 1], E.easeInOutQuad)(t);
    const ax = lerp(Lx, Rx, swap), bx = lerp(Rx, Lx, swap);
    const frontLeft = swap < 0.5;
    const drawA = () => figure(c, { x: ax, base, s: 0.92, fill: FIG });
    const drawB = () => figure(c, { x: bx, base, s: 0.92, fill: "#2a0a0e" });
    if (frontLeft) { drawB(); drawA(); } else { drawA(); drawB(); }

    const mt = interp([0.5, 1.15], [0, 1], E.easeInOutQuad)(t);
    function mask(x, y, col) {
      c.save(); c.translate(x, y);
      c.fillStyle = col; c.shadowColor = col; c.shadowBlur = 18;
      c.beginPath(); c.moveTo(-42, -32); c.quadraticCurveTo(0, -50, 42, -32); c.quadraticCurveTo(50, 12, 0, 50); c.quadraticCurveTo(-50, 12, -42, -32); c.closePath(); c.fill();
      c.fillStyle = "#1a0608"; c.beginPath(); c.ellipse(-17, -6, 8, 13, 0.2, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(17, -6, 8, 13, -0.2, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#1a0608"; c.beginPath(); c.arc(0, 22, 12, 0, Math.PI); c.fill();
      c.restore();
    }
    const my = 410, arc = 150;
    mask(lerp(Lx, Rx, mt), my - Math.sin(mt * Math.PI) * arc, "#ff8a6a");
    mask(lerp(Rx, Lx, mt), my + Math.sin(mt * Math.PI) * arc, "#ffcf9a");

    ring(c, 960, 560, interp([1.15, 1.75], [0, 1])(t), P.glow, 60, 440);
    const gl = interp([1.1, 1.45], [0, 1], E.easeOutCubic)(t) * interp([1.7, 1.95], [1, 0])(t);
    if (gl > 0.01) {
      c.save(); c.globalAlpha = clamp(gl, 0, 1); c.globalCompositeOperation = "screen"; c.translate(960, 560);
      c.strokeStyle = P.soft; c.lineWidth = 5; c.lineCap = "round"; c.shadowColor = P.glow; c.shadowBlur = 16;
      c.beginPath(); c.moveTo(-70, -14); c.lineTo(70, -14); c.lineTo(50, -30); c.moveTo(70, -14); c.lineTo(50, 2); c.stroke();
      c.beginPath(); c.moveTo(70, 22); c.lineTo(-70, 22); c.lineTo(-50, 6); c.moveTo(-70, 22); c.lineTo(-50, 38); c.stroke();
      c.restore();
    }
    grade(c, "vice", 0.34);
  },
};

export default clip;
