// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Torment Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "torment",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,grade,ring,motes,CAMP,FIG,frac}=AB;
  const P=CAMP.vice;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(255,120,90,0.5)',12);

  const pw=720, ph=520, px=960-pw/2, py=300, n=4, rh=110, pad=20;
  const scramble=interp([0.4,1.2],[0,1])(t);
  const shuffled=[2,0,3,1];

  // quiz panel frame
  c.save();
  c.fillStyle='rgba(18,7,9,0.7)'; c.beginPath(); c.roundRect(px-24,py-58,pw+48,ph+70,20); c.fill();
  c.fillStyle=P.soft; c.globalAlpha=0.85; c.font='600 30px Cinzel, serif'; c.textAlign='left';
  c.fillText('QUIZ', px, py-22); c.globalAlpha=1;
  c.restore();

  for(let i=0;i<n;i++){
    const glitch = scramble>0.05 ? Math.sin(t*42+i*1.7)*scramble*9 : 0;
    const yi = lerp(py+i*rh, py+shuffled[i]*rh, E.easeInOutQuad(scramble)) + glitch;
    const xi = px + (scramble>0.1? Math.sin(t*33+i*2)*scramble*16 : 0);
    c.save();
    c.fillStyle= i%2? '#37121a':'#2a0d12'; c.beginPath(); c.roundRect(xi,yi,pw,rh-20,12); c.fill();
    // avatar
    c.fillStyle=FIG; c.beginPath(); c.arc(xi+54,yi+(rh-20)/2,32,0,Math.PI*2); c.fill();
    c.fillStyle=P.soft; c.beginPath(); c.arc(xi+54,yi+(rh-20)/2-6,13,0,Math.PI*2); c.fill();
    c.beginPath(); c.ellipse(xi+54,yi+(rh-20)/2+22,20,12,0,Math.PI,0,true); c.fill();
    // name bars
    c.fillStyle='rgba(255,150,130,0.5)'; c.fillRect(xi+116,yi+22,380,16);
    c.fillStyle='rgba(255,150,130,0.28)'; c.fillRect(xi+116,yi+50,250,12);
    c.restore();
  }

  // red glitch scanlines + jitter during the scramble
  if(scramble>0.08){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=scramble*0.4;
    for(let k=0;k<7;k++){ const gy=frac(t*1.6+k*0.15)*(ph+40)+py-30; c.fillStyle=P.glow; c.fillRect(px-24,gy,pw+48,3); }
    c.restore();
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=Math.abs(Math.sin(t*24))*scramble*0.22;
    c.fillStyle=P.glow; c.fillRect(px-24,py-58,pw+48,ph+70); c.restore();
    // chromatic split flashes
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=Math.abs(Math.sin(t*15))*scramble*0.3;
    c.fillStyle='#3a0f14'; c.fillRect(px-24+8,py-58,pw+48,ph+70); c.restore();
  }
  grade(c,'vice',0.3);
  },
};

export default clip;
