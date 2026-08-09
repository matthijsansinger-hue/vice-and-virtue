// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Torment Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "torment",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial,grade,ring,motes,CAMP,FIG,frac}=AB;
  const {rig,stage}=AB.RIG;
  const P=CAMP.vice;
  stage(c,t,'vice',{arches:false});

  // the tormentor looms huge behind the quiz panel, claw hovering over it
  const loom=interp([0.15,0.7],[0,1],E.easeOutCubic)(t);
  const scrambleT=interp([0.4,1.2],[0,1])(t);
  if(loom>0.01){
    c.save(); c.globalAlpha=clamp(loom,0,1)*0.92;
    rig(c,{ x:1430, ground:1650, s:2.5, facing:-1, pal:'vice',
      lean:0.16*loom, bow:0.2,
      handF:[ lerp(60,190,loom), lerp(-180,-266,loom) ], bendF:-1,
      relaxB:true,
      cape:0.9, capeSway:Math.sin(t*1.6)*0.05,
      skirt:0.9, eyes:0.7+0.3*Math.abs(Math.sin(t*3)), eyeCol:'#ff5a3c', rim:0.9 });
    c.restore();
    // clawed fingers twitching over the panel
    const W={x:1430-190*2.5, y:1650-(186+266)*2.5};
  }

  const pw=720, ph=520, px=760-pw/2, py=300, n=4, rh=110, pad=20;
  const scramble=scrambleT;
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
  motes(c,t,'rgba(255,120,90,0.5)',12);
  },
};

export default clip;
