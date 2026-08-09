// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Plant Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The victim faces away; the fanatic creeps up on tiptoe and slips the lit
// bomb into their satchel, then eases back into the shadows.
const clip: ClipConfig = {
  name: "fanaticism_plant",
  bg: "#0c0406",
  poster: 1.3,
  duration: 2.0,
  video: "/animations/fanaticism_plant.mp4",
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial,frac}=AB;
  const {rig,stage,shadow,bomb,walkPose}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, Vx=1230;

  stage(c,t,'vice');

  const creep=interp([0.05,0.75],[0,1],E.easeInOutQuad)(t);  // tiptoe approach
  const slip=interp([0.85,1.15],[0,1],E.easeInOutQuad)(t);   // bomb into the satchel
  const retreat=interp([1.3,1.9],[0,1],E.easeInOutQuad)(t);  // eases back away

  // ── the unaware victim (faces away, idly shifting) ──
  shadow(c, Vx, G+6, 125, 0.45);
  rig(c,{ x:Vx, ground:G, s:1.0, facing:1, pal:'shade',   // facing right = away
    lean: Math.sin(t*1.6)*0.02, bow: 0.06,
    relaxF:true, relaxB:true,
    footF:[ 30, 186 ], footB:[ -26, 186 ],
    cape:0.5, capeSway:Math.sin(t*1.3)*0.03, skirt:0.75, rim:0.6 });
  // their satchel, hanging at the near hip
  const satX=Vx-66, satY=G-176;
  c.save();
  c.strokeStyle='#241014'; c.lineWidth=7;
  c.beginPath(); c.moveTo(Vx-30,G-330); c.lineTo(satX,satY-26); c.stroke();
  c.fillStyle='#3a2029'; c.beginPath(); c.roundRect(satX-34,satY-30,68,62,10); c.fill();
  c.fillStyle='#2a161d'; c.beginPath(); c.roundRect(satX-34,satY-30,68,22,[10,10,4,4]); c.fill();
  c.restore();

  // ── the fanatic: tiptoe creep, slip, retreat ──
  const fx=lerp(560, satX-120, creep) - retreat*260;
  const w=walkPose(frac(t*1.5), 26);
  const moving=(creep>0.01&&creep<0.99)||(retreat>0.01&&retreat<0.99);
  const hf= slip>0.01
    ? [ lerp(96,128,slip), lerp(-140,-116,slip) ]           // hand dips into satchel
    : (moving? [50+w.handF[0]*0.3,-60] : [50,-60]);
  shadow(c, fx, G+6, 110, 0.45);
  const F=rig(c,{ x:fx, ground:G, s:0.97, facing: retreat>0.02?-1:1, pal:'vice',
    lean: 0.22*(1-retreat*0.6), bow: 0.18,
    handF: retreat>0.02? null : hf, relaxF: retreat>0.02, bendF:1,
    handB:[ -20, -120 ], bendB:-1,
    footF: moving? [w.footF[0]*0.7, 178] : [26,178],   // tiptoe: heels up
    footB: moving? [w.footB[0]*0.7, 178] : [-22,178],
    hipH: 192,
    cape:0.55, capeSway:-0.1*creep+0.14*retreat, skirt:0.8,
    eyes:0.7, eyeCol:'#ff5a3c', rim:0.85 });

  // ── the bomb: carried, then left in the satchel ──
  if(slip<1){
    const bx2=lerp(F.handF[0], satX, clamp(slip*1.2,0,1));
    const by2=lerp(F.handF[1]-20, satY-8, clamp(slip*1.2,0,1));
    bomb(c, bx2, by2, 26, t, 0.9);
  } else {
    // tucked in: only the sparking fuse peeks out
    bomb(c, satX, satY-6, 26, t, 0.5);
    c.fillStyle='#3a2029'; c.beginPath(); c.roundRect(satX-34,satY-14,68,46,[4,4,10,10]); c.fill();
  }
  // hush sparkle over the fanatic's head while creeping
  if(creep>0.2 && creep<1 && slip<0.5){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.6;
    c.fillStyle='#ffd27a'; c.font='700 40px Georgia'; c.textAlign='center';
    c.restore();
  }
  AB.ring(c,satX,satY,interp([1.15,1.7],[0,1])(t),P.glow,30,260);
  AB.motes(c,t,'rgba(255,120,90,0.5)',12);
  AB.grade(c,'vice',0.32);
  },
};

export default clip;
