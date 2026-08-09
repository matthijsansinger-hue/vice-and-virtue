// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Use Role Ability - Video Export.html".
import type { ClipConfig } from "../engine";

// everything below copied VERBATIM from the source <script>, except:
//   * `const ctx = canvas.getContext('2d')` -> module-level `let ctx;` (set in draw)
//   * removed: canvas lookup, status/record button, load flags, previewLoop,
//     recordVideo/pickMime/onRecord, trailing requestAnimationFrame boot, window.drawFrame
const FW = 1920, FH = 1080, DURATION = 1.9;
let ctx;

// ── palette (Reflection / role-action) ──────────────────────────────────────
const BG='#372155', BG_DEEP='#150d2e', PERI='#7678ed', PERI_HI='#b9bbff',
      SOUL='#7de0f0', GOLD='#e3b510', CREAM='#ffefc5', WOOD='#4e3624';

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const E = {
  linear:t=>t,
  easeInQuad:t=>t*t,
  easeOutQuad:t=>t*(2-t),
  easeInOutQuad:t=>t<0.5?2*t*t:-1+(4-2*t)*t,
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

// ── timeline ────────────────────────────────────────────────────────────────
const CHARGE=[0.10,0.50], BTN=[0.30,0.48], TAP=0.56, BURST=[0.56,0.74];
const SIG={x:960, y:412, R:150};
const BTNBOX={x:960, y:720, w:640, h:108};

// ── starfield ────────────────────────────────────────────────────────────────
const stars = Array.from({length:80},(_,i)=>({
  x:((i*73+11)%100)/100*FW, y:((i*149+29)%100)/100*FH,
  r:0.6+((i*53)%100)/100*1.9, tw:0.5+((i*37)%100)/100*2.4, ph:((i*97)%100)/100*6.28,
}));
function drawStars(c, t, op){
  c.save();
  for(const s of stars){
    const a=(0.25+0.5*(0.5+0.5*Math.sin(t*s.tw+s.ph)))*op;
    c.globalAlpha=a; c.fillStyle='#cdd0ff';
    c.beginPath(); c.arc(s.x,s.y,s.r,0,Math.PI*2); c.fill();
  }
  c.restore();
}

// ── soul-energy particles (cyan) ────────────────────────────────────────────
const souls = Array.from({length:36},(_,i)=>({
  ang: (i/36)*6.283 + (i%4),
  r0: 480+((i*53)%100)/100*420,
  sz: 2+((i*19)%100)/100*3.5,
  spin: (((i*29)%100)/100-0.5)*2.4,
}));
function drawSouls(c, t){
  const charge=interp(CHARGE,[0,1],E.easeInOutQuad)(t);
  const burstP=interp(BURST,[0,1],E.easeOutCubic)(t);
  c.save(); c.globalCompositeOperation='screen';
  for(const s of souls){
    let r, op, ang=s.ang;
    if(t<TAP){
      r=lerp(s.r0, 64, charge); ang+=s.spin*charge*2.2;
      op=charge*Math.sin(charge*Math.PI)*1.1 + 0.15;
    } else {
      r=lerp(48, 980, burstP); ang+=s.spin*0.5;
      op=(1-burstP)*0.9;
    }
    const x=SIG.x+Math.cos(ang)*r, y=SIG.y+Math.sin(ang)*r*0.9;
    c.globalAlpha=clamp(op,0,1);
    c.fillStyle=SOUL; c.shadowColor=SOUL; c.shadowBlur=12;
    c.beginPath(); c.arc(x,y,s.sz,0,Math.PI*2); c.fill();
  }
  c.restore();
}

// ── 4-point spark star path ─────────────────────────────────────────────────
function starPath(c, R, r){
  c.beginPath();
  for(let i=0;i<8;i++){
    const a=-Math.PI/2 + i*Math.PI/4;
    const rad=(i%2===0)?R:r;
    const x=Math.cos(a)*rad, y=Math.sin(a)*rad;
    if(i===0) c.moveTo(x,y); else c.lineTo(x,y);
  }
  c.closePath();
}

// ── ability sigil (gold ring charges; spark glyph ignites) ──────────────────
function drawSigil(c, t){
  const charge=interp(CHARGE,[0,1],E.easeInOutQuad)(t);
  const armed=t>=TAP;
  const burstP=interp(BURST,[0,1],E.easeOutCubic)(t);
  const breathe=1+0.03*Math.sin(t*5);
  const {x,y,R}=SIG;

  // aura swells with charge, pops on activation
  const auraR=(R*2.0)*(0.7+0.5*charge)*(armed?1+0.35*burstP:1)*breathe;
  c.save(); c.globalCompositeOperation='screen';
  c.fillStyle=radial(c,x,y,auraR,[[0,`rgba(118,120,237,${0.28+0.25*charge})`],[0.55,'rgba(125,224,240,0.10)'],[1,'rgba(118,120,237,0)']]);
  c.beginPath(); c.arc(x,y,auraR,0,Math.PI*2); c.fill();
  c.restore();

  c.save(); c.translate(x,y); c.scale(breathe,breathe);

  // outer track ring (faint)
  c.lineWidth=10; c.strokeStyle='rgba(118,120,237,0.30)';
  c.beginPath(); c.arc(0,0,R,0,Math.PI*2); c.stroke();

  // charge sweep (gold) from top, clockwise
  c.save();
  c.lineWidth=10; c.lineCap='round'; c.strokeStyle=GOLD;
  c.shadowColor='rgba(227,181,16,0.7)'; c.shadowBlur=18+18*(armed?1:charge);
  const sweep=(armed?1:charge)*Math.PI*2;
  c.beginPath(); c.arc(0,0,R,-Math.PI/2, -Math.PI/2+sweep); c.stroke();
  c.restore();

  // inner disc
  c.fillStyle=radial(c,0,-R*0.3,R*0.92,[[0,'#2c1d52'],[1,'#160d2c']]);
  c.beginPath(); c.arc(0,0,R*0.92,0,Math.PI*2); c.fill();

  // spark glyph — grows + brightens with charge, flares on activation
  const gScale=lerp(0.45,1.0,charge)*(armed?1+0.18*Math.sin(burstP*Math.PI):1);
  const gGlow=armed?1:charge;
  c.save(); c.scale(gScale,gScale);
  c.shadowColor=SOUL; c.shadowBlur=20+30*gGlow;
  const gg=radial(c,0,0,R*0.7,[[0,'#ffffff'],[0.4, SOUL],[1, GOLD]]);
  c.fillStyle=gg; starPath(c, R*0.62, R*0.20); c.fill();
  // gold rim
  c.shadowBlur=0; c.lineWidth=3; c.strokeStyle=GOLD; starPath(c, R*0.62, R*0.20); c.stroke();
  c.restore();

  c.restore();

  // activation shock ring
  if(armed){
    const sr=lerp(R*0.9, R*4.2, burstP);
    c.save(); c.globalAlpha=(1-burstP)*0.8; c.lineWidth=8*(1-burstP)+2;
    c.strokeStyle=SOUL; c.shadowColor=SOUL; c.shadowBlur=20;
    c.beginPath(); c.arc(x,y,sr,0,Math.PI*2); c.stroke();
    c.restore();
  }

  // eyebrow
  const eOp=interp([0.04,0.2],[0,1])(t);
  c.save(); c.globalAlpha=eOp;
  c.font='600 24px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
  c.letterSpacing='12px'; c.fillStyle=PERI_HI;
  c.fillText('ROLE ACTION', x, y-R-66);
  c.letterSpacing='0px'; c.restore();
}

// ── gold CTA button: "Use your role ability" ────────────────────────────────
function drawButton(c, t){
  const rise=interp(BTN,[0,1],E.easeOutCubic)(t);
  if(rise<=0.001) return;
  const dy=lerp(34,0,rise);
  const press=interp([TAP, TAP+0.04, TAP+0.12],[1, 0.95, 1.0],E.easeOutBack)(t);
  const glow=interp([TAP-0.02, TAP+0.16],[0.3,1])(t);
  const {x,y,w,h}=BTNBOX;
  const yy=y+dy;
  c.save();
  c.globalAlpha=rise;
  c.translate(x, yy); c.scale(press, press);
  // shadow + gold glow
  c.shadowColor=`rgba(227,181,16,${0.35+0.4*glow})`; c.shadowBlur=24+26*glow; c.shadowOffsetY=8;
  // pill
  c.fillStyle=GOLD;
  c.beginPath(); c.roundRect(-w/2,-h/2,w,h,h/2); c.fill();
  c.shadowBlur=0; c.shadowOffsetY=0;
  // top sheen
  c.save(); c.beginPath(); c.roundRect(-w/2,-h/2,w,h,h/2); c.clip();
  c.fillStyle='rgba(255,255,255,0.18)'; c.fillRect(-w/2,-h/2,w,h*0.42); c.restore();
  // label
  c.font='700 40px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
  c.letterSpacing='2px'; c.fillStyle=WOOD;
  c.fillText('Use your role ability', 0, 3);
  c.letterSpacing='0px';
  c.restore();

  // tap ripple
  const rip=interp([TAP, TAP+0.22],[0,1])(t);
  if(rip>0.001 && rip<1){
    c.save(); c.globalAlpha=(1-rip)*0.5;
    c.strokeStyle=CREAM; c.lineWidth=4;
    c.beginPath(); c.arc(x, y+dy, lerp(20, w*0.6, rip), 0, Math.PI*2); c.stroke();
    c.restore();
  }
}

// ── master frame ────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // purple sky
  ctx.fillStyle=radial(ctx, 960, 460, 1250, [[0, BG],[0.62, '#241646'],[1, BG_DEEP]]);
  ctx.fillRect(0,0,FW,FH);
  drawStars(ctx, t, interp([0,0.18],[0,1])(t));

  drawSouls(ctx, t);
  drawSigil(ctx, t);
  drawButton(ctx, t);

  // activation flash
  const flash=interp([TAP-0.02, TAP+0.04, TAP+0.2],[0,0.6,0])(t);
  if(flash>0.001){
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=flash;
    ctx.fillStyle=radial(ctx, SIG.x, SIG.y, 760, [[0,'#fff'],[0.45,'#bff2fb'],[1,'rgba(191,242,251,0)']]);
    ctx.fillRect(0,0,FW,FH); ctx.restore();
  }

  // vignette
  ctx.fillStyle=radial(ctx,960,540,1180,[[0.45,'rgba(0,0,0,0)'],[1,'rgba(8,4,20,0.9)']]);
  ctx.fillRect(0,0,FW,FH);

  // fade in from black
  const fadeIn=interp([0,0.07],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "use_role_ability",
  bg: "#150d2e",
  duration: DURATION,
  video: "/animations/use_role_ability.mp4",
  fadeFromBlack: false,
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
