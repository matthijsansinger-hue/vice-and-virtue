// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Truthfulness Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The jailed one grips the bars; glowing threads trace back from every voter
// who condemned them, and the ledger of votes unfurls at their feet.
const clip: ClipConfig = {
  name: "truthfulness",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/truthfulness.mp4",
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow}=AB.RIG;
  const P=AB.CAMP.virtue;
  const G=940, cx=960;

  stage(c,t,'virtue');

  const press=interp([0.12,0.4],[0,1],E.easeOutCubic)(t);  // steps up, grips bars
  const beam=interp([0.5,1.4],[0,1],E.easeOutCubic)(t);
  const scroll=interp([0.35,0.9],[0,1],E.easeOutCubic)(t);

  // ── the jailed figure, gripping the bars ──
  shadow(c, cx, G+6, 130, 0.5);
  const A=rig(c,{ x:cx, ground:G, s:1.0, facing:1, pal:'virtue',
    lean: 0.1*press, bow: 0.14*press - Math.sin(t*2.6)*0.03,
    handF:[ 66, lerp(-70,-186,press) ], bendF:1,
    handB:[ -38, lerp(-56,-178,press) ], bendB:-1,
    footF:[ 30, 186 ], footB:[ -28, 186 ],
    cape:0.5, capeSway:Math.sin(t*1.8)*0.03, skirt:0.8,
    eyes:0.55, eyeCol:'#bcd6ff', rim:0.9 });

  // bars over the figure + gripping hands in front of the bars
  c.save(); c.strokeStyle='#6f7a86'; c.lineWidth=14; c.lineCap='round';
  c.shadowColor='rgba(0,0,0,0.6)'; c.shadowBlur=8;
  for(let x=cx-190;x<=cx+190;x+=76){ c.beginPath(); c.moveTo(x,310); c.lineTo(x,G-4); c.stroke(); }
  c.lineWidth=12; [360,856].forEach(y=>{ c.beginPath(); c.moveTo(cx-210,y); c.lineTo(cx+210,y); c.stroke(); }); c.restore();
  c.save(); c.fillStyle='#152238';
  c.beginPath(); c.arc(A.handF[0],A.handF[1],12.5,0,Math.PI*2); c.fill();
  c.beginPath(); c.arc(A.handB[0],A.handB[1],12,0,Math.PI*2); c.fill();
  c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.5*press;
  c.strokeStyle=P.soft; c.lineWidth=2; c.beginPath(); c.arc(A.handF[0],A.handF[1],13,-2.4,0.6); c.stroke(); c.restore();
  c.restore();

  // ── voters around the cell; threads trace back to the jailed one ──
  const voters=[[380,700,0.5],[520,880,0.58],[1400,690,0.5],[1520,880,0.58],[620,560,0.42],[1310,545,0.42]];
  voters.forEach(([vx,vy,vs],i)=>{
    const lp=clamp((beam - i*0.07)/0.5,0,1);
    // small voter figure
    shadow(c, vx, vy+4, 90*vs, 0.35);
    rig(c,{ x:vx, ground:vy, s:vs, facing: vx<cx?1:-1, pal:'shade',
      lean:Math.sin(t*2+i)*0.02, relaxF:true, relaxB:true,
      cape:0.4, skirt:0.7, rim:0.45, eyes:0.3*lp, eyeCol:'#bcd6ff' });
    if(lp<=0) return;
    const hy=vy-(186+180)*vs;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=lp*0.9;
    c.strokeStyle=P.glow; c.lineWidth=3; c.shadowColor=P.glow; c.shadowBlur=14;
    const ex=lerp(vx,cx,lp*0.92), ey=lerp(hy,540,lp*0.92);
    c.beginPath(); c.moveTo(vx,hy); c.quadraticCurveTo((vx+cx)/2, Math.min(hy,540)-70, ex,ey); c.stroke();
    c.fillStyle='#fff'; c.beginPath(); c.arc(ex,ey,5,0,Math.PI*2); c.fill();
    c.restore();
  });

  // ── the unfurling vote ledger ──
  if(scroll>0.01){
    const sw=lerp(80,430,clamp(scroll,0,1)), sh=120, sx=cx, sy=G+62;
    c.save(); c.globalAlpha=clamp(scroll,0,1);
    c.fillStyle='#ece2c4'; c.beginPath(); c.roundRect(sx-sw/2,sy-sh/2,sw,sh,10); c.fill();
    c.fillStyle='#c9b78a'; c.fillRect(sx-sw/2,sy-sh/2,sw,8); c.fillRect(sx-sw/2,sy+sh/2-8,sw,8);
    // rolled ends
    c.fillStyle='#d8cba6'; c.beginPath(); c.roundRect(sx-sw/2-14,sy-sh/2-4,14,sh+8,6); c.fill();
    c.beginPath(); c.roundRect(sx+sw/2,sy-sh/2-4,14,sh+8,6); c.fill();
    if(scroll>0.6){ c.globalAlpha=(scroll-0.6)/0.4; c.fillStyle='rgba(40,30,16,0.6)';
      for(let r=0;r<3;r++){ c.fillRect(sx-sw/2+34,sy-32+r*26,sw-140,8); }
      // check marks per exposed vote
      c.strokeStyle='#7f5a1e'; c.lineWidth=4; c.lineCap='round';
      for(let r=0;r<3;r++){ const yy=sy-28+r*26;
        c.beginPath(); c.moveTo(sx+sw/2-88,yy); c.lineTo(sx+sw/2-78,yy+8); c.lineTo(sx+sw/2-62,yy-8); c.stroke(); } }
    c.restore();
  }
  AB.ring(c,cx,540,interp([1.4,1.9],[0,1])(t),P.glow,60,440);
  AB.motes(c,t,'rgba(125,180,255,0.6)',14);
  AB.grade(c,'virtue',0.33);
  },
};

export default clip;
