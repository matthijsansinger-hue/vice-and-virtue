// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Determination Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// He presses the great barbell overhead; the plates shrink as he grows
// lighter and lighter, until a heart bursts free — an extra life earned.
const clip: ClipConfig = {
  name: "determination",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/determination.mp4",
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,heart}=AB.RIG;
  const P=AB.CAMP.virtue;
  const G=940, cx=960;

  stage(c,t,'virtue');

  const lift=interp([0.18,0.75],[0,1],E.easeInOutQuad)(t);   // press overhead
  const strain=Math.sin(t*30)*3*(lift>0.1&&lift<0.9?1:0);
  const lighten=interp([0.72,1.4],[0,1],E.easeOutCubic)(t);  // weight melts away
  const pop=interp([1.32,1.7],[0,1],E.easeOutBack)(t);       // the heart bursts free
  const floatY=lighten*22*(0.5+0.5*Math.sin(t*2.6));

  // lightening aura
  if(lighten>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=lighten*0.6;
    c.fillStyle=radial(c,cx,G-380-floatY,320,[[0,'rgba(140,190,255,0.5)'],[1,'rgba(140,190,255,0)']]);
    c.fillRect(cx-360,G-740,720,760); c.restore();
  }

  // ── the lifter ──
  const handY=lerp(-168,-296,lift)+strain*0.4;
  shadow(c, cx, G+6, lerp(140,100,lighten), 0.5*(1-lighten*0.5));
  const A=rig(c,{ x:cx, ground:G-floatY, s:1.0, facing:1, pal:'virtue',
    lean: 0.06*(1-lift)*2*0 + 0.02,
    bow: 0.3*(1-lift) - 0.18*lift,
    handF:[ 42, handY ], bendF:-1,
    handB:[ -42, handY ], bendB:1,
    footF:[ 52-lighten*18, 186 ], footB:[ -52+lighten*18, 186 ],
    hipH: lerp(150,186,lift),
    cape:0.55, capeSway: Math.sin(t*2)*0.03 - lighten*0.1,
    skirt:0.8, eyes:0.5+lighten*0.5, eyeCol:'#bcd6ff', rim:0.9 });

  // ── the barbell between his hands ──
  const bx=(A.handF[0]+A.handB[0])/2, by=(A.handF[1]+A.handB[1])/2+strain*0.3;
  const plate=lerp(62,10,lighten);
  c.save();
  c.fillStyle='#cdd7e6'; c.fillRect(bx-215,by-7,430,14);
  c.fillStyle='#9aa6b8';
  [-186,186].forEach(px=>{ c.beginPath(); c.roundRect(bx+px-13,by-plate,26,plate*2,6); c.fill(); });
  c.fillStyle='#7d8aa0';
  [-158,158].forEach(px=>{ c.beginPath(); c.roundRect(bx+px-10,by-plate*0.72,20,plate*1.44,5); c.fill(); });
  // grip hands over the bar
  c.fillStyle='#152238';
  c.beginPath(); c.arc(A.handF[0],A.handF[1],13,0,Math.PI*2); c.fill();
  c.beginPath(); c.arc(A.handB[0],A.handB[1],12,0,Math.PI*2); c.fill();
  c.restore();
  // effort sparks while straining
  if(lift>0.15 && lift<0.95){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.5;
    c.strokeStyle=P.soft; c.lineWidth=2.4; c.lineCap='round';
    for(let i=0;i<3;i++){ const a=-0.6-i*0.5;
      c.beginPath(); c.moveTo(cx+90+i*14, G-500); c.lineTo(cx+108+i*14, G-516); c.stroke();
      c.beginPath(); c.moveTo(cx-90-i*14, G-500); c.lineTo(cx-108-i*14, G-516); c.stroke(); }
    c.restore();
  }

  // ── the heart pops free ──
  if(pop>0.01){
    const hy=lerp(G-380, G-560, pop)-floatY, s=44*clamp(pop,0,1.08);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(pop,0,1);
    c.fillStyle=radial(c,cx,hy,200,[[0,'rgba(140,190,255,0.6)'],[1,'rgba(140,190,255,0)']]);
    c.fillRect(cx-220,hy-220,440,440); c.restore();
    heart(c, cx, hy, s, P.soft, P.glow);
    AB.ring(c,cx,hy,interp([1.45,1.9],[0,1])(t),P.glow,40,330);
    // rising sparkles
    c.save(); c.globalCompositeOperation='screen';
    for(let i=0;i<6;i++){ const ph=AB.frac(pop*1.2+i*0.16);
      c.globalAlpha=Math.sin(ph*Math.PI)*0.7*pop; c.fillStyle=P.soft;
      c.beginPath(); c.arc(cx+Math.sin(i*2.1)*90, hy+60-ph*160, 3,0,Math.PI*2); c.fill(); }
    c.restore();
  }
  AB.motes(c,t,'rgba(125,180,255,0.6)',14);
  AB.grade(c,'virtue',0.33);
  },
};

export default clip;
