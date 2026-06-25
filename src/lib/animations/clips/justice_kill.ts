// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Justice Kill Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "justice_kill",
  bg: "#050818",
  poster: 1.5,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
  const P=CAMP.virtue;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(125,180,255,0.6)',14);
  const cx=820, base=940, Vx=1280;

  const swing=interp([0.4,0.95],[0,1],E.easeInQuad)(t);  // sword raised → down
  const fall=interp([0.95,1.5],[0,1],E.easeInCubic)(t);  // victim falls
  const slash=interp([0.9,1.02,1.32],[0,1,0])(t);

  // victim (right) falls after the strike
  c.save(); c.globalAlpha=clamp(1-fall*0.9,0,1); c.translate(0,fall*40);
  c.translate(Vx,base); c.rotate(fall*0.5); c.translate(-Vx,-base);
  figure(c,{x:Vx,base,s:0.9,fill:'#0a1230'});
  c.restore();

  // the armored champion (left)
  figure(c,{x:cx,base,s:1.0,fill:FIG});
  // shield on the near arm
  c.save(); c.translate(cx-92,base-330);
  c.fillStyle='#101a3a'; c.beginPath();
  c.moveTo(-44,-58); c.lineTo(44,-58); c.lineTo(44,30); c.quadraticCurveTo(0,86,-44,30); c.closePath(); c.fill();
  c.lineWidth=5; c.strokeStyle=P.glow; c.shadowColor=P.glow; c.shadowBlur=12; c.stroke();
  // shield cross emblem
  c.strokeStyle=P.soft; c.lineWidth=6; c.beginPath(); c.moveTo(0,-44); c.lineTo(0,20); c.moveTo(-26,-16); c.lineTo(26,-16); c.stroke();
  c.restore();

  // sword arm: raised high, swings down across the victim
  const shX=cx+56, shY=base-456;
  const ang=lerp(-2.35, 0.35, swing);
  const handX=shX+Math.cos(ang)*150, handY=shY+Math.sin(ang)*150;
  c.save(); c.strokeStyle=FIG; c.lineWidth=30; c.lineCap='round';
  c.beginPath(); c.moveTo(shX,shY); c.lineTo(handX,handY); c.stroke();
  c.fillStyle=FIG; c.beginPath(); c.arc(handX,handY,18,0,Math.PI*2); c.fill();
  c.restore();
  // the blade
  c.save(); c.translate(handX,handY); c.rotate(ang);
  c.fillStyle='#3a2a16'; c.fillRect(-6,-8,30,16);          // grip
  c.fillStyle='#6f5230'; c.fillRect(20,-22,10,44);         // crossguard
  const bg=c.createLinearGradient(30,0,250,0); bg.addColorStop(0,'#9aa6b2'); bg.addColorStop(0.5,'#eef4fb'); bg.addColorStop(1,'#c2ccd8');
  c.fillStyle=bg; c.beginPath(); c.moveTo(30,-14); c.lineTo(240,-6); c.lineTo(262,0); c.lineTo(240,6); c.lineTo(30,14); c.closePath(); c.fill();
  c.strokeStyle='rgba(255,255,255,0.8)'; c.lineWidth=2; c.beginPath(); c.moveTo(34,-10); c.lineTo(244,-2); c.stroke();
  c.restore();

  // slash arc + impact across the victim
  if(slash>0.01){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=slash;
    c.strokeStyle='#eaf2ff'; c.lineWidth=10; c.shadowColor=P.glow; c.shadowBlur=26;
    c.beginPath(); c.arc(Vx-30,base-360,230,Math.PI*1.15,Math.PI*1.75); c.stroke();
    c.restore();
    // spark at impact
    const ix=Vx-60, iy=base-360;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=slash; c.strokeStyle='#fff'; c.lineWidth=3; c.shadowColor=P.glow; c.shadowBlur=18;
    for(let i=0;i<7;i++){ const a=-0.8+i/7*1.4; const r=20+slash*70; c.beginPath(); c.moveTo(ix,iy); c.lineTo(ix+Math.cos(a)*r,iy+Math.sin(a)*r); c.stroke(); }
    c.restore();
  }
  ring(c,cx,base-360,interp([1.05,1.7],[0,1])(t),P.glow,60,460);
  grade(c,'virtue',0.34);
  },
};

export default clip;
