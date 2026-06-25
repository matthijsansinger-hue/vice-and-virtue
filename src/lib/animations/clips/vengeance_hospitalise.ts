// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vengeance Hospitalise Ability - Video Export.html".
// The handoff defined the body as a sibling-script `punchHospital` function and `draw`
// just invoked it with {female:true}; here that exact function body is inlined as a
// draw-local so the module is self-contained. Drawing code verbatim.
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "vengeance_hospitalise",
  bg: "#0c0406",
  poster: 1.85,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    function punchHospital(c,t,AB,opts){
  const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
  const P=CAMP.vice; opts=opts||{};
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(255,120,90,0.5)',12);
  const FLOORY=940, Ax=690, Vx=1130, cotX=1180;
  const punch=interp([0.28,0.8],[0,1],E.easeInQuad)(t);
  const recoil=interp([0.76,0.98],[0,1])(t);
  const collapse=interp([1.0,1.55],[0,1],E.easeInCubic)(t);
  const settle=interp([1.35,1.9],[0,1],E.easeOutCubic)(t);
  if(settle>0.001){
    c.save(); c.globalAlpha=clamp(settle,0,1); const by=FLOORY,bx=cotX;
    c.fillStyle='#1a0e10'; c.fillRect(bx-250,by-70,16,70); c.fillRect(bx+234,by-70,16,70);
    c.fillStyle='#2a1a1e'; c.fillRect(bx-270,by-96,540,30);
    c.fillStyle='#3b2a2f'; c.fillRect(bx-270,by-118,540,24);
    c.fillStyle='#52423f'; c.beginPath(); c.roundRect(bx-250,by-150,120,40,12); c.fill(); c.restore();
  }
  figure(c,{x:Ax,base:FLOORY,s:0.95,fill:FIG,female:opts.female});
  { const reach=lerp(40,300,punch) - recoil*30;
    const fistX=Ax+50+reach, fistY=FLOORY-440;
    c.save(); c.strokeStyle=FIG; c.lineWidth=34; c.lineCap='round';
    c.beginPath(); c.moveTo(Ax+50,FLOORY-468); c.lineTo(fistX,fistY); c.stroke();
    c.fillStyle=FIG; c.beginPath(); c.arc(fistX,fistY,24,0,Math.PI*2); c.fill(); c.restore();
  }
  if(collapse<0.55){
    const sinkBase=FLOORY+collapse*30;
    c.save(); c.globalAlpha=clamp(1-collapse*1.9,0,1);
    c.translate(Vx,sinkBase); c.rotate(recoil*0.16 + collapse*0.6); c.translate(-Vx,-sinkBase);
    figure(c,{x:Vx,base:sinkBase,s:0.95,fill:FIG}); c.restore();
  }
  if(collapse>0.35){
    const ly=FLOORY-150;
    c.save(); c.globalAlpha=clamp((collapse-0.35)/0.4,0,1);
    c.translate(cotX-30,ly); c.scale(0.92,0.92); c.fillStyle=FIG;
    c.beginPath(); c.roundRect(-150,-2,300,52,26); c.fill();
    c.beginPath(); c.arc(-180,24,40,0,Math.PI*2); c.fill();
    c.beginPath(); c.moveTo(150,6); c.lineTo(250,18); c.lineTo(250,34); c.lineTo(150,44); c.closePath(); c.fill();
    c.restore();
  }
  const impact=interp([0.76,0.84,1.0],[0,1,0])(t);
  if(impact>0.01){
    const ix=Vx-46, iy=FLOORY-512;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=impact;
    c.fillStyle=radial(c,ix,iy,90,[[0,'#fff'],[0.4,'rgba(255,140,100,0.7)'],[1,'rgba(255,90,60,0)']]); c.beginPath(); c.arc(ix,iy,86,0,Math.PI*2); c.fill();
    c.strokeStyle='#ffd0b0'; c.lineWidth=4;
    for(let i=0;i<8;i++){ const a=i/8*6.283; const r=30+impact*40; c.beginPath(); c.moveTo(ix+Math.cos(a)*16,iy+Math.sin(a)*16); c.lineTo(ix+Math.cos(a)*r,iy+Math.sin(a)*r); c.stroke(); }
    c.restore();
  }
  if(settle>0.05){
    const cy2=FLOORY-300, ccx=cotX, gl=interp([1.45,1.8],[0,1],E.easeOutBack)(t);
    ring(c,ccx,cy2,interp([1.5,1.95],[0,1])(t),P.glow,40,360);
    c.save(); c.globalAlpha=clamp(gl,0,1); c.translate(ccx,cy2); c.scale(clamp(gl,0,1.05),clamp(gl,0,1.05));
    c.shadowColor='#ff6a5a'; c.shadowBlur=30; c.fillStyle='#f4e6e6'; const a=20,b=64;
    c.fillRect(-a,-b,a*2,b*2); c.fillRect(-b,-a,b*2,a*2);
    c.fillStyle=P.key; c.shadowBlur=0; const a2=12,b2=52; c.fillRect(-a2,-b2,a2*2,b2*2); c.fillRect(-b2,-a2,b2*2,a2*2);
    c.restore();
  }
  grade(c,'vice',0.32);
}
    punchHospital(c,t,AB,{female:true});
  },
};

export default clip;
