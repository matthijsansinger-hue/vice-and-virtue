// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Murder Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// Seen from a distance: she walks the corridor with a knife held low, eases
// the door open — warm light spills out — and slips inside.
const clip: ClipConfig = {
  name: "murder",
  bg: "#0c0406",
  poster: 1.35,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial,frac}=AB;
  const {rig,stage,shadow,knife,walkPose}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, doorX=1470;

  stage(c,t,'vice',{arches:true});

  // ── the door ──
  const open=interp([1.12,1.5],[0,1],E.easeOutCubic)(t);
  const dw=150, dh=430, dTop=G-dh;
  // light spilling out
  if(open>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=open;
    c.fillStyle=radial(c,doorX,G-160,520,[[0,'rgba(255,196,108,0.5)'],[0.5,'rgba(255,170,80,0.18)'],[1,'rgba(255,170,80,0)']]);
    c.fillRect(doorX-560,dTop-160,1120,dh+340); c.restore();
    // light wedge on the floor
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=open*0.7;
    const g=c.createLinearGradient(doorX,G,doorX-320,G+120);
    g.addColorStop(0,'rgba(255,196,108,0.55)'); g.addColorStop(1,'rgba(255,196,108,0)');
    c.fillStyle=g; c.beginPath(); c.moveTo(doorX-dw/2,G); c.lineTo(doorX+dw/2,G);
    c.lineTo(doorX+dw/2+120,G+150); c.lineTo(doorX-dw/2-260,G+150); c.closePath(); c.fill(); c.restore();
  }
  // frame
  c.fillStyle='#241318'; c.fillRect(doorX-dw/2-22,dTop-24,dw+44,24);
  c.fillRect(doorX-dw/2-22,dTop-14,22,dh+14); c.fillRect(doorX+dw/2,dTop-14,22,dh+14);
  // doorway interior (lit when open)
  const ig=c.createLinearGradient(doorX,dTop,doorX,G);
  ig.addColorStop(0, open>0.02?'#f7d9a0':'#0a0508'); ig.addColorStop(1, open>0.02?'#c98d4a':'#070406');
  c.save(); c.globalAlpha=open; c.fillStyle=ig; c.fillRect(doorX-dw/2,dTop,dw,dh); c.restore();
  // the door panel, swinging inward (foreshortened)
  c.save();
  c.translate(doorX-dw/2,0); c.scale(1-open*0.82,1); c.translate(-(doorX-dw/2),0);
  const wg=c.createLinearGradient(doorX-dw/2,0,doorX+dw/2,0);
  wg.addColorStop(0,'#3a2029'); wg.addColorStop(0.5,'#311a22'); wg.addColorStop(1,'#241318');
  c.fillStyle=wg; c.fillRect(doorX-dw/2,dTop,dw,dh);
  c.strokeStyle='rgba(0,0,0,0.45)'; c.lineWidth=3;
  for(let i=1;i<4;i++){ c.beginPath(); c.moveTo(doorX-dw/2+i*dw/4,dTop+8); c.lineTo(doorX-dw/2+i*dw/4,G-8); c.stroke(); }
  c.fillStyle='#c99b2e'; c.beginPath(); c.arc(doorX+dw/2-22,G-210,7,0,Math.PI*2); c.fill();
  c.restore();

  // ── her approach ──
  const walk=interp([0.05,1.12],[0,1],E.easeInOutQuad)(t);
  const slip=interp([1.45,1.88],[0,1],E.easeInQuad)(t);      // steps into the light
  const x=lerp(430, doorX-120, walk) + slip*130;
  const walking = walk>0.01 && walk<0.99;
  const w=walkPose(frac(t*2.1), 52);
  const reach=interp([1.05,1.35],[0,1],E.easeOutCubic)(t);   // hand to the door
  // silhouette against the doorway light as she enters
  const dim=clamp(1-slip*0.85,0.15,1);

  shadow(c, x, G+6, 120, 0.5*(1-slip*0.6));
  c.save(); c.globalAlpha=clamp(1-slip*0.25,0,1);
  const A=rig(c,{ x, ground:G, s:0.95, facing:1,
    pal:{ ...AB.RIG.PAL.vice2,
      cloth:`rgba(${110-60*slip|0},${32-16*slip|0},${48-26*slip|0},1)` },
    hoodUp:false,
    lean: walking?0.09:0.05 + reach*0.06,
    footF: walking?w.footF:[30+slip*20,186], footB: walking?w.footB:[-24,186],
    handF: reach>0.02? [ lerp(120,64,slip), lerp(lerp(-46,-160,reach),-118,slip) ] : (walking?w.handF:null),
    bendF: slip>0.3?-1:1,
    relaxF: !walking && reach<=0.02,
    handB:[ walking? w.handB[0]: -26, walking? -30: -40 ], bendB:-1,
    hipH: 186-(walking?w.hipBob:0),
    cape:0.6, capeSway: walking?-0.16:-0.04, skirt:1.0,
    eyes:0.5*dim, eyeCol:'#ffb08a', rim:0.9 });
  // the knife, held low and back in the off hand
  knife(c, A.handB[0], A.handB[1]+6, 0.62+Math.sin(t*2)*0.02, 0.95);
  // blade glint while walking
  const glint=interp([0.55,0.7,0.85],[0,1,0])(t);
  if(glint>0.01){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=glint;
    c.strokeStyle='#fff'; c.lineWidth=2.5; c.shadowColor='#fff'; c.shadowBlur=14;
    const gx=A.handB[0]+44, gy=A.handB[1]+40;
    c.beginPath(); c.moveTo(gx-12,gy); c.lineTo(gx+12,gy); c.moveTo(gx,gy-12); c.lineTo(gx,gy+12); c.stroke();
    c.restore();
  }
  c.restore();

  AB.motes(c,t,'rgba(255,150,90,0.45)',12);
  AB.grade(c,'vice',0.3);
  // closing dim as she disappears inside
  const end=interp([1.82,2.0],[0,0.6])(t);
  if(end>0.01){ c.save(); c.globalAlpha=end; c.fillStyle='#000'; c.fillRect(0,0,1920,1080); c.restore(); }
  },
};

export default clip;
