// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Generosity Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "generosity",
  bg: "#050818",
  poster: 1.6,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG,frac}=AB;
    const P=CAMP.virtue;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(125,180,255,0.6)',14);
    const Lx=650, Rx=1270, base=940;

    const recv=interp([0.95,1.8],[0,1],E.easeOutCubic)(t);
    figure(c,{x:Lx,base,s:0.9,fill:FIG});
    // receiver brightens as the gift arrives
    figure(c,{x:Rx,base,s:0.9,fill:FIG});
    if(recv>0.02){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=recv*0.7;
      c.fillStyle=radial(c,Rx,560,260,[[0,'rgba(140,190,255,0.6)'],[1,'rgba(140,190,255,0)']]); c.fillRect(Rx-300,300,600,560); c.restore(); }

    // stream of glowing energy orbs flowing left → right
    const flow=interp([0.25,1.5],[0,1])(t);
    for(let i=0;i<9;i++){
      const ph=frac(flow*1.15 - i*0.11); if(ph<=0.02||ph>=0.98) continue;
      const x=lerp(Lx+96,Rx-96,ph), y=560 - Math.sin(ph*Math.PI)*130;
      const a=Math.sin(ph*Math.PI);
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=a;
      c.fillStyle=radial(c,x,y,26,[[0,'#fff'],[0.4,'#bcd6ff'],[1,'rgba(125,180,255,0)']]); c.beginPath(); c.arc(x,y,22,0,Math.PI*2); c.fill();
      c.fillStyle=P.soft; c.shadowColor=P.glow; c.shadowBlur=14; c.beginPath(); c.arc(x,y,7,0,Math.PI*2); c.fill();
      c.restore();
    }
    // giver's hand glow source
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=interp([0.2,0.5],[0,1])(t)*0.6;
    c.fillStyle=radial(c,Lx+96,560,150,[[0,'rgba(140,190,255,0.6)'],[1,'rgba(140,190,255,0)']]); c.fillRect(Lx-100,420,400,300); c.restore();

    ring(c,Rx,560,interp([1.3,1.9],[0,1])(t),P.glow,50,400);
    grade(c,'virtue',0.34);
  },
};

export default clip;
