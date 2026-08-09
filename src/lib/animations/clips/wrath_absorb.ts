// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Wrath Absorb Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// Wrath reaches out a clawed hand; a follower is dragged in, dissolving into
// a soul-stream that forms a burning heart on Wrath's chest — a life reclaimed.
const clip: ClipConfig = {
  name: "wrath_absorb",
  bg: "#0c0406",
  poster: 1.6,
  duration: 2.0,
  video: "/animations/wrath_absorb.mp4",
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial,frac}=AB;
  const {rig,stage,shadow,heart}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, Wx=700, Fx0=1330;

  stage(c,t,'vice');

  const reach=interp([0.18,0.55],[0,1],E.easeOutCubic)(t);
  const pull=interp([0.55,1.4],[0,1],E.easeInCubic)(t);
  const gain=interp([1.35,1.75],[0,1],E.easeOutBack)(t);

  // ── the follower: heels dug in, leaning away, dragged in and dissolving ──
  const fx=lerp(Fx0, Wx+180, pull);
  const fAlpha=clamp(1-pull*1.1,0,1);
  const fScale=lerp(0.97, 0.55, pull);
  if(fAlpha>0.01){
    shadow(c, fx, G+6, 120*fAlpha, 0.4*fAlpha);
    c.save(); c.globalAlpha=fAlpha;
    rig(c,{ x:fx, ground:G, s:fScale, facing:-1, pal:'shade',
      lean: -0.34*clamp(pull*2,0,1),
      bow: -0.2*pull,
      handF:[ 150, -160 ], bendF:-1,   // reaching back, resisting
      handB:[ 120, -180 ], bendB:1,
      footF:[ 90, 186 ], footB:[ 30, 186 ],  // heels dug in, dragged
      kneeF:-1, kneeB:-1,
      cape:0.5, capeSway:0.45*pull, skirt:0.7, rim:0.6,
      eyes:0.6*fAlpha, eyeCol:'#ffd7b0' });
    c.restore();
    // drag scuff lines at the heels
    if(pull>0.1 && pull<0.95){
      c.save(); c.globalAlpha=(1-pull)*0.5; c.strokeStyle='#5a3a30'; c.lineWidth=4; c.lineCap='round';
      for(let i=0;i<3;i++){ c.beginPath(); c.moveTo(fx+60+i*30, G-2+i*3); c.lineTo(fx+140+i*40, G-2+i*3); c.stroke(); }
      c.restore();
    }
  }

  // ── Wrath: imposing, reaching claw ──
  const hf=[ lerp(40,168,reach)-gain*40, lerp(-60,-196,reach)+gain*60 ];
  shadow(c, Wx, G+6, 150, 0.55);
  const W=rig(c,{ x:Wx, ground:G, s:1.12, facing:1, pal:'vice',
    lean: 0.12*reach - 0.06*gain,
    handF:hf, bendF:1,
    handB:[ -44, -110 ], bendB:-1,
    footF:[ 54, 186 ], footB:[ -52, 186 ],
    cape:0.85, capeSway: -0.1*reach + Math.sin(t*2.4)*0.05,
    skirt:0.9, eyes:0.7+gain*0.3, eyeCol:'#ff5a3c', rim:1.0 });
  // clawed fingers on the reaching hand
  c.save(); c.strokeStyle='#2e1216'; c.lineWidth=6; c.lineCap='round';
  for(let i=0;i<4;i++){ const a=-0.7+i*0.42;
    c.beginPath(); c.moveTo(W.handF[0],W.handF[1]);
    c.lineTo(W.handF[0]+Math.cos(a)*26, W.handF[1]+Math.sin(a)*26); c.stroke(); }
  c.restore();

  // soul-stream: wisps torn from the follower into Wrath's chest
  if(pull>0.05){
    c.save(); c.globalCompositeOperation='screen';
    for(let i=0;i<12;i++){
      const ph=frac(pull*1.5 - i*0.09); if(ph<=0.02||ph>=0.98) continue;
      const x=lerp(fx, W.chest[0], ph), y=lerp(600, W.chest[1], ph) - Math.sin(ph*Math.PI)*70;
      c.globalAlpha=Math.sin(ph*Math.PI)*0.9;
      c.fillStyle=i%2?'#ff8a6a':'#ffd27a'; c.shadowColor=P.glow; c.shadowBlur=12;
      c.beginPath(); c.arc(x,y,4+(i%3)*1.5,0,Math.PI*2); c.fill();
    }
    c.restore();
  }

  // the reclaimed life: a burning heart on Wrath's chest
  if(gain>0.02){
    const g=clamp(gain,0,1);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=g;
    c.fillStyle=radial(c,W.chest[0],W.chest[1],170,[[0,'rgba(255,90,60,0.6)'],[1,'rgba(255,90,60,0)']]);
    c.fillRect(W.chest[0]-190,W.chest[1]-190,380,380); c.restore();
    c.save(); c.globalAlpha=g; heart(c, W.chest[0], W.chest[1], 38*g, '#ff8a6a', P.glow); c.restore();
    AB.ring(c,W.chest[0],W.chest[1],interp([1.45,1.9],[0,1])(t),P.glow,40,320);
  }
  AB.motes(c,t,'rgba(255,120,90,0.6)',14);
  AB.grade(c,'vice',0.33);
  },
};

export default clip;
