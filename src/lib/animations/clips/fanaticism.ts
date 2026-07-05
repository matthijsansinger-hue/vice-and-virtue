// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The lit bomb is pressed from the fanatic's hands into the other's — who
// looks down at it in dread as the fuse keeps sparking.
const clip: ClipConfig = {
  name: "fanaticism",
  bg: "#0c0406",
  poster: 1.55,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/fanaticism.mp4",
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,bomb}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, Lx=700, Rx=1240;

  stage(c,t,'vice');

  const offer=interp([0.2,0.6],[0,1],E.easeOutCubic)(t);   // fanatic extends the bomb
  const take=interp([0.75,1.15],[0,1],E.easeInOutQuad)(t); // pressed into their hands
  const dread=interp([1.2,1.6],[0,1],E.easeOutCubic)(t);   // receiver stares down at it

  // ── the fanatic (left): zealous lean, bomb held out ──
  const hfL=[ lerp(40,150,offer)-take*40, lerp(-120,-166,offer)+take*10 ];
  shadow(c, Lx, G+6, 130, 0.5);
  const F=rig(c,{ x:Lx, ground:G, s:1.0, facing:1, pal:'vice',
    lean: 0.14*offer - 0.06*take,
    handF:hfL, bendF:1,
    handB:[ lerp(-24,60,offer*(1-take)), lerp(-40,-140,offer*(1-take)) ], bendB:1,
    footF:[ 38+offer*26, 186 ], footB:[ -36, 186 ],
    cape:0.6, capeSway:Math.sin(t*2.2)*0.04,
    skirt:0.8, eyes:0.7+0.3*Math.abs(Math.sin(t*4)), eyeCol:'#ff5a3c', rim:0.9 });

  // ── the receiver (right): hands come up, then stare down in dread ──
  const catchP=clamp(take*1.3,0,1);
  shadow(c, Rx, G+6, 125, 0.45);
  const R=rig(c,{ x:Rx, ground:G, s:0.98, facing:-1, pal:'shade',
    lean: -0.05*offer + 0.1*dread, bow: 0.34*dread,
    handF:[ lerp(30,120,catchP), lerp(-70,-150,catchP)+dread*16 ], bendF:1,
    handB:[ lerp(-20,96,catchP), lerp(-56,-144,catchP)+dread*16 ], bendB:1,
    footF:[ 30, 186 ], footB:[ -28-dread*14, 186 ],
    cape:0.5, capeSway:-0.04, skirt:0.75,
    eyes:0.4+dread*0.6, eyeCol:'#ffd7b0', rim:0.65 });

  // ── the bomb, passed between hands ──
  const bp=clamp(take,0,1);
  const bxx=lerp(F.handF[0]+16, R.handF[0]-14, bp);
  const byy=lerp(F.handF[1]-26, R.handF[1]-30, bp) - Math.sin(bp*Math.PI)*40;
  bomb(c, bxx, byy, 36, t, 0.9-t*0.18);
  // dread glow on the receiver once it lands
  if(dread>0.05){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=dread*0.5;
    c.fillStyle=radial(c,R.handF[0],R.handF[1],200,[[0,'rgba(255,120,60,0.5)'],[1,'rgba(255,120,60,0)']]);
    c.fillRect(R.handF[0]-220,R.handF[1]-220,440,440); c.restore();
  }
  AB.ring(c,R.handF[0],R.handF[1],interp([1.25,1.8],[0,1])(t),P.glow,40,320);
  AB.motes(c,t,'rgba(255,120,90,0.5)',12);
  AB.grade(c,'vice',0.32);
  },
};

export default clip;
