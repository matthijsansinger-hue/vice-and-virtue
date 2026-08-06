// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Wrath Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// A virtue follower is seized by red tendrils; they arch and struggle as the
// corruption crawls over them, and open red eyes as a vice follower.
const clip: ClipConfig = {
  name: "wrath",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/wrath.mp4",
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, cx=960;

  stage(c,t,'vice');

  const grab=interp([0.22,1.0],[0,1],E.easeOutCubic)(t);
  const struggle=interp([0.5,0.75],[0,1],E.easeOutQuad)(t);
  const morph=interp([0.8,1.45],[0,1],E.easeInOutQuad)(t);
  const shake=Math.sin(t*34)*struggle*(1-morph)*5;

  // shared pose: yanked arms, arched back, head thrown back — then slack
  const pose={
    x:cx+shake, ground:G, s:1.0, facing:1,
    lean: -0.22*struggle + 0.16*morph,
    bow: -0.35*struggle + 0.55*morph,
    handF:[ lerp(36,132,struggle)-morph*60, lerp(-40,-208,struggle)+morph*130 ], bendF:-1,
    handB:[ lerp(-30,-128,struggle)+morph*50, lerp(-30,-196,struggle)+morph*120 ], bendB:1,
    footF:[ 30+struggle*26, 186 ], footB:[ -28-struggle*18, 186 ],
    hipH: 186-16*struggle+6*morph,
    cape:0.55, capeSway: Math.sin(t*7)*0.18*struggle,
    skirt:0.8, rim:0.8,
  };
  shadow(c, cx, G+6, 140, 0.5);
  rig(c,{ ...pose, pal:'virtue', eyes:0.5*(1-morph), eyeCol:'#bcd6ff' });
  if(morph>0.01){
    c.save(); c.globalAlpha=clamp(morph,0,1);
    rig(c,{ ...pose, pal:'vice', eyes:morph, eyeCol:'#ff5a3c', rim:0.9 });
    c.restore();
  }

  // red tendrils snake in from the edges and wrap the body
  const tend=[[110,300,-52,-64],[70,640,-64,30],[180,920,-34,130],[1810,360,56,-58],[1850,720,66,40],[1740,940,36,140]];
  tend.forEach(([sx,sy,ox,oy],i)=>{
    const g=clamp((grab - i*0.05)/0.5,0,1); if(g<=0) return;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=g*0.9;
    c.strokeStyle=P.glow; c.lineWidth=6; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=18;
    const tx=cx+ox+shake, ty=560+oy;
    const ex=lerp(sx,tx,g), ey=lerp(sy,ty,g);
    const mx=(sx+tx)/2 + Math.sin(t*3+i)*70, my=(sy+ty)/2 + Math.cos(t*2+i)*60;
    c.beginPath(); c.moveTo(sx,sy); c.quadraticCurveTo(mx,my,ex,ey); c.stroke();
    c.fillStyle='#ff8a6a'; c.beginPath(); c.arc(ex,ey,5,0,Math.PI*2); c.fill();
    // once latched, a coil wraps the limb
    if(g>0.96){ c.globalAlpha=0.8; c.lineWidth=4.5;
      c.beginPath(); c.arc(tx,ty,20,i*1.2,i*1.2+4.4); c.stroke(); }
    c.restore();
  });

  // corruption aura swallowing the figure as it turns
  if(morph>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=morph*0.6;
    c.fillStyle=radial(c,cx,560,300,[[0,'rgba(255,90,60,0.5)'],[1,'rgba(255,90,60,0)']]); c.fillRect(cx-340,260,680,640); c.restore();
  }
  AB.ring(c,cx,560,interp([1.25,1.9],[0,1])(t),P.glow,60,440);
  AB.motes(c,t,'rgba(255,120,90,0.6)',14);
  AB.grade(c,'vice',0.32);
  },
};

export default clip;
