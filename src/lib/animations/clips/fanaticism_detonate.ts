// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Detonate Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The doomed carrier holds the bomb at arm's length as the fuse burns down —
// then the blast whites out the chamber, leaving only smoke and embers.
const clip: ClipConfig = {
  name: "fanaticism_detonate",
  bg: "#0c0406",
  poster: 0.95,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial,frac}=AB;
  const {rig,stage,shadow,bomb}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, cx=960;

  stage(c,t,'vice');

  const burn = clamp(1 - t/0.92, 0, 1);                      // fuse burns down
  const panic=interp([0.3,0.85],[0,1],E.easeInQuad)(t);      // rising panic
  const boom=interp([0.92,1.2],[0,1],E.easeOutCubic)(t);
  const after=interp([1.2,1.6],[0,1],E.easeOutCubic)(t);
  const tremble=Math.sin(t*40)*panic*3;

  // ── the carrier: bomb at arm's length, leaning away from it ──
  if(boom<0.4){
    shadow(c, cx, G+6, 130, 0.5*(1-boom*2));
    c.save(); c.globalAlpha=clamp(1-boom*2.6,0,1);
    rig(c,{ x:cx+tremble*0.4, ground:G, s:1.0, facing:1, pal:'shade',
      lean: -0.16*panic, bow: -0.1*panic,
      handF:[ 152, -190+tremble*0.3 ], bendF:1,      // bomb held far out
      handB:[ -60-panic*30, -170-panic*30 ], bendB:1, // other arm shielding
      footF:[ 40, 186 ], footB:[ -46-panic*16, 186 ],
      cape:0.55, capeSway:-0.1*panic+Math.sin(t*8)*0.04*panic,
      skirt:0.8, eyes:0.5+panic*0.5, eyeCol:'#ffd7b0', rim:0.8 });
    c.restore();
    // the bomb in the outstretched hand
    const bx=cx+150+tremble, by=G-186-190+tremble*0.5;
    bomb(c, bx, by+16, 42, t, burn);
  }

  // ── detonation ──
  if(boom>0){
    const bx=cx+150, by=G-360;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=interp([0.92,1.02,1.5],[0,1,0.22])(t);
    c.fillStyle=radial(c,bx,by,lerp(100,820,boom),[[0,'#fff'],[0.3,'#ff8a4a'],[0.6,'#b8001c'],[1,'rgba(184,0,28,0)']]);
    c.fillRect(0,0,1920,1080); c.restore();
    AB.ring(c,bx,by,boom,P.glow,30,660);
    AB.ring(c,bx,by,interp([1.02,1.45],[0,1])(t),'#ffd27a',16,540);
    // debris streaks
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-boom)*0.95;
    c.strokeStyle='#ffae6a'; c.lineWidth=4; c.shadowColor=P.glow; c.shadowBlur=16; c.lineCap='round';
    for(let i=0;i<14;i++){ const a=(i/14)*6.283; const r0=70+boom*140, r1=140+boom*470;
      c.beginPath(); c.moveTo(bx+Math.cos(a)*r0,by+Math.sin(a)*r0); c.lineTo(bx+Math.cos(a)*r1,by+Math.sin(a)*r1); c.stroke(); }
    c.restore();
  }
  // aftermath: drifting smoke + embers
  if(after>0.02){
    c.save();
    for(let i=0;i<6;i++){
      const ph=frac(after*0.6+i*0.17); const sx=cx+150+(i-2.5)*130+Math.sin(t+i)*30;
      const sy=G-260-ph*260;
      c.globalAlpha=Math.sin(ph*Math.PI)*0.25*after;
      c.fillStyle=radial(c,sx,sy,90,[[0,'rgba(90,70,80,0.8)'],[1,'rgba(90,70,80,0)']]);
      c.beginPath(); c.arc(sx,sy,80,0,Math.PI*2); c.fill();
    }
    c.globalCompositeOperation='screen';
    for(let i=0;i<10;i++){ const ph=frac(after*0.9+i*0.11);
      c.globalAlpha=Math.sin(ph*Math.PI)*0.7*after; c.fillStyle=i%2?'#ffae6a':'#ff8a5a';
      c.beginPath(); c.arc(cx+150+(i-5)*90+Math.sin(t*2+i)*24, G-140-ph*420, 2.5+(i%3),0,Math.PI*2); c.fill(); }
    c.restore();
    // scorch mark
    c.save(); c.globalAlpha=after*0.7; c.fillStyle='#0a0406';
    c.beginPath(); c.ellipse(cx+150,G-4,190,28,0,0,Math.PI*2); c.fill(); c.restore();
  }
  AB.motes(c,t,'rgba(255,120,90,0.5)',12);
  AB.grade(c,'vice',0.3);
  },
};

export default clip;
