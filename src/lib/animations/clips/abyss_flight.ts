// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Abyss Flight - Video Export.html".
import type { ClipConfig } from "../engine";

// everything below copied VERBATIM from the source <script>, except:
//   * `const ctx = canvas.getContext('2d')` -> module-level `let ctx;` (set in draw)
//   * removed: canvas lookup, status/record button, load flags, previewLoop,
//     recordVideo/pickMime/onRecord, trailing requestAnimationFrame boot, window.drawFrame
const FW = 1920, FH = 1080, DURATION = 3.0;
let ctx;

// ── palette (spirit abyss → candlelit castle) ───────────────────────────────
const GOLD='#e3b510', WARM='#ffcf7a', SOUL='#7de0f0', CREAM='#ffefc5', PURPLE='#2a1c4a';

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const E = {
  linear:t=>t,
  easeInQuad:t=>t*t,
  easeOutQuad:t=>t*(2-t),
  easeInCubic:t=>t*t*t,
  easeOutCubic:t=>(--t)*t*t+1,
  easeInQuart:t=>t*t*t*t,
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
function frac(x){ return x-Math.floor(x); }
function radial(c, cx, cy, r, stops){
  const g=c.createRadialGradient(cx,cy,0,cx,cy,r);
  for(const [o,col] of stops) g.addColorStop(o,col);
  return g;
}

// ── flight curves ────────────────────────────────────────────────────────────
// accel: slow drift → rush into the gate
const accel = t => Math.pow(t/DURATION, 1.55);
// distance travelled through the warp field (monotonic, accelerating)
function warp(t){ const p=t/DURATION; return 0.45*p + 2.4*Math.pow(p,2.2); }
// castle apparent scale (exponential = constant-velocity perspective approach)
function castleScale(t){ return 0.05*Math.exp(5.9*accel(t)); }
// vanishing point with a soul's gentle sway that settles as we lock on the gate
function camera(t){
  const a=accel(t), settle=1-smooth(clamp((t/DURATION-0.45)/0.5,0,1));
  const rumble = smooth(clamp((t/DURATION-0.78)/0.22,0,1));
  return {
    x: 960 + Math.sin(t*1.6)*70*settle + Math.sin(t*40)*9*rumble,
    y: 452 + Math.cos(t*1.25)*40*settle + Math.cos(t*46)*7*rumble,
    a,
  };
}

// ── warp-field particles (deterministic from t) ─────────────────────────────
function mkField(n, salt){
  return Array.from({length:n},(_,i)=>{
    const ang=((i*97+salt*13)%360)/360*6.2832;
    const rho=0.04+((i*53+salt*7)%100)/100*0.95;
    return { ang, rho, z0:((i*71+salt*31)%100)/100, sz:((i*37+salt*17)%100)/100, layer: salt };
  });
}
// Particle counts trimmed from the source (120/34/90/7) so the flight stays
// smooth on phones — at flight speed the field reads the same.
const stars = mkField(54, 1);    // far, slow, cream
const wisps = mkField(16, 2);    // mid, soul cyan
const dust  = mkField(38, 3);    // near, fast, gold streaks
const banks = mkField(4, 4);     // huge dark cloud shards

function project(p, t, cx, cy, layerSpeed, spread){
  let z = frac(p.z0 - warp(t)*layerSpeed);
  if(z < 0.012) z = 0.012;
  const dx=Math.cos(p.ang)*p.rho*spread, dy=Math.sin(p.ang)*p.rho*spread*0.92;
  return { x: cx + dx/z, y: cy + dy/z, z };
}

function drawStreakField(c, t, cx, cy, field, opts){
  const {layerSpeed, spread, color, base, glow, streak} = opts;
  c.save();
  if(glow){ c.globalCompositeOperation='screen'; }
  for(const p of field){
    const cur=project(p, t, cx, cy, layerSpeed, spread);
    if(cur.x<-200||cur.x>FW+200||cur.y<-200||cur.y>FH+200) continue;
    const sz=clamp(base*(0.4+p.sz)*(1/cur.z)*0.06, 0.4, 30);
    const a=clamp((1-cur.z)*1.5,0,1)*clamp(cur.z*22,0,1);
    if(a<=0.01) continue;
    c.globalAlpha=a;
    if(streak){
      // trail from a slightly-farther z (motion blur toward vanishing point)
      const zb=Math.min(0.999, cur.z+0.05*layerSpeed);
      const dx=Math.cos(p.ang)*p.rho*spread, dy=Math.sin(p.ang)*p.rho*spread*0.92;
      const bx=cx+dx/zb, by=cy+dy/zb;
      c.strokeStyle=color; c.lineWidth=Math.max(1,sz*0.7); c.lineCap='round';
      // cap shadowBlur — large per-particle blur radii are the main mobile cost
      if(glow){ c.shadowColor=color; c.shadowBlur=Math.min(sz*1.4, 7); }
      c.beginPath(); c.moveTo(bx,by); c.lineTo(cur.x,cur.y); c.stroke();
    } else {
      c.fillStyle=color;
      if(glow){ c.shadowColor=color; c.shadowBlur=Math.min(sz*1.6, 8); }
      c.beginPath(); c.arc(cur.x,cur.y,sz,0,Math.PI*2); c.fill();
    }
  }
  c.restore();
}

// dark cloud shards drifting past for depth
function drawBanks(c, t, cx, cy){
  c.save();
  for(const p of banks){
    const cur=project(p, t, cx, cy, 0.5, 1600);
    if(cur.z>0.95||cur.z<0.02) continue;
    const sz=clamp((1/cur.z)*40, 30, 1400);
    const a=clamp((1-cur.z)*0.9,0,1)*clamp(cur.z*6,0,1)*0.55;
    c.globalAlpha=a;
    c.fillStyle=radial(c,cur.x,cur.y,sz,[[0,'rgba(10,7,20,0.9)'],[0.6,'rgba(14,9,26,0.5)'],[1,'rgba(14,9,26,0)']]);
    c.beginPath(); c.ellipse(cur.x,cur.y,sz,sz*0.66,p.ang,0,Math.PI*2); c.fill();
  }
  c.restore();
}

// ── the castle silhouette (built from primitives, backlit) ──────────────────
function drawCastle(c, cx, cy, s, p){
  // amber halo behind the castle (reads as light spilling through the abyss)
  const haloR = clamp(360*s, 60, 5200);
  c.save(); c.globalCompositeOperation='screen';
  // halo fades as we cross the threshold so blacks stay black going in
  const glowStr = interp([0,0.7,0.9],[0.55,0.95,1])(p) * clamp(1-Math.max(0,(p-0.82)/0.13), 0.18, 1);
  c.fillStyle=radial(c,cx,cy-90*s,haloR,[[0,`rgba(255,196,108,${0.32*glowStr})`],[0.4,`rgba(227,181,16,${0.16*glowStr})`],[1,'rgba(227,181,16,0)']]);
  c.fillRect(0,0,FW,FH);
  c.restore();

  c.save();
  c.translate(cx,cy); c.scale(s,s);
  const DARK='#08060f';

  // ---- floating rock the castle rests on (drawn first; castle sits atop) ----
  // small debris chunks drifting around the island
  const chunk=(x,y,w,h,rot)=>{
    c.save(); c.translate(x,y); c.rotate(rot);
    c.fillStyle=DARK; c.beginPath(); c.ellipse(0,0,w,h,0,0,Math.PI*2); c.fill();
    c.globalAlpha=interp([0.05,0.6],[0.2,0.7])(p); c.strokeStyle=WARM; c.lineWidth=1.6/Math.max(s,0.4);
    c.shadowColor=WARM; c.shadowBlur=6; c.beginPath(); c.ellipse(0,-h*0.2,w*0.8,h*0.5,0,Math.PI,0); c.stroke();
    c.restore();
  };
  chunk(-272,140,26,12,-0.3); chunk(262,176,30,13,0.25); chunk(-186,300,18,9,0.4); chunk(178,322,22,10,-0.2);

  // the island mass — craggy, tapering to a point below
  c.save();
  c.fillStyle=DARK;
  c.shadowColor='rgba(0,0,0,0.6)'; c.shadowBlur=30; c.shadowOffsetY=10;
  c.beginPath();
  c.moveTo(-208,16);
  c.lineTo(-150,4); c.lineTo(-88,14); c.lineTo(-18,2); c.lineTo(62,12); c.lineTo(142,0); c.lineTo(212,20);
  c.lineTo(190,74); c.lineTo(150,126); c.lineTo(118,182);
  c.lineTo(44,252); c.lineTo(2,290); c.lineTo(-32,236);
  c.lineTo(-82,188); c.lineTo(-134,126); c.lineTo(-178,72);
  c.closePath(); c.fill();
  c.restore();
  // lit plateau rim (top edge catches the castle's glow)
  c.save();
  c.globalAlpha=interp([0,0.5,0.85],[0.3,0.7,1])(p);
  c.strokeStyle=WARM; c.lineWidth=2.4/Math.max(s,0.4);
  c.shadowColor=WARM; c.shadowBlur=12; c.lineCap='round';
  c.beginPath();
  c.moveTo(-208,16); c.lineTo(-150,4); c.lineTo(-88,14); c.lineTo(-18,2); c.lineTo(62,12); c.lineTo(142,0); c.lineTo(212,20);
  c.stroke();
  c.restore();
  // a couple of faint facet cracks for texture
  c.save(); c.globalAlpha=0.5; c.strokeStyle='rgba(120,95,60,0.6)'; c.lineWidth=1.4/Math.max(s,0.4);
  c.beginPath(); c.moveTo(-120,40); c.lineTo(-70,150); c.moveTo(70,30); c.lineTo(20,180); c.moveTo(-10,60); c.lineTo(0,250); c.stroke();
  c.restore();

  // ---- silhouette mass ----
  c.fillStyle=DARK;
  // left & right towers
  c.fillRect(-168,-300,72,300);
  c.fillRect(96,-300,72,300);
  // keep
  c.fillRect(-100,-258,200,258);
  // tower roofs (cones)
  const tri=(x0,x1,apexX,apexY,baseY)=>{ c.beginPath(); c.moveTo(x0,baseY); c.lineTo(x1,baseY); c.lineTo(apexX,apexY); c.closePath(); c.fill(); };
  tri(-176,-88,-132,-372,-300);
  tri(88,176,132,-372,-300);
  // keep roof
  tri(-110,110,0,-336,-258);
  // battlements on keep
  for(let i=-90;i<90;i+=36){ c.fillRect(i,-274,20,18); }
  // small flanking spires
  c.fillRect(-30,-300,60,46);
  tri(-34,34,0,-356,-300);

  // ---- backlit gold rim on the silhouette edges ----
  c.save();
  c.globalAlpha=interp([0,0.5,0.85],[0.25,0.6,0.9])(p);
  c.strokeStyle=WARM; c.lineWidth=2.2/Math.max(s,0.4);
  c.shadowColor=WARM; c.shadowBlur=10;
  c.strokeRect(-168,-300,72,300); c.strokeRect(96,-300,72,300);
  c.beginPath(); c.moveTo(-176,-300); c.lineTo(-132,-372); c.lineTo(-88,-300); c.stroke();
  c.beginPath(); c.moveTo(88,-300); c.lineTo(132,-372); c.lineTo(176,-300); c.stroke();
  c.restore();

  // ---- glowing windows ----
  const win=(x,y,w,h)=>{ c.save(); c.shadowColor=WARM; c.shadowBlur=14; c.fillStyle=WARM; c.fillRect(x,y,w,h); c.restore(); };
  const wf=interp([0.05,0.35],[0,1])(p); // windows fade up as we near
  c.save(); c.globalAlpha=wf;
  win(-70,-210,16,26); win(-30,-210,16,26); win(12,-210,16,26); win(54,-210,16,26);
  win(-66,-150,16,24); win(48,-150,16,24);
  win(-150,-220,14,30); win(112,-220,14,30);
  win(-150,-150,14,26); win(112,-150,14,26);
  c.restore();

  // ---- the great gate we fly into (glow that darkens at the threshold) ----
  const gx=-30, gw=60, gh=64, gr=30;
  c.save();
  // arch path
  c.beginPath();
  c.moveTo(gx,0); c.lineTo(gx,-gh); c.arc(gx+gr,-gh,gr,Math.PI,0); c.lineTo(gx+gw,0); c.closePath();
  // interior: gold while distant, sinks to black as we cross the threshold
  const enter = clamp((p-0.8)/0.16,0,1);
  const ig=c.createRadialGradient(0,-gh*0.5,2,0,-gh*0.5,gw*1.1);
  ig.addColorStop(0, enter<0.5?'#fff2cf':'#120c06');
  ig.addColorStop(0.5, `rgba(255,196,108,${1-enter})`);
  ig.addColorStop(1, enter<0.5?'rgba(227,181,16,0.5)':'#05030a');
  c.fillStyle=ig; c.fill();
  // gate frame rim
  c.lineWidth=3/Math.max(s,0.5); c.strokeStyle=WARM; c.shadowColor=WARM; c.shadowBlur=12; c.stroke();
  c.restore();

  c.restore();
}

// ── master frame ────────────────────────────────────────────────────────────
function drawFrame(t){
  const p=t/DURATION;
  const cam=camera(t);
  const cx=cam.x, cy=cam.y;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0;

  // abyss void
  ctx.fillStyle=radial(ctx, cx, cy, 1500, [[0,'#160f2b'],[0.45,'#0c0819'],[1,'#05030a']]);
  ctx.fillRect(0,0,FW,FH);
  // faint vanishing-point glow (distant castle light) even before castle resolves
  ctx.save(); ctx.globalCompositeOperation='screen';
  ctx.fillStyle=radial(ctx, cx, cy, 520, [[0,'rgba(255,196,108,0.30)'],[0.5,'rgba(227,181,16,0.10)'],[1,'rgba(227,181,16,0)']]);
  ctx.fillRect(0,0,FW,FH); ctx.restore();

  // depth layers, far → near
  drawStreakField(ctx, t, cx, cy, stars, {layerSpeed:0.4, spread:900, color:'#d9d2ff', base:1.6, glow:true, streak:false});
  drawBanks(ctx, t, cx, cy);
  drawCastle(ctx, cx, cy, castleScale(t), p);
  drawStreakField(ctx, t, cx, cy, wisps, {layerSpeed:0.85, spread:1150, color:SOUL, base:3.4, glow:true, streak:true});
  drawStreakField(ctx, t, cx, cy, dust,  {layerSpeed:1.35, spread:1350, color:WARM, base:2.4, glow:true, streak:true});

  // soul aura — we ARE the soul, a cyan rim breathing at the edges, intensifying with speed
  ctx.save(); ctx.globalCompositeOperation='screen';
  const auraA=0.10+0.22*cam.a;
  ctx.fillStyle=radial(ctx, 960, 540, 1180, [[0.55,'rgba(125,224,240,0)'],[1,`rgba(125,224,240,${auraA})`]]);
  ctx.fillRect(0,0,FW,FH); ctx.restore();

  // gate bloom as we pierce the threshold
  const bloom=interp([0.78,0.86,0.93],[0,0.62,0.12],E.easeInQuad)(p);
  if(bloom>0.001){
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=bloom;
    ctx.fillStyle=radial(ctx, cx, cy, 1050, [[0,'#fff6e2'],[0.4,'#ffcf7a'],[1,'rgba(255,207,122,0)']]);
    ctx.fillRect(0,0,FW,FH); ctx.restore();
  }

  // crossing into the castle → darkness swallows from the doorway
  const bo=interp([0.86,1.0],[0,1],E.easeInQuart)(p);
  if(bo>0.001){
    const r=bo*2700;
    ctx.save();
    // receding doorway light at the rim
    ctx.globalCompositeOperation='screen'; ctx.globalAlpha=(1-bo)*0.9;
    ctx.strokeStyle=WARM; ctx.lineWidth=40*(1-bo)+6; ctx.shadowColor=WARM; ctx.shadowBlur=40;
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
    ctx.restore();
    // the dark interior
    ctx.save(); ctx.globalCompositeOperation='source-over';
    ctx.fillStyle='#000';
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // open from black
  const fadeIn=interp([0,0.06],[1,0],E.easeOutQuad)(p);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
  // guarantee pure black on the final frame
  if(p>=0.999){ ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); }
}

const clip: ClipConfig = {
  name: "abyss_flight",
  bg: "#05030a",
  duration: DURATION,
  fadeFromBlack: false,
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
