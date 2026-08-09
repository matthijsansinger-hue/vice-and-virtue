// @ts-nocheck
/* eslint-disable */
// Ported from the design handoff: trailer/"Ending - Video Export.html", trimmed
// to just the imprisonment beat — the prison gates slamming shut + the
// "IMPRISONED" seal stamping in. The trailer's taglines + logo outro are
// dropped. Rendered live on canvas (via ClipBackground) as the imprisonment
// cutscene so there's no heavy video file. Drawing bodies are copied as-is;
// `ctx` is module-level (set per draw), the offscreen layer is created lazily
// (no DOM at import), and the emblem comes from `assets`.
import type { ClipConfig } from "../engine";

const FW = 1920, FH = 1080, DURATION = 4.5;
let ctx;

// offscreen layer for the gate scene's grouped opacity — created lazily so
// importing this module never touches the DOM (draw only runs in the browser).
let gc, gx;
function ensureLayers() {
  if (gc) return;
  gc = document.createElement('canvas'); gc.width = FW; gc.height = FH; gx = gc.getContext('2d');
}

// the "IMPRISONED" seal emblem — set from `assets` on every draw.
let emblem = null, emblemOk = false;

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const E = {
  linear:t=>t,
  easeInQuad:t=>t*t,
  easeOutQuad:t=>t*(2-t),
  easeInCubic:t=>t*t*t,
  easeOutCubic:t=>(--t)*t*t+1,
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

const T = {
  fadeIn:[0,0.45], close:[0.55,2.25], slam:2.25, seal:[2.55,4.35],
};

// ── ember seeds ─────────────────────────────────────────────────────────────
const embers = Array.from({length:30},(_,i)=>({
  x:(i*89+7)%100, size:1.4+((i*53)%100)/100*3.6, speed:6+((i*37)%100)/100*20,
  phase:((i*71)%100)/100, drift:(((i*29)%100)/100-0.5)*70, flick:0.6+((i*41)%100)/100*1.9,
}));
function drawEmbers(c, t, opacity){
  c.save();
  for(const s of embers){
    const life=(t*s.speed/100+s.phase)%1;
    const y=FH*(1-life);
    const x=s.x/100*FW + Math.sin(t*s.flick+s.phase*6)*s.drift;
    const fade=Math.sin(life*Math.PI);
    c.globalAlpha=fade*0.5*opacity;
    c.fillStyle='rgba(255,205,120,0.9)';
    c.shadowColor='rgba(255,175,70,0.7)'; c.shadowBlur=7;
    c.beginPath(); c.arc(x,y,s.size,0,Math.PI*2); c.fill();
  }
  c.restore();
}

// ── spark seeds ─────────────────────────────────────────────────────────────
const sparks = Array.from({length:30},(_,i)=>{
  const ang=(-90+(((i*47)%100)/100-0.5)*150)*Math.PI/180;
  const sp=700+((i*53)%100)/100*1500;
  return { vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp, life:0.35+((i*31)%100)/100*0.4, sz:1.5+((i*19)%100)/100*2.5 };
});

// ── metal bar + rivet ───────────────────────────────────────────────────────
const BAR_STOPS=[[0,'#0d0f12'],[0.2,'#23272d'],[0.42,'#474e57'],[0.5,'#757e8a'],[0.6,'#3a4048'],[0.84,'#1a1d22'],[1,'#090a0c']];
function barGrad(c,x,y,w,h,horizontal){
  const g = horizontal ? c.createLinearGradient(0,y,0,y+h) : c.createLinearGradient(x,0,x+w,0);
  for(const [o,col] of BAR_STOPS) g.addColorStop(o,col);
  return g;
}
function drawBar(c,x,y,w,h,horizontal){
  const r=Math.min(w,h)/2;
  c.save();
  c.shadowColor='rgba(0,0,0,0.8)'; c.shadowBlur=2;
  c.fillStyle=barGrad(c,x,y,w,h,horizontal);
  c.beginPath(); c.roundRect(x,y,w,h,r); c.fill();
  c.restore();
}
function drawRivet(c,x,y,r=7){
  const g=c.createRadialGradient(x-r*0.3,y-r*0.4,r*0.1,x,y,r);
  g.addColorStop(0,'#9aa3ae'); g.addColorStop(0.55,'#3c424b'); g.addColorStop(1,'#14161a');
  c.save(); c.shadowColor='rgba(0,0,0,0.7)'; c.shadowBlur=2;
  c.fillStyle=g; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill(); c.restore();
}

// ── one gate leaf ───────────────────────────────────────────────────────────
function drawLeaf(c, side, baseX){
  const leafW=980, barW=30, stileW=64;
  const innerLeft = side==='left'?stileW:0;
  const innerRight = side==='left'?0:stileW;
  const gap=(leafW-innerLeft-innerRight-barW)/4;
  // cross rails
  drawBar(c, baseX+0, FH*0.13, leafW, 42, true);
  drawBar(c, baseX+0, FH*0.80, leafW, 42, true);
  // vertical bars + rivets
  for(let i=0;i<5;i++){
    const bl=innerLeft+i*gap;
    drawBar(c, baseX+bl, 0, barW, FH, false);
    drawRivet(c, baseX+bl+barW/2, FH*0.165);
    drawRivet(c, baseX+bl+barW/2, FH*0.835);
  }
  // heavy meeting stile
  const stileLeft = side==='left'?leafW-stileW:0;
  c.save();
  c.shadowColor='rgba(0,0,0,0.8)'; c.shadowBlur=8;
  c.fillStyle=barGrad(c, baseX+stileLeft, 0, stileW, FH, false);
  c.fillRect(baseX+stileLeft, 0, stileW, FH);
  c.restore();
  [0.08,0.26,0.44,0.62,0.80,0.95].forEach(p=>drawRivet(c, baseX+stileLeft+stileW/2, FH*p, 8));
}

function radial(c, cx, cy, r, stops){
  const g=c.createRadialGradient(cx,cy,0,cx,cy,r);
  for(const [o,col] of stops) g.addColorStop(o,col);
  return g;
}

// ── gate scene (drawn opaque on offscreen gx) ───────────────────────────────
function drawGateScene(c, t){
  c.setTransform(1,0,0,1,0,0);
  c.clearRect(0,0,FW,FH);
  c.globalAlpha=1; c.globalCompositeOperation='source-over'; c.shadowBlur=0;

  // dungeon base
  c.fillStyle=radial(c,960,497,1180,[[0,'#241913'],[0.62,'#0d0805'],[1,'#050302']]);
  c.fillRect(0,0,FW,FH);

  // cold cell light
  const coldGlow = interp([0,T.slam,T.slam+0.6],[0.22,0.22,0.04])(t);
  c.fillStyle=radial(c,960,561,620,[[0,`rgba(120,150,205,${coldGlow})`],[0.7,'rgba(120,150,205,0)']]);
  c.fillRect(0,0,FW,FH);

  // doors
  const p = animate(0,1,T.close[0],T.close[1],E.easeInCubic)(t);
  const recoil = interp([T.slam,T.slam+0.05,T.slam+0.16,T.slam+0.32],[0,9,-3,0])(t);
  const leftX = -980*(1-p) - recoil;
  const rightX = 980*(1-p) + recoil;
  const shakeAmp = interp([T.slam,T.slam+0.06,T.slam+0.5],[0,18,0],E.easeOutQuad)(t);
  const shx=Math.sin(t*130)*shakeAmp, shy=Math.cos(t*155)*shakeAmp;

  c.save();
  c.translate(shx,shy);
  drawLeaf(c,'left', 0+leftX);
  drawLeaf(c,'right', (FW-980)+rightX);
  // lock
  const drop = interp([T.slam-0.12,T.slam+0.04],[-70,0],E.easeInCubic)(t);
  const lockOp = interp([T.slam-0.18,T.slam-0.05],[0,1])(t) * (p>0.6?1:0);
  if(lockOp>0.001){
    const lx=FW/2-46, ly=FH*0.46+drop, lw=92, lh=104;
    c.save(); c.globalAlpha=lockOp;
    const lg=c.createLinearGradient(lx,ly,lx+lw,ly+lh);
    lg.addColorStop(0,'#4a525c'); lg.addColorStop(0.6,'#20242a'); lg.addColorStop(1,'#0e1013');
    c.shadowColor='rgba(0,0,0,0.6)'; c.shadowBlur=18; c.shadowOffsetY=8;
    c.fillStyle=lg; c.beginPath(); c.roundRect(lx,ly,lw,lh,10); c.fill();
    c.shadowBlur=0; c.shadowOffsetY=0;
    c.lineWidth=2; c.strokeStyle='#11130f'; c.beginPath(); c.roundRect(lx,ly,lw,lh,10); c.stroke();
    // keyhole
    c.fillStyle='#0a0b0c';
    c.beginPath(); c.arc(lx+lw/2, ly+38, 8, 0, Math.PI*2); c.fill();
    c.fillRect(lx+lw/2-4, ly+42, 8, 30);
    c.restore();
    [[16,16],[76,16],[16,88],[76,88]].forEach(([rx,ry])=>drawRivet(c, lx+rx, ly+ry, 5));
  }
  c.restore();

  // torch glows (screen)
  const flick = 0.82+0.18*Math.sin(t*17)*Math.sin(t*6.3);
  c.save();
  c.globalCompositeOperation='screen'; c.globalAlpha=flick;
  c.fillStyle=radial(c,172.8,475.2,520,[[0,'rgba(255,150,50,0.5)'],[0.7,'rgba(255,150,50,0)']]);
  c.fillRect(0,0,FW,FH);
  c.fillStyle=radial(c,1747.2,475.2,520,[[0,'rgba(255,150,50,0.5)'],[0.7,'rgba(255,150,50,0)']]);
  c.fillRect(0,0,FW,FH);
  c.restore();

  // gate darken after slam
  const gateDark = interp([T.slam,T.seal[0]+0.4],[0,0.55])(t);
  c.save(); c.globalAlpha=gateDark; c.fillStyle='#000'; c.fillRect(0,0,FW,FH); c.restore();

  // sparks
  const sdt=t-T.slam;
  if(sdt>0 && sdt<0.85){
    c.save();
    for(const s of sparks){
      const lt=sdt/s.life; if(lt>1) continue;
      const x=FW/2+s.vx*sdt;
      const y=FH*0.62+s.vy*sdt+0.5*2600*sdt*sdt;
      c.save(); c.translate(x,y); c.rotate(Math.atan2(s.vy,s.vx));
      c.globalAlpha=1-lt; c.shadowColor='rgba(255,200,90,0.9)'; c.shadowBlur=8;
      const sg=c.createLinearGradient(0,0,0,s.sz*(1+lt*3)); sg.addColorStop(0,'#fff'); sg.addColorStop(1,'#ffd166');
      c.fillStyle=sg; c.fillRect(-s.sz/2,0,s.sz,s.sz*(1+lt*3));
      c.restore();
    }
    c.restore();
  }

  // dust puffs
  if(t>T.slam && t<T.slam+0.9){
    [0.32,0.5,0.68].forEach((cx,i)=>{
      const d=t-T.slam-i*0.04; if(d<0) return;
      const g=E.easeOutCubic(clamp(d/0.7,0,1));
      const w=240+g*200, h=160+g*160;
      const cxp=FW*cx, cyp=FH*0.78-g*90;
      c.save(); c.globalAlpha=(1-g)*0.7;
      c.translate(cxp,cyp); c.scale(w/2,h/2);
      const dg=c.createRadialGradient(0,0,0,0,0,1);
      dg.addColorStop(0,'rgba(120,100,80,0.28)'); dg.addColorStop(0.65,'rgba(120,100,80,0)');
      c.fillStyle=dg; c.beginPath(); c.arc(0,0,1,0,Math.PI*2); c.fill();
      c.restore();
    });
  }

  drawEmbers(c, t, 0.9);

  // impact flash
  const flash = interp([T.slam-0.03,T.slam+0.02,T.slam+0.16],[0,0.85,0])(t);
  if(flash>0.001){
    c.save(); c.globalAlpha=flash;
    c.fillStyle=radial(c,960,594,640,[[0,'#fff'],[0.6,'#ffd9a0'],[1,'rgba(255,217,160,0)']]);
    c.fillRect(0,0,FW,FH); c.restore();
  }

  // vignette
  c.fillStyle=radial(c,960,497,1180,[[0.4,'rgba(0,0,0,0)'],[1,'rgba(0,0,0,0.92)']]);
  c.fillRect(0,0,FW,FH);

  // imprisoned seal — stamps in and holds (this is the final beat, no fade-out)
  const sealOp = interp([T.seal[0], T.seal[0]+0.6],[0,1],E.easeOutCubic)(t);
  if(sealOp>0.001 && emblemOk){
    const sc = interp([T.seal[0],T.seal[0]+0.7,T.seal[1]],[0.78,1.0,1.06],E.easeOutCubic)(t);
    const box=560, cx=960, cy=515;
    c.save(); c.globalAlpha=sealOp;
    c.shadowColor='rgba(227,181,16,0.45)'; c.shadowBlur=50;
    c.drawImage(emblem, cx-box*sc/2, cy-box*sc/2, box*sc, box*sc);
    c.restore();
    // label
    c.save(); c.globalAlpha=sealOp;
    c.font='700 34px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle';
    c.letterSpacing='14px'; c.fillStyle='#e3b510';
    c.shadowColor='rgba(227,181,16,0.5)'; c.shadowBlur=26;
    c.fillText('IMPRISONED', cx+7, 816);
    c.letterSpacing='0px';
    c.restore();
  }
}

// ── master frame ────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  ctx.fillStyle='#050302'; ctx.fillRect(0,0,FW,FH);

  // the gate slam + IMPRISONED seal at full opacity (no trailer outro)
  drawGateScene(gx, t);
  ctx.drawImage(gc,0,0);

  // fade from black at the open
  const fadeIn = interp(T.fadeIn,[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "imprison_gate",
  bg: "#050302",
  duration: DURATION,
  video: "/animations/imprison_gate.mp4",
  fadeFromBlack: false, // the clip fades from black itself
  images: { emblem: "/imprisoned-emblem.png" },
  draw(c, t, AB, assets) {
    ctx = c;
    ensureLayers();
    emblem = assets.emblem || null; emblemOk = !!assets.emblem;
    drawFrame(t);
  },
};

export default clip;
