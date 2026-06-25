// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Justice Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "justice",
  bg: "#050818",
  poster: 1.6,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
  const P=CAMP.virtue, V=CAMP.vice;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(125,180,255,0.7)',16);
  const cx=960, base=940, cy=560;

  figure(c,{x:cx,base,s:1.0,fill:FIG});

  const strike=interp([0.3,0.85],[0,1],E.easeInQuad)(t);
  const deflect=interp([0.82,1.02],[0,1])(t);
  if(t<1.05){
    const sx=lerp(1560,cx+212,strike), sy=lerp(330,cy,strike);
    c.save(); c.globalAlpha=clamp(1-deflect,0,1); c.translate(sx,sy); c.rotate(2.5);
    c.save(); c.globalCompositeOperation='screen'; c.strokeStyle=V.glow; c.lineWidth=9; c.shadowColor=V.glow; c.shadowBlur=22;
    c.beginPath(); c.moveTo(150,0); c.lineTo(330,0); c.stroke(); c.restore();
    c.fillStyle='#1a120c'; c.fillRect(-10,-7,36,14);
    const bg=c.createLinearGradient(26,0,150,0); bg.addColorStop(0,'#9aa6b2'); bg.addColorStop(1,'#eef4fb');
    c.fillStyle=bg; c.beginPath(); c.moveTo(26,-11); c.lineTo(154,0); c.lineTo(26,11); c.closePath(); c.fill();
    c.restore();
  }

  const sh=interp([0.5,0.92],[0,1],E.easeOutBack)(t);
  if(sh>0.01){
    const r=lerp(40,300,clamp(sh,0,1));
    c.save(); c.globalCompositeOperation='screen';
    c.globalAlpha=clamp(sh,0,1)*(0.55+0.18*Math.sin(t*8)); c.strokeStyle=P.glow; c.lineWidth=6; c.shadowColor=P.glow; c.shadowBlur=26;
    c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.stroke();
    c.globalAlpha=clamp(sh,0,1)*0.12; c.fillStyle=radial(c,cx,cy,r,[[0,'rgba(125,180,255,0.5)'],[1,'rgba(125,180,255,0)']]);
    c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.fill();
    // hex facets
    c.globalAlpha=clamp(sh,0,1)*0.3; c.lineWidth=1.5;
    for(let a=0;a<6;a++){ const ang=a/6*6.283+t*0.4; c.beginPath(); c.moveTo(cx,cy); c.lineTo(cx+Math.cos(ang)*r,cy+Math.sin(ang)*r); c.stroke(); }
    c.restore();
  }

  if(deflect>0 && deflect<1){
    const hx=cx+208, hy=cy;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-deflect); c.strokeStyle='#fff'; c.lineWidth=3; c.shadowColor=P.glow; c.shadowBlur=20;
    for(let i=0;i<9;i++){ const a=i/9*6.28; const r=20+deflect*90; c.beginPath(); c.moveTo(hx,hy); c.lineTo(hx+Math.cos(a)*r,hy+Math.sin(a)*r); c.stroke(); }
    c.restore();
  }

  // scales-of-justice emblem rises inside the shield
  const em=interp([0.92,1.35],[0,1],E.easeOutCubic)(t);
  if(em>0.01){
    c.save(); c.globalAlpha=clamp(em,0,1); c.translate(cx,470); c.scale(em,em);
    c.strokeStyle=P.soft; c.lineWidth=6; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=18;
    c.beginPath(); c.moveTo(0,-34); c.lineTo(0,44); c.moveTo(-72,-12); c.lineTo(72,-12); c.stroke();
    c.beginPath(); c.arc(-72,12,26,0,Math.PI); c.arc(72,12,26,0,Math.PI); c.stroke();
    c.beginPath(); c.moveTo(-72,-12); c.lineTo(-90,12); c.moveTo(-72,-12); c.lineTo(-54,12); c.moveTo(72,-12); c.lineTo(54,12); c.moveTo(72,-12); c.lineTo(90,12); c.stroke();
    c.beginPath(); c.arc(0,-44,7,0,Math.PI*2); c.stroke();
    c.restore();
  }
  ring(c,cx,cy,interp([1.0,1.7],[0,1])(t),P.glow,80,470);
  grade(c,'virtue',0.36);
  },
};

export default clip;
