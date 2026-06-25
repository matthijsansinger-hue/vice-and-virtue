// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Determination Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "determination",
  bg: "#050818",
  poster: 1.75,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
    const P=CAMP.virtue;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(125,180,255,0.6)',14);
    const cx=960, base=940;

    const lift=interp([0.2,0.78],[0,1],E.easeInOutQuad)(t);   // press the bar overhead
    const lighten=interp([0.7,1.45],[0,1],E.easeOutCubic)(t); // grows lighter (floats + glows)
    const pop=interp([1.35,1.75],[0,1],E.easeOutBack)(t);     // heart pops out

    const floatY=-lighten*30*(0.5+0.5*Math.sin(t*3));         // gentle rise as weight leaves
    const fb=base+floatY;

    // brightening aura as he becomes lighter
    if(lighten>0.02){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=lighten*0.6;
      c.fillStyle=radial(c,cx,fb-300,300,[[0,'rgba(140,190,255,0.5)'],[1,'rgba(140,190,255,0)']]); c.fillRect(cx-340,fb-620,680,640); c.restore(); }

    // figure (gets a blue rim as it lightens)
    figure(c,{x:cx,base:fb,s:0.98,fill:FIG});
    if(lighten>0.1){ c.save(); c.globalAlpha=lighten*0.7; c.lineWidth=3; c.strokeStyle=P.soft; c.shadowColor=P.glow; c.shadowBlur=16;
      c.beginPath(); c.arc(cx,fb-518,44,0,Math.PI*2); c.stroke(); c.restore(); }

    // arms pressing a barbell overhead; plates shrink as he gets lighter
    const barY=lerp(fb-470, fb-660, lift);
    c.save(); c.strokeStyle=FIG; c.lineWidth=30; c.lineCap='round';
    c.beginPath(); c.moveTo(cx-48,fb-456); c.lineTo(cx-150,barY+10); c.stroke();
    c.beginPath(); c.moveTo(cx+48,fb-456); c.lineTo(cx+150,barY+10); c.stroke();
    c.restore();
    // bar + plates
    c.save(); c.fillStyle='#cdd7e6'; c.fillRect(cx-200,barY-6,400,12);
    const plate=lerp(64,16,lighten);
    c.fillStyle='#9aa6b8';
    [-176,176].forEach(px=>{ c.fillRect(cx+px-12,barY-plate,24,plate*2); });
    c.fillStyle='#7d8aa0';
    [-150,150].forEach(px=>{ c.fillRect(cx+px-9,barY-plate*0.7,18,plate*1.4); });
    c.restore();

    // a heart pops out of the chest and floats up (the gained extra life)
    if(pop>0.01){
      const hy=lerp(fb-300, fb-470, pop), s=46*clamp(pop,0,1.1);
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(pop,0,1);
      c.fillStyle=radial(c,cx,hy,180,[[0,'rgba(140,190,255,0.6)'],[1,'rgba(140,190,255,0)']]); c.fillRect(cx-200,hy-200,400,400);
      c.fillStyle=P.soft; c.shadowColor=P.glow; c.shadowBlur=26;
      c.beginPath(); c.moveTo(cx,hy+s); c.bezierCurveTo(cx+s*1.3,hy-s*0.42,cx+s*0.55,hy-s*1.12,cx,hy-s*0.34); c.bezierCurveTo(cx-s*0.55,hy-s*1.12,cx-s*1.3,hy-s*0.42,cx,hy+s); c.closePath(); c.fill();
      c.fillStyle='#fff'; c.globalAlpha=clamp(pop,0,1)*0.6; c.beginPath(); c.arc(cx-s*0.3,hy-s*0.3,s*0.22,0,Math.PI*2); c.fill();
      c.restore();
      ring(c,cx,hy,interp([1.5,1.9],[0,1])(t),P.glow,40,300);
    }
    grade(c,'virtue',0.34);
  },
};

export default clip;
