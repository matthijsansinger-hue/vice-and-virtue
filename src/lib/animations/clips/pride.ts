// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Pride Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// Pride flings their arms wide in a blaze of golden glory; the dazzled
// onlooker staggers back shielding their eyes — and scores nothing (∅).
const clip: ClipConfig = {
  name: "pride",
  bg: "#0c0406",
  poster: 1.5,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/pride.mp4",
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial,GOLD,WARM}=AB;
  const {rig,stage,shadow}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, cx=780, ox=1360, cy=540;

  stage(c,t,'vice');

  const flare=interp([0.3,0.9],[0,1],E.easeOutCubic)(t);
  const pose=interp([0.25,0.6],[0,1],E.easeOutBack)(t);   // arms flung wide
  const dazzled=interp([0.85,1.45],[0,1],E.easeOutCubic)(t);

  // dazzling radiant fan behind the proud figure
  if(flare>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.translate(cx,cy);
    for(let i=0;i<16;i++){ const a=(i/16)*6.283 + t*0.3; const len=lerp(60,380,clamp(flare,0,1))*(0.7+0.3*Math.sin(i*1.7));
      c.globalAlpha=clamp(flare,0,1)*0.5; c.strokeStyle= i%2? GOLD:WARM; c.lineWidth=8; c.shadowColor=GOLD; c.shadowBlur=18;
      c.beginPath(); c.moveTo(0,0); c.lineTo(Math.cos(a)*len,Math.sin(a)*len); c.stroke(); }
    c.restore();
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(flare,0,1)*0.7;
    c.fillStyle=radial(c,cx,cy,340,[[0,'rgba(255,207,122,0.7)'],[1,'rgba(255,207,122,0)']]); c.fillRect(cx-380,cy-380,760,760); c.restore();
  }

  // ── the proud one: chest out, head high, arms thrown wide ──
  shadow(c, cx, G+6, 140, 0.5);
  rig(c,{ x:cx, ground:G, s:1.05, facing:1, pal:'vice',
    lean: -0.1*pose, bow: -0.34*pose,
    handF:[ lerp(36,138,pose), lerp(-60,-236,pose) ], bendF:-1,
    handB:[ lerp(-28,-124,pose), lerp(-40,-228,pose) ], bendB:1,
    footF:[ 44, 186 ], footB:[ -44, 186 ],
    cape:0.8, capeSway: Math.sin(t*2.2)*0.06 - 0.06*pose,
    skirt:0.85, eyes:0.5+flare*0.5, eyeCol:'#ffcf7a', rim:1.0 });
  // gold laurel halo
  if(flare>0.1){ c.save(); c.globalAlpha=clamp(flare,0,1)*0.9; c.globalCompositeOperation='screen';
    c.lineWidth=4; c.strokeStyle=GOLD; c.shadowColor=GOLD; c.shadowBlur=18;
    c.beginPath(); c.arc(cx+12,G-186-210+4,52,0,Math.PI*2); c.stroke(); c.restore(); }

  // ── the dazzled onlooker: shields eyes, staggers back ──
  const stagger=dazzled*70;
  shadow(c, ox+stagger, G+6, 120, 0.45*(1-dazzled*0.3));
  c.save(); c.globalAlpha=clamp(1-dazzled*0.25,0,1);
  rig(c,{ x:ox+stagger, ground:G, s:0.92, facing:-1, pal:'shade',
    lean: -0.2*dazzled,
    handF:[ lerp(30,58,dazzled), lerp(-80,-224,dazzled) ], bendF:-1,  // forearm over the eyes
    handB:[ lerp(-24,-96,dazzled), lerp(-40,-140,dazzled) ], bendB:1,
    footF:[ 30+dazzled*44, 186 ], footB:[ -26-dazzled*20, 186 ], kneeB:1,
    cape:0.45, capeSway:0.28*dazzled, skirt:0.7, rim:0.6 });
  c.restore();
  if(dazzled>0.05){
    // ∅ score-nothing glyph over the onlooker
    c.save(); c.globalAlpha=clamp(dazzled,0,1); c.globalCompositeOperation='screen';
    c.translate(ox+stagger,cy-160); const s=clamp(dazzled,0,1);
    c.scale(s,s); c.strokeStyle=P.glow; c.lineWidth=8; c.shadowColor=P.glow; c.shadowBlur=16;
    c.beginPath(); c.arc(0,0,42,0,Math.PI*2); c.stroke();
    c.beginPath(); c.moveTo(-30,30); c.lineTo(30,-30); c.stroke();
    c.restore();
    // dazzle wash over the onlooker
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=dazzled*0.3;
    c.fillStyle=radial(c,ox,cy,260,[[0,'rgba(255,207,122,0.5)'],[1,'rgba(255,207,122,0)']]); c.fillRect(ox-300,cy-300,600,600); c.restore();
  }

  AB.ring(c,cx,cy,interp([0.95,1.65],[0,1])(t),GOLD,70,460);
  AB.motes(c,t,'rgba(255,160,90,0.6)',14);
  AB.grade(c,'vice',0.3);
  },
};

export default clip;
