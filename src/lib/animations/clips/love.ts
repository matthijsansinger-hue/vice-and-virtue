// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Love Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "love",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
  const P=CAMP.virtue;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(125,180,255,0.6)',14);
  const cx=960, base=940;

  const morph=interp([0.75,1.4],[0,1],E.easeInOutQuad)(t);
  // vice (red) figure, turned to a virtue seeker (blue)
  figure(c,{x:cx,base,s:0.96,fill:'#5a1018'});
  if(morph>0.01) figure(c,{x:cx,base,s:0.96,fill:'#16307a',alpha:clamp(morph,0,1)});

  // a radiant blue heart blooms above and washes light down over the figure
  const bloom=interp([0.3,1.0],[0,1],E.easeOutBack)(t);
  function heart(x,y,s){ c.beginPath(); c.moveTo(x,y+s);
    c.bezierCurveTo(x+s*1.3,y-s*0.42, x+s*0.55,y-s*1.12, x,y-s*0.34);
    c.bezierCurveTo(x-s*0.55,y-s*1.12, x-s*1.3,y-s*0.42, x,y+s); c.closePath(); }
  const hy=400, hs=70*clamp(bloom,0,1.05);
  if(bloom>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(bloom,0,1);
    c.fillStyle=radial(c,cx,hy,260,[[0,'rgba(140,190,255,0.55)'],[1,'rgba(140,190,255,0)']]); c.fillRect(cx-300,hy-260,600,640);
    c.fillStyle=P.soft; c.shadowColor=P.glow; c.shadowBlur=30; heart(cx,hy,hs); c.fill();
    c.fillStyle='#fff'; c.globalAlpha=clamp(bloom,0,1)*0.5; heart(cx,hy,hs*0.5); c.fill();
    c.restore();
    // light rays washing down onto the figure
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(bloom,0,1)*0.4*morph;
    c.fillStyle=vlinHelp(c,cx,hy,560);
    c.beginPath(); c.moveTo(cx-70,hy+40); c.lineTo(cx+70,hy+40); c.lineTo(cx+200,900); c.lineTo(cx-200,900); c.closePath(); c.fill();
    c.restore();
  }
  function vlinHelp(c,x,y0,y1){ const g=c.createLinearGradient(x,y0,x,y1); g.addColorStop(0,'rgba(140,190,255,0.5)'); g.addColorStop(1,'rgba(140,190,255,0)'); return g; }

  ring(c,cx,560,interp([1.25,1.9],[0,1])(t),P.glow,60,440);
  grade(c,'virtue',0.34);
  },
};

export default clip;
