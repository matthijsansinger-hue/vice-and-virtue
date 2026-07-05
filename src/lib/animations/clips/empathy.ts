// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Empathy Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const FW = 1920, FH = 1080, DURATION = 2.0;
let ctx;

// ── palette (empathy purple) ─────────────────────────────────────────────────
const PURPLE='#7c4bd0', VIOLET='#a06bff', IRIS='#c9a4ff', PERI='#7678ed', CREAM='#ffefc5';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const E = { linear:t=>t, easeInQuad:t=>t*t, easeOutQuad:t=>t*(2-t),
  easeInOutQuad:t=>t<0.5?2*t*t:-1+(4-2*t)*t, easeInCubic:t=>t*t*t, easeOutCubic:t=>(--t)*t*t+1 };
function interp(input, output, ease){ ease=ease||E.linear; return (t)=>{
  if(t<=input[0]) return output[0]; if(t>=input[input.length-1]) return output[output.length-1];
  for(let i=0;i<input.length-1;i++){ if(t>=input[i] && t<=input[i+1]){ const span=input[i+1]-input[i];
    const local=span===0?0:(t-input[i])/span; const ef=Array.isArray(ease)?(ease[i]||E.linear):ease;
    return output[i]+(output[i+1]-output[i])*ef(local); } } return output[output.length-1]; }; }
function lerp(a,b,t){ return a+(b-a)*t; }
function frac(x){ return x-Math.floor(x); }
function radial(c, cx, cy, r, stops){ const g=c.createRadialGradient(cx,cy,0,cx,cy,r); for(const [o,col] of stops) g.addColorStop(o,col); return g; }

// ── timeline (seconds) ──────────────────────────────────────────────────────
const OPENEYE=[0.3,1.15], PULSE=[1.05,1.95], TITLE=[1.15,1.7];
const EX=960, EY=496, EW=300; // eye centre + half-width

function drawEye(c, t){
  const open=interp(OPENEYE,[0,1],E.easeOutCubic)(t);
  const glow=interp([OPENEYE[0]+0.15,PULSE[1]],[0,1],E.easeOutCubic)(t);
  // a subtle breathing blink-settle near full open
  const settle=1 - Math.max(0, Math.sin((t-OPENEYE[1])*3.0))*0.06*(t>OPENEYE[1]?1:0);
  const EH = lerp(3, 150, open) * settle; // aperture half-height

  // outer glow halo on black
  c.save(); c.globalCompositeOperation='screen';
  c.fillStyle=radial(c,EX,EY,560,[[0,`rgba(160,107,255,${0.5*glow})`],[0.45,`rgba(124,75,208,${0.2*glow})`],[1,'rgba(124,75,208,0)']]);
  c.fillRect(EX-580,EY-580,1160,1160); c.restore();

  // almond aperture
  c.save();
  c.beginPath();
  c.moveTo(EX-EW,EY);
  c.quadraticCurveTo(EX,EY-EH, EX+EW,EY);
  c.quadraticCurveTo(EX,EY+EH, EX-EW,EY);
  c.closePath();
  c.save(); c.clip();

  // dark violet sclera
  c.fillStyle='#140c24'; c.fillRect(EX-EW,EY-EH-10,EW*2,EH*2+20);
  c.fillStyle=radial(c,EX,EY,EW,[[0,'#221544'],[1,'#0c0718']]); c.fillRect(EX-EW,EY-EH-10,EW*2,EH*2+20);

  // iris
  const ir=132;
  c.fillStyle=radial(c,EX,EY-6,ir,[[0,IRIS],[0.35,VIOLET],[0.72,PURPLE],[1,'#341a64']]);
  c.beginPath(); c.arc(EX,EY,ir,0,Math.PI*2); c.fill();
  // outer iris ring
  c.lineWidth=5; c.strokeStyle='rgba(60,30,110,0.8)'; c.beginPath(); c.arc(EX,EY,ir,0,Math.PI*2); c.stroke();
  // striations
  c.save(); c.globalAlpha=0.55; c.strokeStyle='#e9dcff'; c.lineWidth=1.6;
  for(let i=0;i<40;i++){ const a=i/40*Math.PI*2; const r0=40+((i*37)%9); c.beginPath(); c.moveTo(EX+Math.cos(a)*r0,EY+Math.sin(a)*r0); c.lineTo(EX+Math.cos(a)*(ir-6),EY+Math.sin(a)*(ir-6)); c.stroke(); } c.restore();
  // inner glow ring
  c.save(); c.globalCompositeOperation='screen'; c.strokeStyle=VIOLET; c.lineWidth=6; c.shadowColor=VIOLET; c.shadowBlur=24;
  c.beginPath(); c.arc(EX,EY,ir*0.62,0,Math.PI*2); c.stroke(); c.restore();
  // pupil (constricts on pulse)
  const pr=lerp(58,44,interp(PULSE,[0,1],E.easeOutQuad)(t));
  c.fillStyle='#070310'; c.beginPath(); c.arc(EX,EY,pr,0,Math.PI*2); c.fill();
  c.lineWidth=3; c.strokeStyle='rgba(160,107,255,0.5)'; c.stroke();
  // catch-lights
  c.fillStyle='rgba(255,255,255,0.95)'; c.beginPath(); c.arc(EX-34,EY-30,16,0,Math.PI*2); c.fill();
  c.globalAlpha=0.7; c.beginPath(); c.arc(EX+40,EY+26,9,0,Math.PI*2); c.fill(); c.globalAlpha=1;

  c.restore(); // aperture clip
  // lid rim glow tracing the almond
  c.globalCompositeOperation='screen'; c.globalAlpha=glow*0.9;
  c.strokeStyle=IRIS; c.lineWidth=3.5; c.shadowColor=VIOLET; c.shadowBlur=16;
  c.beginPath(); c.moveTo(EX-EW,EY); c.quadraticCurveTo(EX,EY-EH,EX+EW,EY); c.quadraticCurveTo(EX,EY+EH,EX-EW,EY); c.stroke();
  // upper lash flick at the corners
  c.lineWidth=2.2; c.globalAlpha=glow*0.7;
  c.beginPath(); c.moveTo(EX-EW,EY); c.lineTo(EX-EW-26,EY-6); c.moveTo(EX+EW,EY); c.lineTo(EX+EW+26,EY-6); c.stroke();
  c.restore();
}

function drawPulse(c, t){
  for(let k=0;k<2;k++){
    const p=interp([PULSE[0]+k*0.24, PULSE[1]],[0,1])(t);
    if(p<=0.001||p>=1) continue;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-p)*0.6;
    c.strokeStyle=VIOLET; c.lineWidth=lerp(14,2,p); c.shadowColor=PURPLE; c.shadowBlur=24;
    c.beginPath(); c.arc(EX,EY,lerp(150,860,p),0,Math.PI*2); c.stroke();
    c.restore();
  }
}

function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0;
  // pure black
  ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH);

  // gentle push-in toward the eye
  const e=smooth(clamp(t/DURATION,0,1));
  ctx.save();
  ctx.translate(EX,EY); ctx.scale(lerp(1.0,1.1,e),lerp(1.0,1.1,e)); ctx.translate(-EX,-EY);
  drawEye(ctx, t);
  drawPulse(ctx, t);
  ctx.restore();

  // open from black
  const fadeIn=interp([0,0.1],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "empathy",
  bg: "#000",
  duration: DURATION,
  fadeFromBlack: false,
  video: "/animations/empathy.mp4",
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
