// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vengeance Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// From behind her cell bars, the avenger thrusts a hand out and a red hex
// beam strikes one of the jailers down.
const clip: ClipConfig = {
  name: "vengeance",
  bg: "#0c0406",
  poster: 1.5,
  duration: 2.0,
  video: "/animations/vengeance.mp4",
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,impact}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=940, cx=620;

  stage(c,t,'vice');

  const grip=interp([0.1,0.35],[0,1],E.easeOutCubic)(t);   // grabs the bars
  const thrust=interp([0.45,0.66],[0,1],E.easeOutCubic)(t); // arm shoots through
  const beam=interp([0.66,0.95],[0,1],E.easeInQuad)(t);
  const kill=interp([0.95,1.45],[0,1],E.easeOutCubic)(t);

  // ── jailers (right side, staggered depth) ──
  const jailers=[ {x:1340, g:790, s:0.62}, {x:1600, g:850, s:0.7}, {x:1430, g:960, s:0.8} ];
  const target=1;
  jailers.forEach((j,i)=>{
    const dead = i===target ? kill : 0;
    shadow(c, j.x, j.g+4, 110*j.s*(1-dead*0.3), 0.4);
    c.save();
    if(dead>0){
      const hy=lerp(j.g-186*j.s, j.g-40*j.s, dead);
      c.translate(j.x+dead*40*j.s, hy); c.rotate(dead*Math.PI*0.42);
      c.globalAlpha=clamp(1-dead*0.25,0,1);
      rig(c,{ x:0, ground:186, s:j.s, facing:-1, pal:'shade', lean:-dead*0.2, bow:dead*0.5,
        relaxF:true, relaxB:true, cape:0.4, skirt:0.7, rim:0.5 });
    } else {
      const sway=Math.sin(t*2+i*2.4)*0.02;
      rig(c,{ x:j.x, ground:j.g, s:j.s, facing:-1, pal:'shade', lean:sway,
        handF:[36,-96], bendF:1, relaxB:true,  // hand resting on belt
        cape:0.4, skirt:0.7, rim:0.5, eyes:0.35, eyeCol:'#ffd7b0' });
    }
    c.restore();
  });

  // ── the avenger in her cell ──
  const hf=[ lerp(56,150,thrust), lerp(-150,-172,thrust) ];
  shadow(c, cx, G+6, 130, 0.5);
  const A=rig(c,{ x:cx, ground:G, s:1.0, facing:1, pal:'vice2', hoodUp:false,
    lean: 0.06*grip + 0.1*thrust,
    handF:hf, bendF:1,
    handB:[ -6, -158 ], bendB:-1,       // other hand gripping a bar
    footF:[ 34+thrust*20, 186 ], footB:[ -30, 186 ],
    cape:0.5, capeSway:0.06*thrust, skirt:1.0,
    eyes:0.6+beam*0.4, eyeCol:'#ff5a3c', rim:0.9 });

  // cell bars (drawn over her; the thrusting forearm re-drawn outside)
  c.save(); c.strokeStyle='#6f7a86'; c.lineWidth=14; c.lineCap='round';
  c.shadowColor='rgba(0,0,0,0.6)'; c.shadowBlur=8;
  for(let x=cx-190;x<=cx+190;x+=76){ c.beginPath(); c.moveTo(x,300); c.lineTo(x,G-4); c.stroke(); }
  c.lineWidth=12; [352,850].forEach(y=>{ c.beginPath(); c.moveTo(cx-210,y); c.lineTo(cx+210,y); c.stroke(); }); c.restore();
  // grip hands over the bars
  c.save(); c.fillStyle='#2e1216';
  c.beginPath(); c.arc(A.handB[0],A.handB[1],12,0,Math.PI*2); c.fill();
  if(thrust>0.3){ // forearm through the bars
    c.strokeStyle='#6e2030'; c.lineWidth=20; c.lineCap='round';
    c.beginPath(); c.moveTo(cx+186,A.handF[1]+4); c.lineTo(A.handF[0],A.handF[1]); c.stroke();
    c.fillStyle='#2e1216'; c.beginPath(); c.arc(A.handF[0],A.handF[1],12,0,Math.PI*2); c.fill();
  } else {
    c.beginPath(); c.arc(A.handF[0],A.handF[1],12,0,Math.PI*2); c.fill();
  }
  c.restore();

  // ── the vengeance beam ──
  const tj=jailers[target], thx=tj.x-10, thy=tj.g-(186+206)*tj.s*0.98;
  if(beam>0.02){
    const bx=lerp(A.handF[0]+14, thx, clamp(beam,0,1)), by=lerp(A.handF[1], thy, clamp(beam,0,1));
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(beam*1.4,0,1)*clamp(1-kill*1.4,0,1);
    c.strokeStyle=P.glow; c.lineWidth=7; c.shadowColor=P.glow; c.shadowBlur=26; c.lineCap='round';
    c.beginPath(); c.moveTo(A.handF[0]+14,A.handF[1]); c.lineTo(bx,by); c.stroke();
    c.strokeStyle='#ffd0c0'; c.lineWidth=2.5;
    c.beginPath(); c.moveTo(A.handF[0]+14,A.handF[1]); c.lineTo(bx,by); c.stroke();
    c.restore();
  }
  impact(c, thx, thy, interp([0.95,1.05,1.35],[0,1,0])(t), '#ff6a4a');
  AB.ring(c, thx, thy, interp([1.0,1.6],[0,1])(t), P.glow, 30, 300);
  AB.motes(c,t,'rgba(255,120,90,0.6)',14);
  AB.grade(c,'vice',0.32);
  },
};

export default clip;
