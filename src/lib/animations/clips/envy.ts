// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Envy Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// Two figures stride past each other while their theatrical masks arc
// overhead and swap owners — identities exchanged.
const clip: ClipConfig = {
  name: "envy",
  bg: "#0c0406",
  poster: 1.5,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,walkPose}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, Lx=640, Rx=1280;

  stage(c,t,'vice');

  const swap=interp([0.35,1.25],[0,1],E.easeInOutQuad)(t);
  const ax=lerp(Lx,Rx,swap), bx=lerp(Rx,Lx,swap);
  const walking = swap>0.001 && swap<0.999;
  const phase = t*1.9;

  function walker(x, dir, pal, s, front){
    const w=walking? walkPose(AB.frac(phase), 46) : null;
    shadow(c, x, G+6, 120*s, front?0.5:0.35);
    c.save(); if(!front) c.globalAlpha=0.82;
    rig(c,{ x, ground:G, s, facing:dir, pal,
      lean: walking?0.08:0.02,
      footF: w?w.footF:[28,186], footB: w?w.footB:[-24,186],
      handF: w?w.handF:null, relaxF:!w,
      handB: w?w.handB:null, relaxB:!w,
      hipH: 186-(w?w.hipBob:0),
      cape:0.5, capeSway: walking? -0.18*dir*0 -0.14:0,
      skirt:0.75, rim: front?0.85:0.6, eyes:0.4, eyeCol:'#ffb08a' });
    c.restore();
  }
  // the one passing behind is drawn first
  const frontLeft = swap<0.5;
  if(frontLeft){ walker(bx,-1,'shade',0.9,false); walker(ax,1,'vice',0.96,true); }
  else { walker(ax,1,'vice',0.96,false); walker(bx,-1,'shade',0.9,true); }

  // theatrical masks arc across and swap owners
  const mt=interp([0.4,1.2],[0,1],E.easeInOutQuad)(t);
  function mask(x,y,col,tilt){ c.save(); c.translate(x,y); c.rotate(tilt);
    c.fillStyle=col; c.shadowColor=col; c.shadowBlur=18;
    c.beginPath(); c.moveTo(-42,-32); c.quadraticCurveTo(0,-50,42,-32); c.quadraticCurveTo(50,12,0,50); c.quadraticCurveTo(-50,12,-42,-32); c.closePath(); c.fill();
    c.fillStyle='#1a0608'; c.beginPath(); c.ellipse(-17,-6,8,13,0.2,0,Math.PI*2); c.fill(); c.beginPath(); c.ellipse(17,-6,8,13,-0.2,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(0,22,12,0,Math.PI); c.fill();
    c.restore(); }
  const my=400, arc=160;
  mask(lerp(Lx,Rx,mt), my-Math.sin(mt*Math.PI)*arc, '#ff8a6a', mt*Math.PI*0.5-0.4);
  mask(lerp(Rx,Lx,mt), my+Math.sin(mt*Math.PI)*arc*0.5, '#ffcf9a', -mt*Math.PI*0.5+0.4);
  // sparkle trails behind the masks
  c.save(); c.globalCompositeOperation='screen';
  for(let i=1;i<=6;i++){ const p1=clamp(mt-i*0.05,0,1);
    c.globalAlpha=(1-i/7)*0.5*(mt>0.02&&mt<0.98?1:0);
    c.fillStyle='#ffcf9a';
    c.beginPath(); c.arc(lerp(Lx,Rx,p1), my-Math.sin(p1*Math.PI)*arc, 4,0,Math.PI*2); c.fill();
    c.beginPath(); c.arc(lerp(Rx,Lx,p1), my+Math.sin(p1*Math.PI)*arc*0.5, 4,0,Math.PI*2); c.fill(); }
  c.restore();

  // swap completion: crossed-arrows glyph
  AB.ring(c,960,560,interp([1.25,1.8],[0,1])(t),P.glow,60,440);
  const gl=interp([1.2,1.5],[0,1],E.easeOutCubic)(t)*interp([1.75,1.98],[1,0])(t);
  if(gl>0.01){ c.save(); c.globalAlpha=clamp(gl,0,1); c.globalCompositeOperation='screen'; c.translate(960,470);
    c.strokeStyle=P.soft; c.lineWidth=5; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=16;
    c.beginPath(); c.moveTo(-70,-14); c.lineTo(70,-14); c.lineTo(50,-30); c.moveTo(70,-14); c.lineTo(50,2); c.stroke();
    c.beginPath(); c.moveTo(70,22); c.lineTo(-70,22); c.lineTo(-50,6); c.moveTo(-70,22); c.lineTo(-50,38); c.stroke();
    c.restore(); }
  AB.motes(c,t,'rgba(255,120,90,0.7)',14);
  AB.grade(c,'vice',0.33);
  },
};

export default clip;
