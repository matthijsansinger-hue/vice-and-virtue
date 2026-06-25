// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Plant Ability - Video Export.html".
// The source declared `bomb`/`spark` as top-level helpers alongside AB.register;
// they are reproduced verbatim as locals at the top of draw() so the body stays self-contained.
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "fanaticism_plant",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    function bomb(c,x,y,r,P,t,AB){
      c.save(); c.translate(x,y);
      c.fillStyle='#0a0608'; c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.fill();
      c.fillStyle='#241015'; c.beginPath(); c.arc(-r*0.3,-r*0.3,r*0.38,0,Math.PI*2); c.fill();
      c.fillStyle='#1a0e10'; c.fillRect(-r*0.3,-r-12,r*0.6,14);
      c.restore();
    }
    function spark(c,x,y,t,AB){
      c.save(); c.globalCompositeOperation='screen';
      c.fillStyle=AB.radial(c,x,y,28,[[0,'#fff'],[0.4,'#ffb347'],[1,'rgba(255,120,40,0)']]); c.beginPath(); c.arc(x,y,24,0,Math.PI*2); c.fill();
      for(let i=0;i<6;i++){ const a=AB.frac(t*3+i*0.17)*6.28; const r=10+AB.frac(t*2+i)*22; c.globalAlpha=(1-AB.frac(t*2+i))*0.8; c.fillStyle='#ffd27a'; c.beginPath(); c.arc(x+Math.cos(a)*r,y+Math.sin(a)*r,2.4,0,Math.PI*2); c.fill(); }
      c.restore();
    }
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
    const P=CAMP.vice;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(255,120,90,0.5)',12);
    const Lx=650, Rx=1270, base=940;
    // backlight so silhouettes read
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.26;
    c.fillStyle=radial(c,Lx,660,320,[[0,'rgba(255,90,60,0.45)'],[1,'rgba(255,90,60,0)']]); c.fillRect(Lx-360,300,720,640);
    c.fillStyle=radial(c,Rx,660,320,[[0,'rgba(255,90,60,0.4)'],[1,'rgba(255,90,60,0)']]); c.fillRect(Rx-360,300,720,640);
    c.restore();
    figure(c,{x:Lx,base,s:0.9,fill:FIG});
    figure(c,{x:Rx,base,s:0.9,fill:FIG});

    // the planter slips the bomb across into the other's hands (no detonation)
    const pass=interp([0.35,1.15],[0,1],E.easeInOutQuad)(t);
    const settle=interp([1.1,1.6],[0,1],E.easeOutCubic)(t);
    const bx=lerp(Lx+96,Rx-96,pass), by=560-Math.sin(pass*Math.PI)*150;
    // sneaky stretched hand from the planter following the bomb
    c.save(); c.strokeStyle=FIG; c.lineWidth=26; c.lineCap='round'; c.globalAlpha=clamp(1-settle,0,1);
    c.beginPath(); c.moveTo(Lx+50,560); c.lineTo(lerp(Lx+96,bx-30,clamp(pass*1.1,0,1)),by+10); c.stroke(); c.restore();
    bomb(c,bx,by,38,P,t,AB);
    spark(c,bx,by-50,t,AB);
    // receiver clutches it: subtle red glow once planted
    if(settle>0.05){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=settle*0.5;
      c.fillStyle=radial(c,Rx-96,540,180,[[0,'rgba(255,90,60,0.5)'],[1,'rgba(255,90,60,0)']]); c.fillRect(Rx-300,360,400,360); c.restore(); }
    ring(c,Rx-96,540,interp([1.3,1.9],[0,1])(t),P.glow,40,300);
    grade(c,'vice',0.32);
  },
};

export default clip;
