// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Gambling Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The gambler shakes the die in cupped hands, hurls it — it tumbles and
// bounces across the floor and locks on a six in a flare of red.
const clip: ClipConfig = {
  name: "gambling",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/gambling.mp4",
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, cx=600;

  stage(c,t,'vice');

  const shake=interp([0.05,0.5],[0,1])(t);
  const jit = shake>0.02 && shake<1 ? Math.sin(t*46)*7 : 0;
  const toss=interp([0.5,0.68],[0,1],E.easeOutCubic)(t);
  const flight=interp([0.62,1.25],[0,1],E.linear)(t);
  const lock=interp([1.25,1.5],[0,1],E.easeOutBack)(t);
  const settle=interp([1.15,1.6],[0,1],E.easeOutCubic)(t);

  // ── the gambler ──
  const cup=[ 44+jit*0.6, -150+jit*0.4 ];
  const throwTo=[ 156, -168 ], rest=[ 32, -52 ];
  const hp=[ lerp(cup[0],throwTo[0],toss), lerp(cup[1],throwTo[1],toss) ];
  const hf=[ lerp(hp[0],rest[0],settle), lerp(hp[1],rest[1],settle) ];
  const hb=[ lerp(lerp(cup[0]-16,-30,toss),-24,settle), lerp(lerp(cup[1]+6,-120,toss),-56,settle) ];
  shadow(c, cx, G+6, 135, 0.5);
  rig(c,{ x:cx, ground:G, s:1.0, facing:1, pal:'vice',
    lean: 0.16*shake*(1-toss) + 0.14*toss*(1-settle) + 0.02*settle,
    bow: 0.2*shake*(1-toss),
    handF:hf, bendF:1, handB:hb, bendB:-1,
    footF:[ 40+toss*40-settle*26, 186 ], footB:[ -40, 186 ],
    hipH: 186-12*shake*(1-toss),
    cape:0.6, capeSway: -0.06*shake + 0.2*toss,
    skirt:0.8, eyes:0.55+lock*0.45, eyeCol:'#ff8a6a', rim:0.9 });

  // ── the die ──
  const die=(x,y,r,ang,face)=>{
    c.save(); c.translate(x,y); c.rotate(ang);
    c.fillStyle='#f2ecd9'; c.beginPath(); c.roundRect(-r,-r,r*2,r*2,r*0.24); c.fill();
    c.save(); c.globalAlpha=0.25; c.fillStyle='#8a7a5a';
    c.beginPath(); c.roundRect(-r,r*0.4,r*2,r*0.6,r*0.2); c.fill(); c.restore();
    c.fillStyle='#33202a';
    const pip=(px,py)=>{ c.beginPath(); c.arc(px*r,py*r,r*0.14,0,Math.PI*2); c.fill(); };
    if(face===6){ [[-0.5,-0.55],[0.5,-0.55],[-0.5,0],[0.5,0],[-0.5,0.55],[0.5,0.55]].forEach(p=>pip(p[0],p[1])); }
    else if(face===3){ [[-0.5,-0.5],[0,0],[0.5,0.5]].forEach(p=>pip(p[0],p[1])); }
    else if(face===2){ [[-0.45,-0.45],[0.45,0.45]].forEach(p=>pip(p[0],p[1])); }
    else { pip(0,0); }
    c.restore();
  };

  if(toss<0.15 && shake>0.02){
    // rattling between cupped hands
    die(cx+52+jit, G-330+jit*0.5, 26, jit*0.06, 3);
  } else if(toss>=0.15){
    // flight: arc + bounces, tumbling
    const fx=lerp(cx+170, 1330, flight);
    const b1=0.55, b2=0.82;
    let fy;
    if(flight<b1) fy=lerp(G-420, G-46, E.easeInQuad(flight/b1));
    else if(flight<b2) fy=G-46-Math.sin((flight-b1)/(b2-b1)*Math.PI)*110;
    else fy=G-46-Math.sin((flight-b2)/(1-b2)*Math.PI)*40;
    const ang=flight*12.5;
    const face=[1,3,2,3,6][Math.floor(flight*8)%5];
    const r=lerp(26,42,clamp(flight*2,0,1));
    if(flight<1){ die(fx,fy,r,ang,face); shadow(c,fx,G+4,50*clamp(1-(G-46-fy)/400,0.3,1),0.35); }
  }
  // locked result: the six, glowing
  if(lock>0.01){
    const s=clamp(lock,0,1.06);
    shadow(c,1330,G+4,70,0.4);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(lock,0,1)*0.8;
    c.fillStyle=radial(c,1330,G-48,190,[[0,'rgba(255,90,60,0.55)'],[1,'rgba(255,90,60,0)']]);
    c.fillRect(1330-210,G-260,420,420); c.restore();
    c.save(); c.translate(1330,G-48); c.scale(s,s); c.translate(-1330,-(G-48));
    die(1330,G-48,44,0,6);
    c.restore();
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(lock,0,1);
    c.strokeStyle=P.glow; c.lineWidth=3.5; c.shadowColor=P.glow; c.shadowBlur=16;
    c.beginPath(); c.roundRect(1330-50,G-98,100,100,12); c.stroke(); c.restore();
    AB.ring(c,1330,G-48,interp([1.5,1.95],[0,1])(t),P.glow,50,320);
  }
  // motion trail during flight
  if(flight>0.1 && flight<0.9){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.4;
    c.strokeStyle='#ff8a6a'; c.lineWidth=3; c.lineCap='round';
    const fx=lerp(cx+170, 1330, flight);
    c.beginPath(); c.moveTo(fx-130,G-260); c.quadraticCurveTo(fx-60,G-300,fx-20,G-240); c.stroke();
    c.restore();
  }
  AB.motes(c,t,'rgba(255,120,90,0.5)',12);
  AB.grade(c,'vice',0.32);
  },
};

export default clip;
