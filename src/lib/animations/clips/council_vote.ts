// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Council Vote - Video Export.html"
// (2026 phase-transition rework). Plays as the consultation phase stinger.
// Everything below copied VERBATIM from the source <script>, except:
//   * `const ctx = canvas.getContext('2d')` -> module-level `let ctx;` (set in draw)
//   * the source's <img> load -> `emblem`/`emblemOk` set from `assets` in draw
//   * removed: canvas/status/record lookups, load flags, previewLoop,
//     recordVideo/pickMime/onRecord, trailing requestAnimationFrame boot, window.drawFrame
import type { ClipConfig } from "../engine";

const FW = 1920, FH = 1080, DURATION = 3.0;
let ctx;
let emblem, emblemOk;

// ── palette (Consultation / council vote) ───────────────────────────────────
const GREEN='#06570d', VOTE='#9af593', PARCH='#f4eea9', GOLD='#e3b510', WARM='#ffcf7a',
      CREAM='#ffefc5', WOOD='#4e3624', STONE='#3a3631', FIG='#0c0a07', BURG='#800020';

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const E = {
  linear:t=>t, easeInQuad:t=>t*t, easeOutQuad:t=>t*(2-t),
  easeInOutQuad:t=>t<0.5?2*t*t:-1+(4-2*t)*t,
  easeInCubic:t=>t*t*t, easeOutCubic:t=>(--t)*t*t+1,
  easeOutBack:t=>{const c1=1.9,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);},
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
function radial(c, cx, cy, r, stops){ const g=c.createRadialGradient(cx,cy,0,cx,cy,r); for(const [o,col] of stops) g.addColorStop(o,col); return g; }
function vlin(c, x0,y0,x1,y1, stops){ const g=c.createLinearGradient(x0,y0,x1,y1); for(const [o,col] of stops) g.addColorStop(o,col); return g; }

// ── timeline (absolute seconds) ─────────────────────────────────────────────
const POINT=[0.6,1.25], TALLY=[1.05,1.95], VERDICT=1.95, BARS=[2.05,2.7];
const TXT1=[0.7,1.2], TXT2=[1.95,2.45];
const FLOOR=905;


// ── camera ───────────────────────────────────────────────────────────────────
function applyCam(c, t){
  const e=smooth(clamp(t/2.2,0,1));
  const k=lerp(1.02,1.10,e);
  const fx=960, fy=lerp(540,604,e);
  const shake=interp([VERDICT,VERDICT+0.06,VERDICT+0.32],[0,1,0],E.easeOutQuad)(t);
  c.translate(960+Math.sin(t*70)*7*shake, 540+Math.cos(t*82)*5*shake);
  c.scale(k,k); c.translate(-fx,-fy);
}

// ── council member (rigged, robed, standing behind the bench) ─────────────
function drawMember(c, m, t){
  const raise=interp([POINT[0]+m.delay, POINT[1]+m.delay],[0,1],E.easeOutCubic)(t);
  if(window.AB){
    const {rig}=AB.RIG;
    const s=1.9*m.s, G=m.y+445*m.s;   // keeps the head where the old silhouette had it
    const murmur=Math.sin(t*2.1+m.x*0.01)*0.014;
    const point=m.point? raise : 0;
    rig(c,{ x:m.x, ground:G, s, facing:m.face,
      pal:AB.RIG.PAL[m.pal]||AB.RIG.PAL.shade, hoodUp:m.hood!==false,
      lean:0.05+point*0.11+murmur,
      handF: point>0.02? [lerp(26,148,point), lerp(-84,-186,point)] : null,
      relaxF: point<=0.02, relaxB:true, bendF:1,
      cape:0.4, capeSway:murmur*2.4, skirt:1,
      eyes:0.35+0.4*point, eyeCol:WARM, rim:0.6+0.3*point });
  }

  // murmuring speech bubble (discussion)
  const bp=interp([m.bub, m.bub+0.18, m.bub+0.7, m.bub+0.9],[0,1,1,0],E.easeOutBack)(t);
  if(bp>0.02){
    const bx=m.x + m.face*-10, by=m.y - 300*m.s - 70;
    c.save(); c.globalAlpha=clamp(bp,0,1); c.translate(bx,by); c.scale(clamp(bp,0,1),clamp(bp,0,1));
    c.fillStyle=PARCH; c.beginPath(); c.roundRect(-46,-30,92,52,12); c.fill();
    c.beginPath(); c.moveTo(-6,20); c.lineTo(8,42); c.lineTo(16,20); c.closePath(); c.fill();
    c.fillStyle=GREEN; for(let i=0;i<3;i++){ c.beginPath(); c.arc(-22+i*22,-4,7,0,Math.PI*2); c.fill(); }
    c.restore();
  }
}

const COUNCIL=[
  {x:300, y:612, s:0.60, face:1,  point:true,  delay:0.10, bub:0.45, pal:'shade'},
  {x:512, y:548, s:0.70, face:1,  point:false, delay:0.30, bub:0.95, pal:'virtue2', hood:false},
  {x:716, y:512, s:0.76, face:1,  point:true,  delay:0.00, bub:1.35, pal:'vice2'},
  {x:1204,y:512, s:0.76, face:-1, point:true,  delay:0.18, bub:0.70, pal:'virtue'},
  {x:1408,y:548, s:0.70, face:-1, point:false, delay:0.42, bub:1.15, pal:'shade', hood:false},
  {x:1620,y:612, s:0.60, face:-1, point:true,  delay:0.06, bub:1.55, pal:'vice'},
];

// ── chamber backdrop ─────────────────────────────────────────────────────────
function drawChamber(c, t){
  // stone walls
  c.fillStyle=vlin(c,0,0,0,FH,[[0,'#2b2720'],[0.6,'#1b1812'],[1,'#100d09']]);
  c.fillRect(-200,-200,FW+400,FH+400);
  c.save(); c.globalAlpha=0.14; c.strokeStyle='#000'; c.lineWidth=3;
  for(let y=70;y<FLOOR;y+=96){ c.beginPath(); c.moveTo(-100,y); c.lineTo(FW+100,y); c.stroke(); for(let x=-60+((y/96)%2)*120;x<FW+100;x+=240){ c.beginPath(); c.moveTo(x,y); c.lineTo(x,y+96); c.stroke(); } }
  c.restore();
  // green council banner behind centre
  c.save();
  c.fillStyle=GREEN; c.beginPath(); c.moveTo(800,70); c.lineTo(1120,70); c.lineTo(1120,360); c.lineTo(960,406); c.lineTo(800,360); c.closePath(); c.fill();
  c.strokeStyle=GOLD; c.lineWidth=5; c.globalAlpha=0.8; c.stroke(); c.globalAlpha=1;
  // banner emblem ring
  c.strokeStyle=GOLD; c.lineWidth=6; c.beginPath(); c.arc(960,200,52,0,Math.PI*2); c.stroke();
  c.fillStyle='rgba(227,181,16,0.18)'; c.beginPath(); c.arc(960,200,52,0,Math.PI*2); c.fill();
  // a small scales-of-justice mark (two pans on a beam)
  c.strokeStyle=GOLD; c.lineWidth=4; c.beginPath(); c.moveTo(960,176); c.lineTo(960,224); c.moveTo(934,188); c.lineTo(986,188); c.stroke();
  c.beginPath(); c.arc(934,200,12,0,Math.PI); c.arc(986,200,12,0,Math.PI); c.stroke();
  c.restore();
  // candle glows
  [[150,360],[1780,340],[960,120]].forEach(([gx,gy],i)=>{ const fl=0.8+0.2*Math.sin(t*15+i*2)*Math.sin(t*6+i);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=fl*0.8;
    c.fillStyle=radial(c,gx,gy,380,[[0,'rgba(255,150,50,0.45)'],[1,'rgba(255,150,50,0)']]); c.fillRect(gx-400,gy-400,800,800); c.restore(); });
}

// ── bench + floor (drawn over the council row so they stand behind it) ──────
function drawBench(c, t){
  // curved council bench
  c.fillStyle=WOOD; c.save(); c.beginPath(); c.ellipse(960,560,820,170,0,Math.PI,0,true); c.lineTo(1780,720); c.ellipse(960,720,820,170,0,0,Math.PI,false); c.closePath(); c.fill();
  c.fillStyle='#3a281a'; c.beginPath(); c.ellipse(960,560,820,170,0,Math.PI,0,true); c.lineTo(1780,640); c.ellipse(960,640,820,140,0,0,Math.PI,false); c.closePath(); c.fill(); c.restore();
  // bench front skirt down to the floor (hides the members' legs)
  c.fillStyle='#241608'; c.beginPath();
  c.moveTo(1780,720); c.ellipse(960,720,820,170,0,0,Math.PI,false);
  c.lineTo(140,FLOOR+16); c.lineTo(1780,FLOOR+16); c.closePath(); c.fill();
  // floor
  c.fillStyle=vlin(c,0,FLOOR,0,FH,[[0,'#2a2018'],[1,'#0c0805']]); c.fillRect(-200,FLOOR,FW+400,FH-FLOOR+200);
  // central dais
  c.fillStyle='#241a12'; c.beginPath(); c.ellipse(960,FLOOR+6,300,52,0,0,Math.PI*2); c.fill();
  // spotlight shaft onto the accused (parchment light from above), tightens at verdict
  const tighten=interp([VERDICT-0.1,BARS[1]],[1,0.66],E.easeOutCubic)(t);
  c.save(); c.globalCompositeOperation='screen';
  const topW=120*tighten, botW=300*tighten;
  c.fillStyle=vlin(c,960,120,960,FLOOR,[[0,'rgba(244,238,169,0.30)'],[1,'rgba(244,238,169,0.05)']]);
  c.beginPath(); c.moveTo(960-topW,120); c.lineTo(960+topW,120); c.lineTo(960+botW,FLOOR); c.lineTo(960-botW,FLOOR); c.closePath(); c.fill();
  c.fillStyle=radial(c,960,FLOOR,300*tighten,[[0,'rgba(244,238,169,0.4)'],[1,'rgba(244,238,169,0)']]); c.fillRect(660,640,600,360);
  c.restore();
}

// ── the accused (rigged, spotlit, cowers as the votes mount) ────────────────
function drawAccused(c, t){
  if(!window.AB) return;
  const {rig, shadow}=AB.RIG;
  const cower=interp([POINT[0],TALLY[1]],[0,1],E.easeInOutQuad)(t);
  const tremble=Math.sin(t*12)*0.010*cower;
  const x=960, G=FLOOR-2, s=0.98;
  shadow(c, x, G+6, 120, 0.5);
  rig(c,{ x, ground:G, s, facing:1,
    pal:{ cloth:'#3c332c', clothD:'#262019', under:'#141009', skin:'#c9a27e',
      trim:'#6e5a28', rim:'rgba(244,238,169,0.95)', boot:'#171310', glove:'#1c1712' },
    hoodUp:false,
    lean:0.02+cower*0.07+tremble, bow:0.2+cower*0.8,
    hipH:186-cower*18,
    footF:[24,186], footB:[-22,186], kneeF:-1, kneeB:-1,
    handF:[30,-44+cower*14], handB:[6,-40+cower*14], bendF:1, bendB:-1,   // hands wringing at the belt
    cape:0.12, skirt:0.85,
    eyes:0, rim:0.95 });
}

// ── vote tally pips (fill green during the vote) ────────────────────────────
function drawTally(c, t){
  const op=interp([TALLY[0]-0.1, TALLY[0]+0.1],[0,1])(t);
  if(op<=0.01) return;
  const n=6, gap=46, y=430, x0=960-(n-1)*gap/2;
  c.save(); c.globalAlpha=op; c.textAlign='center';
  for(let i=0;i<n;i++){
    const f=interp([TALLY[0]+i*((TALLY[1]-TALLY[0])/n), TALLY[0]+i*((TALLY[1]-TALLY[0])/n)+0.12],[0,1],E.easeOutBack)(t);
    const x=x0+i*gap;
    c.beginPath(); c.arc(x,y,15,0,Math.PI*2);
    c.fillStyle='rgba(0,0,0,0.4)'; c.fill();
    c.lineWidth=3; c.strokeStyle='rgba(154,245,147,0.5)'; c.stroke();
    if(f>0.02){ c.save(); c.translate(x,y); c.scale(f,f);
      c.fillStyle=VOTE; c.shadowColor=VOTE; c.shadowBlur=14; c.beginPath(); c.arc(0,0,13,0,Math.PI*2); c.fill();
      // little check
      c.strokeStyle='#06310a'; c.lineWidth=3; c.lineCap='round'; c.beginPath(); c.moveTo(-6,0); c.lineTo(-1,5); c.lineTo(7,-6); c.stroke();
      c.restore(); }
  }
  c.restore();
}

// ── verdict: imprisoned emblem stamps over the accused + bars descend ───────
function drawVerdict(c, t){
  // bar shadows descending over the accused
  const bp=interp(BARS,[0,1],E.easeOutCubic)(t);
  if(bp>0.01){
    c.save(); c.globalAlpha=clamp(bp,0,1)*0.85;
    c.fillStyle='rgba(8,6,4,0.9)';
    for(let i=-2;i<=2;i++){ const bx=960+i*64; const top=lerp(-260,300,bp); c.fillRect(bx-9, top, 18, FLOOR-top+6); }
    // top rail
    c.fillRect(960-180, lerp(-40,300,bp), 360, 16);
    c.restore();
  }
  // emblem stamp
  const eo=interp([VERDICT, VERDICT+0.05],[0,1])(t);
  if(eo>0.001){
    const sc=interp([VERDICT, VERDICT+0.1, VERDICT+0.26],[2.6,0.92,1.0],E.easeOutCubic)(t);
    const size=360, cx=960, cy=540;
    c.save(); c.globalAlpha=eo; c.translate(cx,cy); c.scale(sc,sc);
    c.shadowColor='rgba(227,181,16,0.5)'; c.shadowBlur=44;
    if(emblemOk){ c.drawImage(emblem, -size/2,-size/2,size,size); }
    else { c.fillStyle=GOLD; c.beginPath(); c.arc(0,0,size/2,0,Math.PI*2); c.fill(); }
    c.restore();
    // impact ring
    const ring=interp([VERDICT,VERDICT+0.3],[0,1])(t);
    if(ring<1){ c.save(); c.globalAlpha=(1-ring)*0.8; c.globalCompositeOperation='screen';
      c.strokeStyle=GOLD; c.lineWidth=10*(1-ring)+2; c.shadowColor=GOLD; c.shadowBlur=24;
      c.beginPath(); c.arc(960,540,lerp(120,560,ring),0,Math.PI*2); c.stroke(); c.restore(); }
  }
}

// ── staged caption ───────────────────────────────────────────────────────────
function drawCaption(c, t){
  const o1=interp(TXT1,[0,1],E.easeOutCubic)(t);
  const o2=interp(TXT2,[0,1],E.easeOutCubic)(t);
  const scrim=Math.max(o1,o2);
  if(scrim<=0.001) return;
  c.save();
  c.fillStyle=radial(c,960,962,680,[[0,`rgba(8,6,3,${0.66*scrim})`],[0.7,`rgba(8,6,3,${0.36*scrim})`],[1,'rgba(8,6,3,0)']]);
  c.fillRect(0,640,FW,FH-640);
  c.textAlign='center'; c.textBaseline='middle'; c.shadowColor='rgba(0,0,0,0.9)'; c.shadowBlur=22;
  c.globalAlpha=o1; c.font='600 52px Cinzel, serif'; c.letterSpacing='3px'; c.fillStyle=CREAM;
  c.fillText('Expose the enemy.', 960, 936 + (1-o1)*14);
  c.globalAlpha=o2; c.font='700 60px Cinzel, serif'; c.letterSpacing='3px'; c.fillStyle=GOLD;
  c.shadowColor='rgba(227,181,16,0.4)'; c.fillText('Vote to imprison.', 960, 1010 + (1-o2)*14);
  c.letterSpacing='0px'; c.restore();
}

// ── master frame ──────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  ctx.fillStyle='#14110b'; ctx.fillRect(0,0,FW,FH);

  ctx.save();
  applyCam(ctx, t);
  drawChamber(ctx, t);
  COUNCIL.forEach(m=>drawMember(ctx, m, t));
  drawBench(ctx, t);
  drawAccused(ctx, t);
  drawTally(ctx, t);
  drawVerdict(ctx, t);
  ctx.restore();

  // warm grade + vignette
  ctx.save(); ctx.globalCompositeOperation='soft-light'; ctx.globalAlpha=0.4;
  ctx.fillStyle=radial(ctx,960,540,1100,[[0,'#ffcf7a'],[1,'#140a04']]); ctx.fillRect(0,0,FW,FH); ctx.restore();
  ctx.fillStyle=radial(ctx,960,540,1220,[[0.45,'rgba(0,0,0,0)'],[1,'rgba(8,5,2,0.8)']]); ctx.fillRect(0,0,FW,FH);

  drawCaption(ctx, t);

  // open from black
  const fadeIn=interp([0,0.18],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "council_vote",
  bg: "#14110b",
  duration: 4.0,
  sourceDuration: DURATION,
  fadeFromBlack: false,
  images: { emblem: "/imprisoned-emblem.png" },
  draw(c, t, AB, assets) {
    ctx = c;
    emblem = assets.emblem;
    emblemOk = !!emblem;
    drawFrame(t);
  },
};

export default clip;
