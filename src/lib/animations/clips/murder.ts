// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Murder Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const FW = 1920, FH = 1080, DURATION = 2.0;
let ctx;

// ── palette ──────────────────────────────────────────────────────────────────
const VICE='#800020', BLOOD='#b8001c', WARM='#ffcf7a', CREAM='#ffefc5', FIG='#040305';

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
function vlin(c, x0,y0,x1,y1, stops){ const g=c.createLinearGradient(x0,y0,x1,y1); for(const [o,col] of stops) g.addColorStop(o,col); return g; }

// ── timeline (seconds) ──────────────────────────────────────────────────────
const WALK=[0.12,1.2], OPEN=[1.0,1.45], ENTER=[1.35,1.9], GLINT=[0.55,0.85], TITLE=[1.2,1.75];
// geometry
const WALL=626;                 // where back wall meets floor
const DOOR={x:884, w:172, top:300, bot:626};

function applyCam(t){
  const e=smooth(clamp(t/DURATION,0,1));
  const k=lerp(1.0,1.08,e);
  ctx.translate(960,540); ctx.scale(k,k); ctx.translate(-960,-lerp(540,548,e));
}

// ── corridor seen from a distance: back wall + door + receding floor ────────
function drawRoom(c, t){
  // back wall
  c.fillStyle=vlin(c,0,0,0,WALL,[[0,'#160a0e'],[0.7,'#0e0709'],[1,'#0a0507']]);
  c.fillRect(-200,-200,FW+400,WALL+200);
  // faint wall panels
  c.save(); c.globalAlpha=0.5; c.strokeStyle='rgba(0,0,0,0.55)'; c.lineWidth=2;
  for(let x=120;x<FW;x+=240){ c.strokeRect(x,150,190,WALL-220); } c.restore();
  // skirting
  c.fillStyle='#0a0506'; c.fillRect(-200,WALL-16,FW+400,16);
  // receding floor (perspective lines converge at door centre)
  c.fillStyle=vlin(c,0,WALL,0,FH,[[0,'#120a0b'],[1,'#070405']]); c.fillRect(-200,WALL,FW+400,FH-WALL+200);
  const vpx=DOOR.x+DOOR.w/2;
  c.strokeStyle='rgba(255,170,120,0.05)'; c.lineWidth=3;
  for(let i=-8;i<=8;i++){ const fx=960+i*260; c.beginPath(); c.moveTo(vpx,WALL); c.lineTo(fx,FH+60); c.stroke(); }
  for(let k=1;k<=5;k++){ const y=WALL+Math.pow(k/5,1.8)*(FH-WALL); c.beginPath(); c.moveTo(-100,y); c.lineTo(FW+100,y); c.globalAlpha=0.05; c.stroke(); c.globalAlpha=1; }
}

function drawDoor(c, t){
  const {x,w,top,bot}=DOOR;
  const open=interp(OPEN,[0,1],E.easeOutCubic)(t);
  // frame
  c.fillStyle='#1a0f12'; c.fillRect(x-16,top-16,w+32,bot-top+16);
  // bright corridor revealed behind
  c.save(); c.beginPath(); c.rect(x,top,w,bot-top); c.clip();
  c.fillStyle=vlin(c,x,top,x,bot,[[0,'#ffd98c'],[0.5,'#f0a23c'],[1,'#7a3a12']]);
  c.fillRect(x,top,w,bot-top);
  c.globalCompositeOperation='screen';
  c.fillStyle=radial(c,x+w*0.5,bot-90,260*open+30,[[0,'rgba(255,225,150,0.7)'],[1,'rgba(255,180,90,0)']]);
  c.fillRect(x-30,top-30,w+60,bot-top+60);
  c.restore();
  // door panel swings inward (foreshorten from left hinge)
  const hingeX=x;
  c.save(); c.translate(hingeX,0); c.scale(1-open*0.9,1); c.translate(-hingeX,0);
  c.fillStyle='#0f0809'; c.fillRect(x,top,w,bot-top);
  c.strokeStyle='#241417'; c.lineWidth=5; c.strokeRect(x+10,top+12,w-20,(bot-top)-24);
  c.fillStyle='#b89b50'; c.beginPath(); c.arc(x+w-22,(top+bot)/2,6,0,Math.PI*2); c.fill();
  c.restore();
  // warm light spilling onto the floor
  if(open>0.04){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=open*0.75;
    c.fillStyle=vlin(c,x,bot,x,FH,[[0,'rgba(255,190,100,0.5)'],[1,'rgba(255,190,100,0)']]);
    c.beginPath(); c.moveTo(x+10,bot); c.lineTo(x+w-10,bot); c.lineTo(x+w+220,FH); c.lineTo(x-220,FH); c.closePath(); c.fill();
    c.restore(); }
  return {open};
}

// ── HER: walked from foreground toward the door, seen from behind, knife in hand
function drawHer(c, t, door){
  const approach=interp(WALK,[0,1],E.easeInOutQuad)(t);
  const enter=interp(ENTER,[0,1],E.easeInOutQuad)(t);
  const vpx=DOOR.x+DOOR.w/2;
  // path: large in foreground → small at the threshold
  const x=lerp(960, vpx, approach);
  const base=lerp(1010, DOOR.bot-6, approach) - enter*6;
  const s=lerp(1.05, 0.30, approach) * (1-enter*0.06);
  const stride=Math.sin(approach*22)* (1-approach*0.4);
  const bob=Math.abs(Math.sin(approach*22))*6*(1-approach*0.5);
  const alpha=1-interp([ENTER[0]+0.15,ENTER[1]],[0,1])(t); // fades as she crosses into the light

  c.save(); c.globalAlpha=clamp(alpha,0,1);
  c.translate(x, base - bob); c.scale(s, s);

  // contact shadow
  c.save(); c.globalAlpha=0.45*clamp(alpha,0,1); c.fillStyle='#000'; c.beginPath(); c.ellipse(0,8,150,26,0,0,Math.PI*2); c.fill(); c.restore();

  c.fillStyle=FIG;
  // legs (back view, alternating stride)
  c.save();
  const lf=stride*26, rf=-stride*26;
  c.beginPath(); c.moveTo(-58,0+Math.max(0,lf)); c.lineTo(-40,-210); c.lineTo(-6,-210); c.lineTo(-14,0+Math.max(0,lf)); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(14,0+Math.max(0,rf)); c.lineTo(6,-210); c.lineTo(40,-210); c.lineTo(58,0+Math.max(0,rf)); c.closePath(); c.fill();
  c.restore();
  // skirt/dress flaring from waist
  c.beginPath();
  c.moveTo(-58,-150); c.lineTo(-74,-300); c.quadraticCurveTo(0,-322,74,-300); c.lineTo(58,-150);
  c.quadraticCurveTo(0,-126,-58,-150); c.closePath(); c.fill();
  // torso/back tapering to shoulders
  c.beginPath();
  c.moveTo(-58,-300); c.lineTo(-72,-470); c.quadraticCurveTo(0,-506,72,-470); c.lineTo(58,-300);
  c.quadraticCurveTo(0,-322,-58,-300); c.closePath(); c.fill();
  // shoulders + head (back)
  c.beginPath(); c.arc(0,-544,46,0,Math.PI*2); c.fill();
  // ponytail / long hair down the back
  c.beginPath(); c.moveTo(-22,-560); c.quadraticCurveTo(-40,-470,-20,-380); c.quadraticCurveTo(0,-360,20,-380); c.quadraticCurveTo(40,-470,22,-560);
  c.quadraticCurveTo(0,-590,-22,-560); c.closePath(); c.fill();

  // right arm at side holding a knife (blade pointing down)
  c.save();
  c.strokeStyle=FIG; c.lineWidth=30; c.lineCap='round';
  const swing=stride*16;
  const hx=86, hy=-250+swing;
  c.beginPath(); c.moveTo(64,-456); c.lineTo(80,-340); c.lineTo(hx,hy); c.stroke();
  c.fillStyle=FIG; c.beginPath(); c.arc(hx,hy,16,0,Math.PI*2); c.fill();
  // knife pointing down from fist
  c.save(); c.translate(hx,hy); c.rotate(0.18);
  c.fillStyle='#1a120c'; c.fillRect(-7,-4,14,26);   // handle
  c.fillStyle='#5a4226'; c.fillRect(-11,20,22,7);   // guard
  const bg=c.createLinearGradient(0,26,0,150); bg.addColorStop(0,'#c2ccd8'); bg.addColorStop(0.5,'#eef4fb'); bg.addColorStop(1,'#9aa6b2');
  c.fillStyle=bg; c.beginPath(); c.moveTo(-12,27); c.lineTo(-6,140); c.lineTo(0,158); c.lineTo(6,140); c.lineTo(12,27); c.closePath(); c.fill();
  c.strokeStyle='rgba(255,255,255,0.8)'; c.lineWidth=2; c.beginPath(); c.moveTo(-8,30); c.lineTo(-3,140); c.stroke();
  c.restore();
  c.restore();

  // warm rim light from the open door once she's close
  const rim=door.open*approach;
  if(rim>0.05){ c.save(); c.globalAlpha=rim*0.8; c.lineWidth=4; c.strokeStyle=WARM; c.shadowColor=WARM; c.shadowBlur=14;
    c.beginPath(); c.moveTo(72,-470); c.quadraticCurveTo(0,-506,-2,-506); c.stroke();
    c.beginPath(); c.arc(0,-544,46,-Math.PI*0.85,-Math.PI*0.1); c.stroke(); c.restore(); }

  c.restore();
  return {approach, knifeX:x+s*hxApproxOffset(s), s};
}
function hxApproxOffset(s){ return 86; }

// ── master frame ─────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0;
  ctx.fillStyle='#0b0608'; ctx.fillRect(0,0,FW,FH);

  ctx.save();
  applyCam(t);
  drawRoom(ctx, t);
  const door=drawDoor(ctx, t);
  drawHer(ctx, t, door);

  // knife glint while she walks (catches a stray light)
  const glint=interp([GLINT[0],(GLINT[0]+GLINT[1])/2,GLINT[1]],[0,1,0])(t);
  if(glint>0.01){ const a=interp(WALK,[0,1],E.easeInOutQuad)(t); const gx=lerp(1046,DOOR.x+DOOR.w/2+26,a); const gy=lerp(770,560,a);
    ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=glint;
    ctx.fillStyle=radial(ctx,gx,gy,80,[[0,'#ffffff'],[0.3,'rgba(220,235,255,0.7)'],[1,'rgba(220,235,255,0)']]);
    ctx.beginPath(); ctx.arc(gx,gy,80,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(gx-60,gy); ctx.lineTo(gx+60,gy); ctx.moveTo(gx,gy-60); ctx.lineTo(gx,gy+60); ctx.stroke();
    ctx.restore(); }
  ctx.restore();

  // blood-red dread grade + vignette
  const dread=interp([WALK[0],ENTER[1]],[0.18,0.55],E.easeInQuad)(t);
  ctx.save(); ctx.globalCompositeOperation='multiply';
  ctx.fillStyle=radial(ctx,960,560,1180,[[0.4,'rgba(255,255,255,1)'],[1,`rgba(128,0,32,${dread})`]]); ctx.fillRect(0,0,FW,FH); ctx.restore();
  ctx.fillStyle=radial(ctx,960,520,1240,[[0.42,'rgba(0,0,0,0)'],[1,'rgba(2,0,1,0.92)']]); ctx.fillRect(0,0,FW,FH);

  // open from black
  const fadeIn=interp([0,0.12],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "murder",
  bg: "#0b0608",
  duration: DURATION,
  fadeFromBlack: false,
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
