// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vices vs Virtues - Video Export.html".
import type { ClipConfig } from "../engine";

// everything below copied VERBATIM from the source <script>, except:
//   * `const ctx = canvas.getContext('2d')` -> module-level `let ctx;` (set in draw)
//   * removed: canvas lookup, status/record button, load flags, previewLoop,
//     recordVideo/pickMime/onRecord, trailing requestAnimationFrame boot, window.drawFrame
const FW = 1920, FH = 1080, DURATION = 1.0;
let ctx;

// ── palette (from the design tokens) ────────────────────────────────────────
const VICE = '#800020', VIRTUE = '#000080', GOLD = '#e3b510', CREAM = '#ffefc5', INK = '#050302';

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
function animate(from,to,start,end,ease){
  ease=ease||E.easeInCubic;
  return t=>{ if(t<=start) return from; if(t>=end) return to; return from+(to-from)*ease((t-start)/(end-start)); };
}
function radial(c, cx, cy, r, stops){
  const g=c.createRadialGradient(cx,cy,0,cx,cy,r);
  for(const [o,col] of stops) g.addColorStop(o,col);
  return g;
}
function lin(c, x0,y0,x1,y1, stops){
  const g=c.createLinearGradient(x0,y0,x1,y1);
  for(const [o,col] of stops) g.addColorStop(o,col);
  return g;
}

// ── timeline (seconds) ──────────────────────────────────────────────────────
const T = {
  drive:[0.0, 0.32],   // halves charge in toward the seam
  clash: 0.32,         // impact frame
  vs:[0.28, 0.5],      // VS ignites
  hold:[0.5, 1.0],
};

// ── embers (continuity with the rest of the trailer) ────────────────────────
const embers = Array.from({length:26},(_,i)=>({
  x:(i*89+7)%100, size:1.4+((i*53)%100)/100*3.2, speed:18+((i*37)%100)/100*40,
  phase:((i*71)%100)/100, drift:(((i*29)%100)/100-0.5)*60, flick:0.6+((i*41)%100)/100*1.9,
  hue: i%2,
}));
function drawEmbers(c, t, opacity){
  c.save();
  for(const s of embers){
    const life=(t*s.speed/100+s.phase)%1;
    const y=FH*(1-life);
    const x=s.x/100*FW + Math.sin(t*s.flick+s.phase*6)*s.drift;
    const fade=Math.sin(life*Math.PI);
    c.globalAlpha=fade*0.45*opacity;
    c.fillStyle='rgba(255,205,120,0.9)';
    c.shadowColor='rgba(255,175,70,0.7)'; c.shadowBlur=7;
    c.beginPath(); c.arc(x,y,s.size,0,Math.PI*2); c.fill();
  }
  c.restore();
}

// ── clash sparks burst from the seam ────────────────────────────────────────
const sparks = Array.from({length:46},(_,i)=>{
  // fan out left & right from the seam, biased horizontal
  const dir = i%2===0 ? 1 : -1;
  const ang=(dir>0 ? 0 : Math.PI) + (((i*47)%100)/100-0.5)*1.5;
  const sp=900+((i*53)%100)/100*1900;
  return { vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp*0.6 - 120, life:0.22+((i*31)%100)/100*0.38, sz:1.6+((i*19)%100)/100*3 };
});

// ── one camp half (diagonal hatch texture + emblem word) ────────────────────
function hatch(c, side){
  // engraved diagonal lines for material texture, clipped to the half
  c.save();
  c.globalAlpha=0.10; c.lineWidth=2; c.strokeStyle= side==='left'?'#ffd9d9':'#cdd3ff';
  const step=46;
  for(let d=-FH; d<FW; d+=step){
    c.beginPath(); c.moveTo(d, 0); c.lineTo(d+FH*(side==='left'?1:-1), FH); c.stroke();
  }
  c.restore();
}

function drawHalf(c, side, offset){
  const w = FW/2;
  const x0 = side==='left' ? 0 : w;
  c.save();
  c.translate(offset, 0);
  c.beginPath(); c.rect(x0, 0, w, FH); c.clip();

  // base camp gradient — richest near the seam, deepening toward the edge
  const base = side==='left' ? VICE : VIRTUE;
  const dark = side==='left' ? '#2a000a' : '#00002a';
  const seamX = side==='left' ? w : w;
  const edgeX = side==='left' ? 0 : FW;
  c.fillStyle = lin(c, edgeX, 0, seamX, 0, [[0, dark],[0.55, base],[1, base]]);
  c.fillRect(x0, 0, w, FH);

  // top-down vignette
  c.fillStyle = radial(c, side==='left'? w*0.55 : w*1.45, FH*0.5, FH*1.05,
    [[0,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,0.55)']]);
  c.fillRect(x0, 0, w, FH);

  hatch(c, side);

  // the word — sits proud near the seam, gold-edged cream
  const word = side==='left' ? 'VICES' : 'VIRTUES';
  const cx = side==='left' ? w*0.48 : w*1.58;
  c.font = '700 150px Cinzel, serif';
  c.textAlign='center'; c.textBaseline='middle';
  c.letterSpacing='10px';
  // engrave shadow
  c.fillStyle='rgba(0,0,0,0.55)';
  c.fillText(word, cx+4, FH*0.5+5);
  // gold stroke + cream fill
  c.lineWidth=3; c.strokeStyle=GOLD; c.shadowColor='rgba(227,181,16,0.5)'; c.shadowBlur=24;
  c.strokeText(word, cx, FH*0.5);
  c.shadowBlur=0;
  c.fillStyle=CREAM;
  c.fillText(word, cx, FH*0.5);
  c.letterSpacing='0px';

  c.restore();
}

// ── the gold seam where the camps meet ──────────────────────────────────────
function drawSeam(c, t, glow){
  const x=FW/2;
  c.save();
  // dark gap
  c.fillStyle='rgba(0,0,0,0.65)'; c.fillRect(x-6,0,12,FH);
  // gold line, brightening at the clash
  c.globalAlpha=0.5+0.5*glow;
  c.fillStyle=lin(c, x-5,0,x+5,0, [[0,'rgba(227,181,16,0)'],[0.5, GOLD],[1,'rgba(227,181,16,0)']]);
  c.fillRect(x-5,0,10,FH);
  // bloom
  c.globalCompositeOperation='screen'; c.globalAlpha=glow;
  c.fillStyle=lin(c, x-70,0,x+70,0, [[0,'rgba(227,181,16,0)'],[0.5,'rgba(255,225,140,0.55)'],[1,'rgba(227,181,16,0)']]);
  c.fillRect(x-70,0,140,FH);
  c.restore();
}

// ── the VS medallion ────────────────────────────────────────────────────────
function drawVS(c, t){
  const op = interp([T.vs[0], T.vs[0]+0.08],[0,1])(t);
  if(op<=0.001) return;
  const sc = interp([T.vs[0], T.vs[1]],[0.2, 1.0], E.easeOutBack)(t);
  const cx=FW/2, cy=FH*0.5;
  c.save();
  c.globalAlpha=op;
  c.translate(cx,cy); c.scale(sc,sc);

  // disc
  c.shadowColor='rgba(0,0,0,0.7)'; c.shadowBlur=40; c.shadowOffsetY=8;
  c.fillStyle=radial(c,0,-30,160,[[0,'#1c140a'],[1,'#0b0805']]);
  c.beginPath(); c.arc(0,0,128,0,Math.PI*2); c.fill();
  c.shadowBlur=0; c.shadowOffsetY=0;
  // gold ring
  c.lineWidth=7; c.strokeStyle=GOLD;
  c.beginPath(); c.arc(0,0,128,0,Math.PI*2); c.stroke();
  c.lineWidth=2; c.strokeStyle='rgba(227,181,16,0.45)';
  c.beginPath(); c.arc(0,0,112,0,Math.PI*2); c.stroke();

  // VS lettering
  c.font='700 132px Cinzel, serif';
  c.textAlign='center'; c.textBaseline='middle'; c.letterSpacing='4px';
  c.fillStyle=GOLD; c.shadowColor='rgba(227,181,16,0.6)'; c.shadowBlur=30;
  c.fillText('VS', 4, 6);
  c.fillStyle=CREAM; c.shadowBlur=0;
  c.fillText('VS', 0, 0);
  c.letterSpacing='0px';
  c.restore();
}

// ── master frame ────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  ctx.fillStyle=INK; ctx.fillRect(0,0,FW,FH);

  // camp drive-in with a clash recoil
  const drive = animate(0,1,T.drive[0],T.drive[1],E.easeOutExpo)(t);
  const recoil = interp([T.clash, T.clash+0.05, T.clash+0.16, T.clash+0.34],[0,26,-8,0])(t);
  const leftOff  = -FW/2*(1-drive) - recoil;
  const rightOff =  FW/2*(1-drive) + recoil;

  // screen shake on impact
  const shakeAmp = interp([T.clash, T.clash+0.06, T.clash+0.4],[0,22,0],E.easeOutQuad)(t);
  const shx=Math.sin(t*220)*shakeAmp, shy=Math.cos(t*260)*shakeAmp*0.5;
  ctx.save();
  ctx.translate(shx,shy);

  drawHalf(ctx,'left',  leftOff);
  drawHalf(ctx,'right', rightOff);

  const clashGlow = interp([T.clash-0.04, T.clash+0.02, T.clash+0.5],[0, 1, 0.32])(t);
  // only show seam once halves are near home
  if(drive>0.55) drawSeam(ctx, t, Math.max(clashGlow, (drive-0.55)/0.45*0.4));

  // sparks
  const sdt=t-T.clash;
  if(sdt>0 && sdt<0.6){
    ctx.save();
    for(const s of sparks){
      const lt=sdt/s.life; if(lt>1) continue;
      const x=FW/2+s.vx*sdt;
      const y=FH*0.5+s.vy*sdt+0.5*2600*sdt*sdt;
      ctx.save(); ctx.translate(x,y); ctx.rotate(Math.atan2(s.vy+2600*sdt, s.vx));
      ctx.globalAlpha=1-lt; ctx.shadowColor='rgba(255,210,110,0.9)'; ctx.shadowBlur=10;
      const sg=ctx.createLinearGradient(0,0,0,s.sz*(1+lt*4)); sg.addColorStop(0,'#fff'); sg.addColorStop(1,'#ffd166');
      ctx.fillStyle=sg; ctx.fillRect(-s.sz/2,0,s.sz,s.sz*(1+lt*4));
      ctx.restore();
    }
    ctx.restore();
  }

  drawVS(ctx, t);
  ctx.restore(); // shake

  drawEmbers(ctx, t, 0.9);

  // impact flash from the seam
  const flash = interp([T.clash-0.03, T.clash+0.02, T.clash+0.18],[0, 0.92, 0])(t);
  if(flash>0.001){
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=flash;
    ctx.fillStyle=radial(ctx, FW/2, FH/2, 760, [[0,'#fff'],[0.5,'#ffe6a8'],[1,'rgba(255,230,168,0)']]);
    ctx.fillRect(0,0,FW,FH); ctx.restore();
  }

  // vignette
  ctx.fillStyle=radial(ctx,960,540,1180,[[0.45,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,0.88)']]);
  ctx.fillRect(0,0,FW,FH);

  // brief fade in from black at the very start (clean cut-in)
  const fadeIn = interp([0,0.06],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "vices_vs_virtues",
  bg: "#050302",
  duration: DURATION,
  fadeFromBlack: false,
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
