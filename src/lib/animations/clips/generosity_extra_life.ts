// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Generosity Extra Life Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "generosity_extra_life",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/generosity_extra_life.mp4",
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG,frac}=AB;
    const P=CAMP.virtue;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(125,180,255,0.6)',14);
    const Gx=640, Rx=1280, base=940;

    const conjure=interp([0.2,0.6],[0,1],E.easeOutCubic)(t);  // giver forms a heart in hands
    const send=interp([0.62,1.2],[0,1],E.easeInOutQuad)(t);   // heart travels to receiver
    const grant=interp([1.15,1.6],[0,1],E.easeOutBack)(t);    // shield-heart wraps receiver
    const arrived=send>=0.99;

    figure(c,{x:Gx,base,s:0.96,fill:FIG});
    figure(c,{x:Rx,base,s:0.96,fill:FIG});

    // giver's cupped glow
    if(conjure>0.02 && send<0.1){
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=conjure*0.7;
      c.fillStyle=radial(c,Gx,base-300,140,[[0,'rgba(125,180,255,0.7)'],[1,'rgba(125,180,255,0)']]); c.fillRect(Gx-160,base-440,320,300); c.restore();
    }

    // the travelling heart
    if(conjure>0.05 && grant<0.6){
      const hx=lerp(Gx, Rx, send), hy=base-300 - Math.sin(send*Math.PI)*150;
      const s=34*clamp(conjure,0,1);
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.8;
      c.fillStyle=radial(c,hx,hy,150,[[0,'rgba(140,190,255,0.6)'],[1,'rgba(140,190,255,0)']]); c.fillRect(hx-160,hy-160,320,320); c.restore();
      // trailing sparkle
      c.save(); c.globalCompositeOperation='screen';
      for(let i=0;i<8;i++){ const ph=frac(send - i*0.06); if(ph<=0.02) continue; const tx=lerp(Gx,hx,ph), ty=base-300-Math.sin(ph*Math.PI*send)*120;
        c.globalAlpha=(1-i/8)*0.5; c.fillStyle=P.soft; c.beginPath(); c.arc(tx,ty,3,0,Math.PI*2); c.fill(); }
      c.restore();
      c.save(); c.fillStyle=P.soft; c.shadowColor=P.glow; c.shadowBlur=24;
      c.beginPath(); c.moveTo(hx,hy+s); c.bezierCurveTo(hx+s*1.3,hy-s*0.42,hx+s*0.55,hy-s*1.12,hx,hy-s*0.34); c.bezierCurveTo(hx-s*0.55,hy-s*1.12,hx-s*1.3,hy-s*0.42,hx,hy+s); c.closePath(); c.fill();
      c.fillStyle='#fff'; c.globalAlpha=0.6; c.beginPath(); c.arc(hx-s*0.3,hy-s*0.3,s*0.22,0,Math.PI*2); c.fill();
      c.restore();
    }

    // receiver gains a lasting extra life: a glowing heart inside a shield
    if(grant>0.02){
      const sx=Rx, sy=base-300, g=clamp(grant,0,1);
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=g*0.8;
      c.fillStyle=radial(c,sx,sy,240,[[0,'rgba(140,190,255,0.5)'],[1,'rgba(140,190,255,0)']]); c.fillRect(sx-260,sy-300,520,520); c.restore();
      // shield outline
      c.save(); c.translate(sx,sy); c.scale(g,g);
      c.strokeStyle=P.glow; c.lineWidth=7; c.shadowColor=P.glow; c.shadowBlur=22;
      c.beginPath(); c.moveTo(0,-120); c.lineTo(96,-82); c.lineTo(96,30); c.quadraticCurveTo(0,128,-96,30); c.lineTo(-96,-82); c.closePath(); c.stroke();
      // heart inside
      const s=42; c.fillStyle=P.soft; c.shadowBlur=18;
      c.beginPath(); c.moveTo(0,s); c.bezierCurveTo(s*1.3,-s*0.42,s*0.55,-s*1.12,0,-s*0.34); c.bezierCurveTo(-s*0.55,-s*1.12,-s*1.3,-s*0.42,0,s); c.closePath(); c.fill();
      c.restore();
      ring(c,sx,sy,interp([1.3,1.8],[0,1])(t),P.glow,50,360);
    }
    grade(c,'virtue',0.32);
  },
};

export default clip;
