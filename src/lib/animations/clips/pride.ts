// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Pride Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "pride",
  bg: "#0c0406",
  poster: 1.5,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG,GOLD,WARM}=AB;
    const P=CAMP.vice;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(255,160,90,0.6)',14);
    const cx=820, ox=1280, base=940, cy=540;

    const flare=interp([0.35,1.05],[0,1],E.easeOutCubic)(t);
    const dazzled=interp([1.0,1.6],[0,1],E.easeOutCubic)(t);

    // dazzling radiant rays behind the proud figure (peacock fan)
    if(flare>0.02){
      c.save(); c.globalCompositeOperation='screen'; c.translate(cx,cy);
      for(let i=0;i<16;i++){ const a=(i/16)*6.283 + t*0.3; const len=lerp(60,360,clamp(flare,0,1))*(0.7+0.3*Math.sin(i*1.7));
        c.globalAlpha=clamp(flare,0,1)*0.5; c.strokeStyle= i%2? GOLD:WARM; c.lineWidth=8; c.shadowColor=GOLD; c.shadowBlur=18;
        c.beginPath(); c.moveTo(0,0); c.lineTo(Math.cos(a)*len,Math.sin(a)*len); c.stroke(); }
      c.restore();
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(flare,0,1)*0.7;
      c.fillStyle=radial(c,cx,cy,340,[[0,'rgba(255,207,122,0.7)'],[1,'rgba(255,207,122,0)']]); c.fillRect(cx-380,cy-380,760,760); c.restore();
    }

    // the proud figure (gold-rimmed)
    figure(c,{x:cx,base,s:1.0,fill:FIG});
    if(flare>0.1){ c.save(); c.globalAlpha=clamp(flare,0,1)*0.9; c.lineWidth=4; c.strokeStyle=GOLD; c.shadowColor=GOLD; c.shadowBlur=18;
      c.beginPath(); c.arc(cx,base-528,44,0,Math.PI*2); c.stroke(); c.restore(); }

    // the dazzled onlooker recoils + scores nothing (∅)
    c.save(); c.translate(0, dazzled*8);
    figure(c,{x:ox,base,s:0.86,fill:'#1a0608',alpha:clamp(1-dazzled*0.35,0,1)});
    c.restore();
    if(dazzled>0.05){
      // ∅ score-nothing glyph over the onlooker
      c.save(); c.globalAlpha=clamp(dazzled,0,1); c.translate(ox,cy-120); const s=clamp(dazzled,0,1);
      c.scale(s,s); c.strokeStyle=P.glow; c.lineWidth=8; c.shadowColor=P.glow; c.shadowBlur=16;
      c.beginPath(); c.arc(0,0,42,0,Math.PI*2); c.stroke();
      c.beginPath(); c.moveTo(-30,30); c.lineTo(30,-30); c.stroke();
      c.restore();
      // dazzle wash over the onlooker
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=dazzled*0.3;
      c.fillStyle=radial(c,ox,cy,260,[[0,'rgba(255,207,122,0.5)'],[1,'rgba(255,207,122,0)']]); c.fillRect(ox-300,cy-300,600,600); c.restore();
    }

    ring(c,cx,cy,interp([1.0,1.7],[0,1])(t),GOLD,70,460);
    grade(c,'vice',0.3);
  },
};

export default clip;
