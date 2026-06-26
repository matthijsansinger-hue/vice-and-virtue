// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Classified Whisper - Video Export.html".
import type { ClipConfig } from "../engine";

// everything below copied VERBATIM from the source <script>, except:
//   * `const ctx = canvas.getContext('2d')` -> module-level `let ctx;` (set in draw)
//   * removed: canvas lookup, status/record button, load flags, previewLoop,
//     recordVideo/pickMime/onRecord, trailing requestAnimationFrame boot, window.drawFrame
const FW = 1920, FH = 1080, DURATION = 3.0;
let ctx;

// ── palette (Outreach / Action courtyard) ───────────────────────────────────
const COURT = '#c7cbc5', COURT_DEEP = '#8f968a', OLIVE = '#a6a670', BROWN = '#735333',
      FIG = '#241a12', FIG_RIM = '#0f0a06', PARCH = '#f1ead2', INKBAR = '#1b150d',
      BURG = '#800020', CREAM = '#ffefc5';

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const E = {
  linear:t=>t,
  easeInQuad:t=>t*t,
  easeOutQuad:t=>t*(2-t),
  easeInOutQuad:t=>t<0.5?2*t*t:-1+(4-2*t)*t,
  easeInCubic:t=>t*t*t,
  easeOutCubic:t=>(--t)*t*t+1,
  easeOutBack:t=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);},
};
function interp(input, output, ease){
  ease = ease || E.linear;
  return (t)=>{
    if(t<=input[0]) return output[0];
    if(t>=input[input.length-1]) return output[output.length-1];
    for(let i=0;i<input.length-1;i++){
      if(t>=input[i] && t<=input[i+1]){
        const span=input[i+1]-input[i];
        const local=span===0?0:(t-input[i])/span;
        const ef=Array.isArray(ease)?(ease[i]||E.linear):ease;
        return output[i]+(output[i+1]-output[i])*ef(local);
      }
    }
    return output[output.length-1];
  };
}
function lerp(a,b,t){ return a+(b-a)*t; }
function radial(c, cx, cy, r, stops){
  const g=c.createRadialGradient(cx,cy,0,cx,cy,r);
  for(const [o,col] of stops) g.addColorStop(o,col);
  return g;
}

// ── timeline ────────────────────────────────────────────────────────────────
const LEAN=[0.08,0.40], BUBBLE=[0.36,0.50], BARS=0.46, STAMP=[0.58,0.70], GLANCE=[0.66,0.86];
// staged caption (absolute seconds)
const TXT1=[0.85,1.3], TXT2=[1.5,1.85], TXT3=[2.05,2.45];

// ── courtyard backdrop (grey-green + faint brown colonnade) ─────────────────
function drawCourt(c, t){
  c.fillStyle=radial(c, 960, 600, 1300, [[0, COURT],[0.6, '#b3b8ad'],[1, COURT_DEEP]]);
  c.fillRect(0,0,FW,FH);
  // ground band
  c.fillStyle='rgba(115,83,51,0.10)'; c.fillRect(0, FH*0.74, FW, FH*0.26);
  c.strokeStyle='rgba(115,83,51,0.28)'; c.lineWidth=3;
  c.beginPath(); c.moveTo(0, FH*0.74); c.lineTo(FW, FH*0.74); c.stroke();
  // colonnade arches (line-art)
  c.save(); c.strokeStyle='rgba(115,83,51,0.22)'; c.lineWidth=5; c.lineCap='round';
  const archW=300, top=140, spring=430, baseY=FH*0.74;
  for(let x=80; x<FW; x+=archW+40){
    c.beginPath();
    c.moveTo(x, baseY); c.lineTo(x, spring);
    c.arc(x+archW/2, spring, archW/2, Math.PI, 0);
    c.lineTo(x+archW, baseY); c.stroke();
    // pillar shade
    c.save(); c.globalAlpha=0.05; c.fillStyle=BROWN;
    c.fillRect(x-10, spring, 20, baseY-spring); c.fillRect(x+archW-10, spring, 20, baseY-spring);
    c.restore();
  }
  c.restore();
  // soft top light
  c.fillStyle=radial(c, 960, 120, 1100, [[0,'rgba(255,250,230,0.18)'],[1,'rgba(255,250,230,0)']]);
  c.fillRect(0,0,FW,FH);
}

// ── a passerby silhouette drifting behind (they hide from) ──────────────────
function drawPasserby(c, t){
  const x=lerp(-180, FW+180, interp([0,2.7],[0,1],E.linear)(t));
  const y=FH*0.62, s=0.6;
  c.save(); c.globalAlpha=0.18; c.translate(x,y); c.scale(s,s);
  c.fillStyle=BROWN;
  c.beginPath();
  c.moveTo(-120,180); c.lineTo(-140,-330);
  c.quadraticCurveTo(-150,-410,-66,-440); c.lineTo(66,-440);
  c.quadraticCurveTo(150,-410,140,-330); c.lineTo(120,180); c.closePath(); c.fill();
  c.beginPath(); c.arc(0,-540,86,0,Math.PI*2); c.fill();
  c.restore();
}

// ── a conspirator silhouette ────────────────────────────────────────────────
// pivot = hip point (bottom). lean rotates whole body; headTurn rotates head.
function drawFigure(c, {px, py, lean, headTurn, facing, whisper, scale}){
  scale = scale||1;
  c.save();
  c.translate(px, py);
  c.rotate(lean);
  c.scale(scale, scale*1.0);

  // body silhouette
  const body=()=>{
    c.beginPath();
    c.moveTo(-140, 30);
    c.lineTo(-158, -360);
    c.quadraticCurveTo(-168, -448, -78, -480);
    c.lineTo(78, -480);
    c.quadraticCurveTo(168, -448, 158, -360);
    c.lineTo(140, 30);
    c.closePath();
  };
  // rim light (olive) then fill
  c.save();
  c.shadowColor='rgba(0,0,0,0.35)'; c.shadowBlur=30; c.shadowOffsetX=facing*-10; c.shadowOffsetY=6;
  c.lineWidth=8; c.strokeStyle=FIG_RIM; body(); c.stroke();
  c.shadowBlur=0; c.shadowOffsetX=0; c.shadowOffsetY=0;
  c.fillStyle=FIG; body(); c.fill();
  c.restore();
  // olive back-rim on the outward shoulder
  c.save(); c.globalAlpha=0.5; c.lineWidth=4; c.strokeStyle=OLIVE;
  c.beginPath(); c.moveTo(-158*facing*-1*0+ -158, -360); c.restore();

  // raised hand cupping the mouth (whisper gesture)
  if(whisper>0.01){
    c.save(); c.globalAlpha=whisper;
    c.fillStyle=FIG;
    c.beginPath(); c.ellipse(facing*78, -498, 46, 30, facing*-0.5, 0, Math.PI*2); c.fill();
    // forearm
    c.lineWidth=40; c.strokeStyle=FIG; c.lineCap='round';
    c.beginPath(); c.moveTo(facing*150,-300); c.lineTo(facing*86,-486); c.stroke();
    c.restore();
  }

  // head (own rotation for the furtive glance)
  c.save();
  c.translate(0, -560); c.rotate(headTurn);
  c.shadowColor='rgba(0,0,0,0.3)'; c.shadowBlur=22; c.shadowOffsetY=4;
  c.fillStyle=FIG; c.beginPath(); c.arc(0,0,94,0,Math.PI*2); c.fill();
  c.shadowBlur=0; c.shadowOffsetY=0;
  // olive rim on the lit side
  c.globalAlpha=0.45; c.lineWidth=5; c.strokeStyle=OLIVE;
  c.beginPath(); c.arc(0,0,94, facing>0?-2.2:1.0, facing>0?-0.4:2.6); c.stroke();
  c.globalAlpha=1;
  // eye glint, facing partner
  c.fillStyle='rgba(255,239,197,0.85)';
  c.beginPath(); c.arc(facing*42, -8, 6, 0, Math.PI*2); c.fill();
  c.restore();

  c.restore();
}

// ── whisper trail dots between the two heads ────────────────────────────────
function drawWhisperTrail(c, t, ax, ay, bx, by, op){
  if(op<=0.01) return;
  c.save(); c.globalAlpha=op;
  const n=4;
  for(let i=0;i<n;i++){
    const f=(i+0.5)/n;
    const x=lerp(ax,bx,f), y=lerp(ay,by,f)-Math.sin(f*Math.PI)*26;
    const pulse=0.5+0.5*Math.sin(t*18 - i*0.9);
    c.globalAlpha=op*(0.4+0.5*pulse);
    c.fillStyle=CREAM;
    c.beginPath(); c.arc(x,y, 5+i*1.6, 0, Math.PI*2); c.fill();
  }
  c.restore();
}

// ── classified speech bubble ────────────────────────────────────────────────
function drawBubble(c, t){
  const pop=interp([BUBBLE[0], BUBBLE[1]],[0,1],E.easeOutBack)(t);
  if(pop<=0.001) return;
  const cx=960, cy=276, w=520, h=240, r=26;
  const x=cx-w/2, y=cy-h/2;
  c.save();
  c.translate(cx, cy); c.scale(pop, pop); c.translate(-cx, -cy);

  // bubble body
  c.save();
  c.shadowColor='rgba(0,0,0,0.3)'; c.shadowBlur=30; c.shadowOffsetY=10;
  c.fillStyle=PARCH;
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
  // tail toward the gap between heads
  c.beginPath(); c.moveTo(cx-30, y+h-4); c.lineTo(cx+12, y+h+70); c.lineTo(cx+34, y+h-4); c.closePath(); c.fill();
  c.restore();
  c.lineWidth=4; c.strokeStyle=BROWN;
  c.beginPath(); c.roundRect(x, y, w, h, r); c.stroke();

  // header label
  c.font='600 22px Cinzel, serif'; c.textAlign='left'; c.textBaseline='alphabetic';
  c.letterSpacing='6px'; c.fillStyle=BROWN;
  c.fillText('FOR YOUR EARS ONLY', x+38, y+50);
  c.letterSpacing='0px';

  // redaction bars draw in left→right
  const bars=[ [x+38, y+78, w-76], [x+38, y+118, (w-76)*0.82], [x+38, y+158, (w-76)*0.6] ];
  c.fillStyle=INKBAR;
  bars.forEach((b,i)=>{
    const bp=interp([BARS+i*0.05, BARS+i*0.05+0.12],[0,1],E.easeOutCubic)(t);
    if(bp<=0.001) return;
    c.beginPath(); c.roundRect(b[0], b[1], b[2]*bp, 22, 6); c.fill();
  });

  // CLASSIFIED stamp thumps down
  const sOp=interp([STAMP[0], STAMP[0]+0.04],[0,1])(t);
  if(sOp>0.001){
    const sc=interp([STAMP[0], STAMP[0]+0.07, STAMP[1]],[2.4, 0.92, 1.0],E.easeOutCubic)(t);
    c.save(); c.globalAlpha=sOp*0.92;
    c.translate(cx, cy+74); c.rotate(-0.15); c.scale(sc, sc);
    c.lineWidth=5; c.strokeStyle=BURG; c.fillStyle='rgba(128,0,32,0.12)';
    c.beginPath(); c.roundRect(-188, -40, 376, 80, 8); c.fill(); c.stroke();
    c.font='700 44px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
    c.letterSpacing='7px'; c.fillStyle=BURG;
    c.fillText('CLASSIFIED', 4, 2);
    c.letterSpacing='0px';
    c.restore();
  }
  c.restore();
}

// ── staged caption ──────────────────────────────────────────────────────────
function drawCaption(c, t){
  const o1=interp(TXT1,[0,1],E.easeOutCubic)(t);
  const o2=interp(TXT2,[0,1],E.easeOutCubic)(t);
  const o3=interp(TXT3,[0,1],E.easeOutCubic)(t);
  const scrim=Math.max(o1,o2,o3);
  if(scrim<=0.001) return;
  // soft dark pool behind the caption (no hard letterbox over the bright courtyard)
  c.save();
  c.fillStyle=radial(c, 960, 952, 680, [[0,`rgba(10,8,5,${0.62*scrim})`],[0.7,`rgba(10,8,5,${0.34*scrim})`],[1,'rgba(10,8,5,0)']]);
  c.fillRect(0, 620, FW, FH-620);
  c.textAlign='center'; c.textBaseline='middle';
  c.shadowColor='rgba(0,0,0,0.9)'; c.shadowBlur=22;
  c.globalAlpha=o1; c.font='600 52px Cinzel, serif'; c.letterSpacing='3px'; c.fillStyle=CREAM;
  c.fillText('Talk in secret.', 960, 884 + (1-o1)*14);
  c.globalAlpha=o2; c.font='700 62px Cinzel, serif'; c.letterSpacing='3px'; c.fillStyle='#e3b510';
  c.shadowColor='rgba(227,181,16,0.4)'; c.fillText('Lie.', 960, 956 + (1-o2)*14);
  c.shadowColor='rgba(0,0,0,0.9)';
  c.globalAlpha=o3; c.font='600 52px Cinzel, serif'; c.fillStyle=CREAM;
  c.fillText('Test loyalties.', 960, 1028 + (1-o3)*14);
  c.letterSpacing='0px';
  c.restore();
}

// ── master frame ────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowOffsetY=0; ctx.shadowOffsetX=0;

  drawCourt(ctx, t);
  drawPasserby(ctx, t);

  // shadowed nook where they conspire (subtle darken behind figures)
  ctx.save(); ctx.globalAlpha=interp([0.05,0.3],[0,1])(t);
  ctx.fillStyle=radial(ctx, 960, 760, 720, [[0,'rgba(20,12,6,0.32)'],[1,'rgba(20,12,6,0)']]);
  ctx.fillRect(0,0,FW,FH); ctx.restore();

  // lean: figures rotate toward each other (+ gentle held breathing)
  const lean=interp(LEAN,[0,1],E.easeOutCubic)(t);
  const sway=Math.sin(t*1.25)*0.010;
  // furtive glance: right figure checks over its shoulder, then again later
  const glance=interp([GLANCE[0], (GLANCE[0]+GLANCE[1])/2, GLANCE[1]],[0, 0.34, 0.06])(t)
               + Math.max(0, Math.sin(t*1.4-3.0))*0.10;
  const whisper=interp([0.30,0.44],[0,1])(t);

  // left conspirator (faces right, whispers)
  drawFigure(ctx, { px: 690, py: 1180, lean: lean*0.25 + sway, headTurn: lean*0.12, facing: 1, whisper: whisper, scale: 1.0 });
  // right conspirator (faces left, listens then glances away)
  drawFigure(ctx, { px: 1230, py: 1180, lean: -lean*0.25 - sway, headTurn: -lean*0.16 + glance, facing: -1, whisper: 0, scale: 1.0 });

  // whisper trail from left mouth toward right ear (approx head positions after lean)
  const ax=lerp(690, 760, 1) - 30, ay=560;
  drawWhisperTrail(ctx, t, 870, 470, 1060, 470, interp([0.34,0.46,0.92,1.0],[0,1,1,0.6])(t)*(1-clamp((t-STAMP[0])/0.1,0,0.4)));

  drawBubble(ctx, t);

  // gentle vignette
  ctx.fillStyle=radial(ctx,960,540,1200,[[0.5,'rgba(0,0,0,0)'],[1,'rgba(30,22,12,0.55)']]);
  ctx.fillRect(0,0,FW,FH);

  drawCaption(ctx, t);

  // fade in from black
  const fadeIn=interp([0,0.07],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "classified_whisper",
  bg: "#aab0a3",
  duration: 4.0,
  sourceDuration: DURATION,
  fadeFromBlack: false,
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
