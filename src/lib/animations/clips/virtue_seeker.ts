// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Virtue Seeker Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "virtue_seeker",
  bg: "#050818",
  poster: 1.6,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,grade,ring,motes,CAMP,FIG}=AB;
  const P=CAMP.virtue;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(125,180,255,0.6)',14);

  const bx=960, by=975;
  c.fillStyle=FIG;
  c.beginPath(); c.moveTo(bx-196,by); c.lineTo(bx-100,by-470); c.quadraticCurveTo(bx,by-512,bx+100,by-470); c.lineTo(bx+196,by); c.closePath(); c.fill();
  c.beginPath(); c.arc(bx,by-468,72,0,Math.PI*2); c.fill();
  c.beginPath(); c.moveTo(bx-78,by-452); c.quadraticCurveTo(bx,by-572,bx+78,by-452); c.quadraticCurveTo(bx,by-512,bx-78,by-452); c.closePath(); c.fill();
  c.fillStyle='#000'; c.beginPath(); c.ellipse(bx,by-468,34,46,0,0,Math.PI*2); c.fill();
  c.save(); c.globalCompositeOperation='screen'; c.fillStyle=P.glow; c.shadowColor=P.glow; c.shadowBlur=12;
  c.beginPath(); c.arc(bx-13,by-470,5,0,Math.PI*2); c.arc(bx+13,by-470,5,0,Math.PI*2); c.fill(); c.restore();

  const part=interp([0.4,1.05],[0,1],E.easeOutCubic)(t);
  const sy=by-300;
  const off=part*130;
  function flap(dir){ c.save(); c.translate(dir*off,0); c.fillStyle='#0a1230';
    c.beginPath(); c.moveTo(bx,by-460); c.lineTo(bx,by-110); c.lineTo(bx+dir*150,by-80); c.lineTo(bx+dir*150,by-440); c.closePath(); c.fill();
    c.strokeStyle='#16224e'; c.lineWidth=5; c.stroke(); c.restore(); }
  flap(-1); flap(1);

  // glowing eye sigil revealed on the chest (brightens as the cloak opens)
  if(part>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(part*1.1,0,1); c.translate(bx,sy);
    c.fillStyle=radial(c,0,0,160,[[0,'rgba(125,180,255,0.6)'],[1,'rgba(125,180,255,0)']]); c.fillRect(-170,-170,340,340);
    c.strokeStyle='#bcd6ff'; c.lineWidth=8; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=28;
    c.beginPath(); c.moveTo(-80,0); c.quadraticCurveTo(0,-52,80,0); c.quadraticCurveTo(0,52,-80,0); c.closePath(); c.stroke();
    c.fillStyle=P.glow; c.beginPath(); c.arc(0,0,22,0,Math.PI*2); c.fill();
    c.fillStyle='#fff'; c.beginPath(); c.arc(0,0,9,0,Math.PI*2); c.fill();
    c.strokeStyle='#bcd6ff'; c.lineWidth=5;
    for(let i=0;i<8;i++){ const a=i/8*6.283; c.beginPath(); c.moveTo(Math.cos(a)*92,Math.sin(a)*60); c.lineTo(Math.cos(a)*120,Math.sin(a)*80); c.stroke(); }
    c.restore();
  }

  ring(c,bx,sy,interp([1.2,1.85],[0,1])(t),P.glow,50,400);
  grade(c,'virtue',0.34);
  },
};

export default clip;
