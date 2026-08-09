// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Justice Kill Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The sword-and-shield champion strides in, raises the blade overhead and
// strikes the condemned down in one clean arc.
const clip: ClipConfig = {
  name: "justice_kill",
  bg: "#050818",
  poster: 1.15,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,sword,shield,impact,PAL}=AB.RIG;
  const P=AB.CAMP.virtue;
  const G=940, cx=830, Vx=1210;

  stage(c,t,'virtue');

  const raise=interp([0.22,0.55],[0,1],E.easeOutCubic)(t);  // sword overhead
  const chop=interp([0.62,0.76],[0,1],E.easeInCubic)(t);    // downward strike
  const settle=interp([0.95,1.4],[0,1],E.easeOutCubic)(t);
  const slash=interp([0.72,0.8,1.1],[0,1,0])(t);

  // ── victim: flinches, then collapses to the floor ──
  const fall=interp([0.75,1.3],[0,1],E.easeInQuad)(t);
  const vHipX=Vx+fall*70, vHipY=lerp(G-186, G-46, fall);
  const vRot=fall*Math.PI*0.44;
  shadow(c, vHipX, G+6, 130, 0.45);
  c.save(); c.translate(vHipX,vHipY); c.rotate(vRot);
  rig(c,{ x:0, ground:186, s:0.96, facing:-1, pal:'shade',
    lean: raise*0.06 - fall*0.3, bow: fall*0.5,
    relaxF:true, relaxB: fall<0.2,
    handB: fall>=0.2?[ 40-fall*80, -160+fall*80 ]:null, bendB:1,
    footF:[ 26+fall*36, 186 ], footB:[ -24-fall*26, 186-fall*14 ],
    cape:0.35, capeSway:-fall*0.4, skirt:0.7, rim:0.55 });
  c.restore();

  // ── champion ──
  const swordUp=[ -30, -300 ], swordDown=[ 148, -66 ];
  const hf=[ lerp(lerp(38,swordUp[0],raise), swordDown[0], chop),
             lerp(lerp(-40,swordUp[1],raise), swordDown[1], chop) ];
  const lunge = 60*chop - 20*settle;
  shadow(c, cx+lunge, G+6, 140, 0.5);
  const A=rig(c,{ x:cx+lunge, ground:G, s:1.05, facing:1, pal:'virtue',
    lean: -0.1*raise + 0.3*chop - 0.12*settle,
    handF:hf, bendF: chop>0.5?1:-1,
    handB:[ -60, -140 ], bendB:-1,
    footF:[ 52+chop*70, 186 ], footB:[ -56, 186 ],
    hipH: 186-10*chop, cape:0.7, capeSway: 0.12*raise - 0.3*chop,
    skirt:0.85, eyes:0.55, eyeCol:'#bcd6ff', rim:0.95 });
  // shield on the off arm
  shield(c, A.handB[0]-8, A.handB[1]+4, 0.95, PAL.virtue, (cc)=>{
    cc.strokeStyle='#c99b2e'; cc.lineWidth=4.5; cc.lineCap='round';
    cc.beginPath(); cc.moveTo(0,-26); cc.lineTo(0,22); cc.moveTo(-20,-10); cc.lineTo(20,-10); cc.stroke();
  });
  // the blade follows the striking arm
  const ang=Math.atan2(A.handF[1]-A.elbowF[1], A.handF[0]-A.elbowF[0]);
  sword(c, A.handF[0], A.handF[1], ang, 1.1);

  // slash arc + impact
  if(slash>0.01){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=slash;
    c.strokeStyle='#eaf2ff'; c.lineWidth=12; c.shadowColor=P.glow; c.shadowBlur=28; c.lineCap='round';
    c.beginPath(); c.arc(A.hip[0]+30, A.hip[1]-120, 300, -Math.PI*0.62, Math.PI*0.12); c.stroke();
    c.lineWidth=4; c.globalAlpha=slash*0.7;
    c.beginPath(); c.arc(A.hip[0]+30, A.hip[1]-120, 258, -Math.PI*0.5, Math.PI*0.1); c.stroke();
    c.restore();
  }
  impact(c, Vx-30, 600, interp([0.73,0.8,1.05],[0,1,0])(t), '#9ec4ff');
  AB.ring(c, Vx-20, 620, interp([0.95,1.6],[0,1])(t), P.glow, 50, 420);
  AB.motes(c,t,'rgba(125,180,255,0.6)',14);
  AB.grade(c,'virtue',0.32);
  },
};

export default clip;
