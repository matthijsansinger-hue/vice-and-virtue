// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Justice Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The champion braces, raises a heater shield, and a spectral red blade
// shatters against the blooming ward. The scales emblem seals the protection.
const clip: ClipConfig = {
  name: "justice",
  bg: "#050818",
  poster: 1.55,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,shield,PAL}=AB.RIG;
  const P=AB.CAMP.virtue, V=AB.CAMP.vice;
  const G=940, cx=880;

  stage(c,t,'virtue');

  const raise=interp([0.2,0.5],[0,1],E.easeOutCubic)(t);   // shield comes up
  const brace=interp([0.72,0.84],[0,1],E.easeOutQuad)(t);  // impact recoil
  const dome=interp([0.78,1.05],[0,1],E.easeOutBack)(t);   // ward blooms
  const breathe=Math.sin(t*3)*0.015;

  // knight — braced side stance, shield forward
  const hf=[ lerp(30,118,raise), lerp(-60,-176,raise) ];
  shadow(c, cx, G+6, 140, 0.5);
  const A=rig(c,{ x:cx, ground:G, s:1.05, facing:1, pal:'virtue',
    lean: 0.10*raise - 0.10*brace + breathe,
    handF:hf, bendF:1,
    handB:[ -46, -120+raise*8 ], bendB:-1,
    footF:[ 58+raise*22, 186 ], footB:[ -58-raise*10, 186 ],
    hipH: 186-14*raise, cape:0.7, capeSway: -0.08*raise + 0.2*brace,
    skirt:0.85, eyes:0.5+dome*0.5, eyeCol:'#bcd6ff', rim:0.95 });
  // heater shield in the forward hand
  shield(c, A.handF[0]+16, A.handF[1]-6, 1.25, PAL.virtue, (cc)=>{
    cc.strokeStyle='#c99b2e'; cc.lineWidth=5; cc.lineCap='round';
    cc.beginPath(); cc.moveTo(0,-30); cc.lineTo(0,26); cc.moveTo(-24,-14); cc.lineTo(24,-14); cc.stroke();
    cc.beginPath(); cc.arc(-24,-2,10,0,Math.PI); cc.arc(24,-2,10,0,Math.PI); cc.stroke();
  });

  // incoming spectral blade (from the right, point-first)
  const strike=interp([0.3,0.8],[0,1],E.easeInQuad)(t);
  const deflect=interp([0.78,1.0],[0,1])(t);
  if(t<1.02){
    const sx=lerp(1780,cx+300,strike), sy=lerp(380,540,strike);
    c.save(); c.globalAlpha=clamp(1-deflect,0,1);
    c.translate(sx,sy); c.rotate(Math.PI+Math.atan2(540-380,(cx+300)-1780)*-0.0+0); c.rotate(-0.18);
    c.save(); c.globalCompositeOperation='screen'; c.strokeStyle=V.glow; c.lineWidth=9; c.shadowColor=V.glow; c.shadowBlur=24;
    c.beginPath(); c.moveTo(60,0); c.lineTo(260,0); c.stroke(); c.restore();
    const bg=c.createLinearGradient(-120,0,0,0); bg.addColorStop(0,'#5a1620'); bg.addColorStop(1,'#ff8a6a');
    c.fillStyle=bg; c.beginPath(); c.moveTo(-120,-10); c.lineTo(-8,-4); c.lineTo(0,0); c.lineTo(-8,4); c.lineTo(-120,10); c.closePath(); c.fill();
    c.save(); c.globalCompositeOperation='screen'; c.shadowColor=V.glow; c.shadowBlur=18;
    c.strokeStyle='#ffb09a'; c.lineWidth=2.4; c.beginPath(); c.moveTo(-116,-5); c.lineTo(-10,-1); c.stroke(); c.restore();
    c.restore();
  }

  // ward dome blooming from the shield
  if(dome>0.01){
    const dx=A.handF[0]+30, dy=A.handF[1]-10, r=lerp(60,330,clamp(dome,0,1.06));
    c.save(); c.globalCompositeOperation='screen';
    c.globalAlpha=clamp(dome,0,1)*(0.55+0.16*Math.sin(t*8));
    c.strokeStyle=P.glow; c.lineWidth=6; c.shadowColor=P.glow; c.shadowBlur=26;
    c.beginPath(); c.arc(dx,dy,r,-Math.PI*0.62,Math.PI*0.62); c.stroke();
    c.globalAlpha=clamp(dome,0,1)*0.12;
    c.fillStyle=radial(c,dx,dy,r,[[0,'rgba(125,180,255,0.5)'],[1,'rgba(125,180,255,0)']]);
    c.beginPath(); c.arc(dx,dy,r,-Math.PI*0.62,Math.PI*0.62); c.lineTo(dx,dy); c.closePath(); c.fill();
    c.globalAlpha=clamp(dome,0,1)*0.3; c.lineWidth=1.5;
    for(let a=-2;a<=2;a++){ const ang=a*0.42+t*0.3; c.beginPath(); c.moveTo(dx,dy); c.lineTo(dx+Math.cos(ang)*r,dy+Math.sin(ang)*r); c.stroke(); }
    c.restore();
  }
  // deflect sparks at the contact point
  if(deflect>0 && deflect<1){
    const hx=A.handF[0]+120, hy=A.handF[1]-40;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-deflect); c.strokeStyle='#fff'; c.lineWidth=3; c.shadowColor=P.glow; c.shadowBlur=20;
    for(let i=0;i<9;i++){ const a=i/9*6.28; const r=20+deflect*100; c.beginPath(); c.moveTo(hx,hy); c.lineTo(hx+Math.cos(a)*r,hy+Math.sin(a)*r); c.stroke(); }
    c.restore();
  }
  // scales emblem rises above
  const em=interp([1.05,1.45],[0,1],E.easeOutCubic)(t);
  if(em>0.01){
    c.save(); c.globalAlpha=clamp(em,0,1); c.globalCompositeOperation='screen'; c.translate(cx+60,360); c.scale(em,em);
    c.strokeStyle=P.soft; c.lineWidth=6; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=18;
    c.beginPath(); c.moveTo(0,-34); c.lineTo(0,44); c.moveTo(-72,-12); c.lineTo(72,-12); c.stroke();
    c.beginPath(); c.arc(-72,12,26,0,Math.PI); c.arc(72,12,26,0,Math.PI); c.stroke();
    c.beginPath(); c.moveTo(-72,-12); c.lineTo(-90,12); c.moveTo(-72,-12); c.lineTo(-54,12); c.moveTo(72,-12); c.lineTo(54,12); c.moveTo(72,-12); c.lineTo(90,12); c.stroke();
    c.beginPath(); c.arc(0,-44,7,0,Math.PI*2); c.stroke();
    c.restore();
  }
  AB.ring(c,A.handF[0]+30,A.handF[1]-10,interp([0.95,1.6],[0,1])(t),P.glow,80,470);
  AB.motes(c,t,'rgba(125,180,255,0.7)',14);
  AB.grade(c,'virtue',0.32);
  },
};

export default clip;
