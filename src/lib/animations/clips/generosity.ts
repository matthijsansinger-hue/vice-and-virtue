// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Generosity Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The giver draws light from their own chest and offers it with both hands;
// the orbs stream across, and the receiver brightens and bows in thanks.
const clip: ClipConfig = {
  name: "generosity",
  bg: "#050818",
  poster: 1.6,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial,frac}=AB;
  const {rig,stage,shadow}=AB.RIG;
  const P=AB.CAMP.virtue;
  const G=940, Lx=660, Rx=1280;

  stage(c,t,'virtue');

  const draw2=interp([0.1,0.4],[0,1],E.easeOutCubic)(t);   // hand to own chest
  const offer=interp([0.4,0.7],[0,1],E.easeOutCubic)(t);   // both hands extended
  const streamP=interp([0.6,1.5],[0,1],E.linear)(t);
  const recv=interp([0.95,1.7],[0,1],E.easeOutCubic)(t);

  // ── giver ──
  const hf=[ lerp(lerp(30,26,draw2),128,offer), lerp(lerp(-60,-150,draw2),-172,offer) ];
  const hb=[ lerp(-20,96,offer), lerp(-50,-150,offer) ];
  shadow(c, Lx, G+6, 130, 0.5);
  const A=rig(c,{ x:Lx, ground:G, s:0.98, facing:1, pal:'virtue',
    lean: 0.08*offer, bow: 0.08*offer,
    handF:hf, bendF:1, handB:hb, bendB:1,
    footF:[ 34+offer*14, 186 ], footB:[ -30, 186 ],
    cape:0.55, capeSway: Math.sin(t*2)*0.03,
    skirt:0.85, eyes:0.5, eyeCol:'#bcd6ff', rim:0.9 });
  // glow cupped between the offering hands
  if(offer>0.1 && streamP<0.9){
    const gx=(A.handF[0]+A.handB[0])/2, gy=(A.handF[1]+A.handB[1])/2;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=offer*(1-streamP*0.8);
    c.fillStyle=radial(c,gx,gy,90,[[0,'rgba(200,225,255,0.9)'],[0.5,'rgba(125,180,255,0.5)'],[1,'rgba(125,180,255,0)']]);
    c.beginPath(); c.arc(gx,gy,86,0,Math.PI*2); c.fill(); c.restore();
  }

  // ── receiver: hands opening to accept, brightens, grateful bow ──
  shadow(c, Rx, G+6, 125, 0.45);
  const R=rig(c,{ x:Rx, ground:G, s:0.96, facing:-1, pal:'virtue2',
    lean: 0.05*recv, bow: 0.24*recv,
    handF:[ lerp(28,110,recv*1.2>1?1:recv*1.2), lerp(-60,-150,clamp(recv*1.4,0,1)) ], bendF:1,
    handB:[ lerp(-22,88,clamp(recv*1.4,0,1)), lerp(-52,-142,clamp(recv*1.4,0,1)) ], bendB:1,
    footF:[ 30, 186 ], footB:[ -28, 186 ],
    cape:0.5, capeSway: -Math.sin(t*2.2)*0.03,
    skirt:0.85, eyes:0.35+recv*0.65, eyeCol:'#bcd6ff', rim: 0.6+recv*0.4 });
  if(recv>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=recv*0.75;
    c.fillStyle=radial(c,Rx,G-360,300,[[0,'rgba(140,190,255,0.55)'],[1,'rgba(140,190,255,0)']]);
    c.fillRect(Rx-340,G-700,680,720); c.restore();
  }

  // ── the stream of gifted orbs ──
  if(streamP>0.02){
    c.save(); c.globalCompositeOperation='screen';
    for(let i=0;i<9;i++){
      const ph=frac(streamP*1.6 - i*0.09); if(ph<=0.02||ph>=0.98) continue;
      const sx=lerp(A.handF[0]+20, R.handF[0]-10, ph);
      const sy=lerp(A.handF[1], R.handF[1], ph) - Math.sin(ph*Math.PI)*160;
      c.globalAlpha=Math.sin(ph*Math.PI)*0.95;
      c.fillStyle=i%3===0?'#ffffff':P.soft; c.shadowColor=P.glow; c.shadowBlur=16;
      c.beginPath(); c.arc(sx,sy,5.5+(i%3)*2,0,Math.PI*2); c.fill();
      // tiny trailing sparks
      c.globalAlpha*=0.5; c.beginPath(); c.arc(sx-14,sy+8,2.2,0,Math.PI*2); c.fill();
    }
    c.restore();
  }
  AB.ring(c,Rx,G-360,interp([1.35,1.9],[0,1])(t),P.glow,50,360);
  AB.motes(c,t,'rgba(125,180,255,0.6)',14);
  AB.grade(c,'virtue',0.33);
  },
};

export default clip;
