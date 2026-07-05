// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Love Tiebreak Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "love_tiebreak",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/love_tiebreak.mp4",
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
    const P=CAMP.virtue;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(125,180,255,0.6)',14);

    const pivotX=960, pivotY=300, armLen=400, floor=980;
    // a perfectly balanced vote (tie), then Love's heart drops on the left pan and tips it
    const heartDrop=interp([0.35,0.92],[0,1],E.easeInCubic)(t);   // heart falls onto left pan
    const tip=interp([0.9,1.4],[0,1],E.easeOutBack)(t);           // left pan sinks
    const jail=interp([1.3,1.75],[0,1],E.easeOutCubic)(t);        // chosen one imprisoned
    const a=clamp(tip,0,1)*0.24;                                  // beam angle (left sinks → +y on left)

    // central post + base
    c.fillStyle='#1a2547'; c.fillRect(pivotX-12,pivotY,24,560);
    c.beginPath(); c.moveTo(pivotX-90,860); c.lineTo(pivotX+90,860); c.lineTo(pivotX+60,888); c.lineTo(pivotX-60,888); c.closePath(); c.fill();

    // beam endpoints (left sinks down as a grows)
    const Lx=pivotX-Math.cos(a)*armLen, Ly=pivotY+Math.sin(a)*armLen;
    const Rx=pivotX+Math.cos(a)*armLen, Ry=pivotY-Math.sin(a)*armLen;
    // beam bar
    c.save(); c.strokeStyle='#33508f'; c.lineWidth=16; c.lineCap='round';
    c.beginPath(); c.moveTo(Lx,Ly); c.lineTo(Rx,Ry); c.stroke(); c.restore();
    c.fillStyle=P.glow; c.beginPath(); c.arc(pivotX,pivotY,16,0,Math.PI*2); c.fill();

    // a hanging pan with stacked vote chips; returns dish center
    function pan(ex,ey,voteN){
      c.strokeStyle='#42548a'; c.lineWidth=3;
      c.beginPath(); c.moveTo(ex,ey); c.lineTo(ex-66,ey+96); c.moveTo(ex,ey); c.lineTo(ex+66,ey+96); c.stroke();
      const dy=ey+100;
      c.fillStyle='#243a6e'; c.beginPath(); c.ellipse(ex,dy,82,20,0,0,Math.PI*2); c.fill();
      c.fillStyle='#1a2c54'; c.beginPath(); c.ellipse(ex,dy-4,82,16,0,0,Math.PI*2); c.fill();
      for(let i=0;i<voteN;i++){ c.fillStyle=i%2?'#9fb6e6':'#c7d7ff'; c.beginPath(); c.ellipse(ex-28+(i%3)*28, dy-10-Math.floor(i/3)*13, 17,7,0,0,Math.PI*2); c.fill(); }
      return {x:ex,y:dy};
    }
    const Lp=pan(Lx,Ly,3);
    const Rp=pan(Rx,Ry,3);

    // Love's heart — falls onto the left pan, then rests there glowing
    {
      const landed = heartDrop>=1;
      const hx=Lp.x, hy=landed?Lp.y-30:lerp(120, Lp.y-30, heartDrop), s=landed?28:34;
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.8;
      c.fillStyle=radial(c,hx,hy,120,[[0,'rgba(255,150,200,0.55)'],[1,'rgba(255,150,200,0)']]); c.fillRect(hx-130,hy-130,260,260); c.restore();
      c.save(); c.fillStyle='#ff7ab0'; c.shadowColor='#ff9ec9'; c.shadowBlur=22;
      c.beginPath(); c.moveTo(hx,hy+s); c.bezierCurveTo(hx+s*1.3,hy-s*0.42,hx+s*0.55,hy-s*1.12,hx,hy-s*0.34); c.bezierCurveTo(hx-s*0.55,hy-s*1.12,hx-s*1.3,hy-s*0.42,hx,hy+s); c.closePath(); c.fill(); c.restore();
    }

    // the figure Love backed (beneath the heavy left pan) is jailed on the floor
    if(jail>0.01){
      const x=Lx, base=floor, topY=base-300;
      c.save(); c.globalAlpha=clamp(jail*1.3,0,1);
      figure(c,{x,base,s:0.5,fill:FIG});
      const drop=interp([0,1],[0,1],E.easeOutCubic)(jail);
      c.strokeStyle='#cfd6de'; c.lineWidth=10; c.lineCap='round'; c.shadowColor='rgba(0,0,0,0.5)'; c.shadowBlur=8;
      for(let k=-2;k<=2;k++){ const bx=x+k*40; c.beginPath(); c.moveTo(bx,topY); c.lineTo(bx,topY+(base-20-topY)*drop); c.stroke(); }
      if(drop>0.6){ c.lineWidth=8; [topY+70,base-90].forEach(yy=>{ c.beginPath(); c.moveTo(x-92,yy); c.lineTo(x+92,yy); c.stroke(); }); }
      c.restore();
    }
    ring(c,Lp.x,Lp.y,interp([1.4,1.85],[0,1])(t),'#ff9ec9',40,300);
    grade(c,'virtue',0.3);
  },
};

export default clip;
