// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Clues Gathered - Video Export.html".
import type { ClipConfig } from "../engine";

// everything below copied VERBATIM from the source <script>, except:
//   * `const ctx = canvas.getContext('2d')` -> module-level `let ctx;` (set in draw)
//   * removed: canvas lookup, status/record button, load flags, previewLoop,
//     recordVideo/pickMime/onRecord, trailing requestAnimationFrame boot, window.drawFrame
const FW = 1920, FH = 1080, DURATION = 1.0;
let ctx;

// ── palette (Reflection / minigame phase) ───────────────────────────────────
const BG = '#372155', BG_DEEP = '#150d2e', PERI = '#7678ed', PERI_HI = '#b9bbff',
      CREAM = '#ffefc5', GOLD = '#e3b510';

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const E = {
  linear:t=>t,
  easeInQuad:t=>t*t,
  easeOutQuad:t=>t*(2-t),
  easeInCubic:t=>t*t*t,
  easeOutCubic:t=>(--t)*t*t+1,
  easeOutExpo:t=>t>=1?1:1-Math.pow(2,-10*t),
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

// ── timeline (seconds) ──────────────────────────────────────────────────────
// clue i flies in starting NODE_T[i], travel ~0.14s
const NODE_T = [0.12, 0.22, 0.32, 0.42, 0.52];
const TRAVEL = 0.16;
const COMPLETE = NODE_T[4] + TRAVEL; // ~0.68

// ── clue constellation nodes (final positions form a shape in the sky) ──────
// each streaks in from an off-screen direction toward its resting spot
const NODES = [
  { x: 470,  y: 360, from:[-1,-0.4], icon:'eye' },
  { x: 740,  y: 250, from:[-0.4,-1], icon:'key' },
  { x: 1010, y: 330, from:[0,-1],    icon:'foot' },
  { x: 1300, y: 250, from:[1,-1],    icon:'dot' },
  { x: 1180, y: 500, from:[1,0.5],   icon:'ring' },
];
const AVATAR = { x: 960, y: 800, r: 70, name: 'MARA' };

// ── starfield ────────────────────────────────────────────────────────────────
const stars = Array.from({length:90},(_,i)=>({
  x:((i*73+11)%100)/100*FW, y:((i*149+29)%100)/100*FH*0.9,
  r:0.6+((i*53)%100)/100*2.0, tw:0.5+((i*37)%100)/100*2.4, ph:((i*97)%100)/100*6.28,
}));
function drawStars(c, t, op){
  c.save();
  for(const s of stars){
    const a=(0.25+0.55*(0.5+0.5*Math.sin(t*s.tw+s.ph)))*op;
    c.globalAlpha=a; c.fillStyle='#cdd0ff';
    c.beginPath(); c.arc(s.x,s.y,s.r,0,Math.PI*2); c.fill();
  }
  c.restore();
}

// ── a tiny clue glyph (simple primitive shapes only) ────────────────────────
function drawGlyph(c, kind, r){
  c.lineWidth=2.4; c.strokeStyle=CREAM; c.fillStyle=CREAM;
  if(kind==='eye'){
    c.beginPath(); c.ellipse(0,0,r*0.62,r*0.36,0,0,Math.PI*2); c.stroke();
    c.beginPath(); c.arc(0,0,r*0.16,0,Math.PI*2); c.fill();
  } else if(kind==='key'){
    c.beginPath(); c.arc(0,-r*0.24,r*0.28,0,Math.PI*2); c.stroke();
    c.beginPath(); c.moveTo(0,0); c.lineTo(0,r*0.5); c.moveTo(0,r*0.34); c.lineTo(r*0.22,r*0.34); c.stroke();
  } else if(kind==='foot'){
    c.beginPath(); c.ellipse(0,r*0.05,r*0.3,r*0.46,0,0,Math.PI*2); c.fill();
    [[-0.28,-0.42],[-0.08,-0.5],[0.14,-0.46]].forEach(([dx,dy])=>{ c.beginPath(); c.arc(dx*r,dy*r,r*0.11,0,Math.PI*2); c.fill(); });
  } else if(kind==='ring'){
    c.beginPath(); c.arc(0,0,r*0.42,0,Math.PI*2); c.stroke();
  } else { // dot cluster
    [[0,0],[ -0.3,0.28],[0.3,0.28]].forEach(([dx,dy])=>{ c.beginPath(); c.arc(dx*r,dy*r,r*0.14,0,Math.PI*2); c.fill(); });
  }
}

// ── one clue node (glowing diamond plaque with glyph) ───────────────────────
function nodePos(i, t){
  const n=NODES[i];
  const p=interp([NODE_T[i], NODE_T[i]+TRAVEL],[0,1],E.easeOutCubic)(t);
  const dist=620*(1-p);
  return { x: n.x + n.from[0]*dist, y: n.y + n.from[1]*dist, p };
}
function drawNode(c, i, t){
  const {x,y,p} = nodePos(i, t);
  if(p<=0.001) return;
  // settle pop after landing
  const land=NODE_T[i]+TRAVEL;
  const pop=interp([land, land+0.12],[1.0,1.0])(t);
  const overshoot=interp([NODE_T[i]+TRAVEL*0.7, land, land+0.14],[1.18,1.18,1.0],E.easeOutBack)(t);
  const r=46*(p<1?lerp(0.5,1,p):overshoot);
  const trail=clamp(1-(t-NODE_T[i])/(TRAVEL*1.6),0,1);

  c.save();
  c.translate(x,y);
  // motion trail glow while flying
  if(p<1){
    c.globalAlpha=0.5*trail; c.shadowColor=PERI; c.shadowBlur=40;
    c.fillStyle=PERI; c.beginPath(); c.arc(0,0,r*1.2,0,Math.PI*2); c.fill();
    c.globalAlpha=1; c.shadowBlur=0;
  }
  // soft aura
  c.globalAlpha=0.9; c.fillStyle=radial(c,0,0,r*1.7,[[0,'rgba(118,120,237,0.55)'],[1,'rgba(118,120,237,0)']]);
  c.beginPath(); c.arc(0,0,r*1.7,0,Math.PI*2); c.fill();
  // diamond plaque
  c.save(); c.rotate(Math.PI/4);
  c.fillStyle='#241844'; c.strokeStyle=PERI; c.lineWidth=3;
  c.shadowColor='rgba(118,120,237,0.7)'; c.shadowBlur=22;
  c.beginPath(); c.roundRect(-r*0.72,-r*0.72,r*1.44,r*1.44,10); c.fill(); c.stroke();
  c.restore();
  // glyph (upright)
  c.shadowBlur=0;
  drawGlyph(c, NODES[i].icon, r*1.1);
  c.restore();
}

// ── progressive constellation lines between landed nodes ────────────────────
function drawLines(c, t, glow){
  c.save();
  c.lineCap='round';
  for(let i=1;i<NODES.length;i++){
    const a=nodePos(i-1,t), b=nodePos(i,t);
    // line draws as node i travels in
    const lp=interp([NODE_T[i], NODE_T[i]+TRAVEL],[0,1],E.easeOutQuad)(t);
    if(lp<=0.001) continue;
    const ex=lerp(a.x,b.x,lp), ey=lerp(a.y,b.y,lp);
    c.globalAlpha=0.35+0.5*glow;
    c.strokeStyle=PERI; c.lineWidth=2.5+2*glow;
    c.shadowColor=PERI; c.shadowBlur=10+18*glow;
    c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(ex,ey); c.stroke();
  }
  // link from constellation down to the seeker (node 2 -> avatar)
  const linkP=interp([COMPLETE-0.04, COMPLETE+0.14],[0,1],E.easeOutQuad)(t);
  if(linkP>0.001){
    const a=NODES[2];
    const ex=lerp(a.x,AVATAR.x,linkP), ey=lerp(a.y,AVATAR.y-AVATAR.r,linkP);
    c.globalAlpha=(0.3+0.5*glow)*linkP;
    c.setLineDash([10,12]); c.lineWidth=2.5; c.strokeStyle=PERI_HI;
    c.shadowColor=PERI; c.shadowBlur=12;
    c.beginPath(); c.moveTo(a.x,a.y); c.lineTo(ex,ey); c.stroke();
    c.setLineDash([]);
  }
  c.restore();
}

// ── the seeker (player who gathered the clues) ──────────────────────────────
function drawAvatar(c, t){
  const op=interp([0.04,0.22],[0,1])(t);
  if(op<=0.001) return;
  const {x,y,r,name}=AVATAR;
  const breathe=1+0.025*Math.sin(t*4);
  const ringGlow=interp([COMPLETE-0.05, COMPLETE+0.18],[0.3,1])(t);
  c.save(); c.globalAlpha=op;
  // aura
  c.fillStyle=radial(c,x,y,r*2.6,[[0,`rgba(118,120,237,${0.18+0.3*ringGlow})`],[1,'rgba(118,120,237,0)']]);
  c.beginPath(); c.arc(x,y,r*2.6,0,Math.PI*2); c.fill();
  // disc
  c.save(); c.translate(x,y); c.scale(breathe,breathe);
  c.fillStyle=radial(c,0,-r*0.3,r,[[0,'#3a2c66'],[1,'#1d1238']]);
  c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.fill();
  c.lineWidth=4+3*ringGlow; c.strokeStyle=PERI;
  c.shadowColor='rgba(118,120,237,0.8)'; c.shadowBlur=14+18*ringGlow;
  c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.stroke();
  c.shadowBlur=0;
  // initial
  c.font='700 56px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
  c.fillStyle=CREAM; c.fillText(name[0], 0, 4);
  c.restore();
  // name + status
  c.font='600 26px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
  c.letterSpacing='6px'; c.fillStyle=CREAM;
  c.fillText(name, x, y+r+44);
  c.letterSpacing='0px';
  c.restore();
}

// ── HUD: phase eyebrow + clue counter ───────────────────────────────────────
function landedCount(t){ let n=0; for(let i=0;i<NODE_T.length;i++){ if(t>=NODE_T[i]+TRAVEL) n++; } return n; }
function drawHUD(c, t){
  // eyebrow
  const eOp=interp([0.02,0.2],[0,1])(t);
  c.save(); c.globalAlpha=eOp;
  c.font='600 24px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
  c.letterSpacing='10px'; c.fillStyle=PERI_HI;
  c.fillText('REFLECTION · MINIGAME', FW/2, 92);
  c.letterSpacing='0px'; c.restore();

  // counter
  const count=landedCount(t);
  const lastLand=count>0?NODE_T[count-1]+TRAVEL:0;
  const pop=interp([lastLand, lastLand+0.12],[1.5,1.0],E.easeOutBack)(t);
  c.save();
  c.font='600 22px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
  c.letterSpacing='8px'; c.fillStyle=CREAM; c.globalAlpha=interp([0.04,0.2],[0,1])(t);
  c.fillText('CLUES GATHERED', FW/2, 150);
  c.letterSpacing='0px';
  // numeral
  c.save(); c.translate(FW/2, 220); c.scale(pop,pop);
  c.font='700 96px Cinzel, serif';
  c.fillStyle=GOLD; c.shadowColor='rgba(227,181,16,0.55)'; c.shadowBlur=28;
  c.fillText(String(count), 0, 0);
  c.restore();
  c.restore();
}

// ── master frame ────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // purple sky
  ctx.fillStyle=radial(ctx, 960, 520, 1250, [[0, BG],[0.62, '#241646'],[1, BG_DEEP]]);
  ctx.fillRect(0,0,FW,FH);
  drawStars(ctx, t, interp([0,0.18],[0,1])(t));

  // central aura (breathing, swells on completion)
  const auraGrow=interp([COMPLETE-0.05, COMPLETE+0.2],[1,1.25],E.easeOutCubic)(t);
  const auraBreathe=1+0.04*Math.sin(t*3);
  const aR=520*auraGrow*auraBreathe;
  ctx.save(); ctx.globalCompositeOperation='screen';
  ctx.fillStyle=radial(ctx, 980, 380, aR, [[0,'rgba(118,120,237,0.30)'],[0.6,'rgba(118,120,237,0.07)'],[1,'rgba(118,120,237,0)']]);
  ctx.fillRect(0,0,FW,FH); ctx.restore();

  const glow=interp([COMPLETE-0.08, COMPLETE+0.16],[0,1],E.easeOutCubic)(t);

  drawLines(ctx, t, glow);
  for(let i=0;i<NODES.length;i++) drawNode(ctx, i, t);
  drawAvatar(ctx, t);
  drawHUD(ctx, t);

  // completion flash from the constellation centre
  const flash=interp([COMPLETE-0.03, COMPLETE+0.03, COMPLETE+0.2],[0,0.7,0])(t);
  if(flash>0.001){
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=flash;
    ctx.fillStyle=radial(ctx, 980, 380, 700, [[0,'#fff'],[0.5,'#c5c6ff'],[1,'rgba(197,198,255,0)']]);
    ctx.fillRect(0,0,FW,FH); ctx.restore();
  }

  // drifting motes
  ctx.save(); ctx.globalCompositeOperation='screen';
  for(let i=0;i<16;i++){
    const sp=8+(i%5)*4, life=(t*sp/100 + (i*61%100)/100)%1;
    const x=((i*113+20)%100)/100*FW + Math.sin(t*1.2+i)*30;
    const y=FH*(1-life*0.85);
    ctx.globalAlpha=Math.sin(life*Math.PI)*0.4;
    ctx.fillStyle='rgba(185,187,255,0.9)';
    ctx.beginPath(); ctx.arc(x,y,1.6+(i%3),0,Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // vignette
  ctx.fillStyle=radial(ctx,960,540,1180,[[0.45,'rgba(0,0,0,0)'],[1,'rgba(8,4,20,0.9)']]);
  ctx.fillRect(0,0,FW,FH);

  // fade in from black at the very start
  const fadeIn=interp([0,0.07],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "clues_gathered",
  bg: "#150d2e",
  duration: DURATION,
  video: "/animations/clues_gathered.mp4",
  fadeFromBlack: false,
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
