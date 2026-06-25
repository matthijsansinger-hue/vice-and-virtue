// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Wrath Absorb Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "wrath_absorb",
  bg: "#0c0406",
  poster: 1.6,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG,frac}=AB;
  const P=CAMP.vice;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(255,120,90,0.6)',14);
  const Wx=700, base=940, Fx0=1320;     // Wrath left, follower right

  const reach=interp([0.2,0.7],[0,1],E.easeOutCubic)(t);   // hand reaches out
  const pull=interp([0.6,1.45],[0,1],E.easeInCubic)(t);    // follower dragged in + shrinks
  const gain=interp([1.4,1.8],[0,1],E.easeOutBack)(t);     // extra life gained

  // backlight both
  c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.24;
  c.fillStyle=radial(c,Wx,660,340,[[0,'rgba(255,90,60,0.45)'],[1,'rgba(255,90,60,0)']]); c.fillRect(Wx-380,300,760,640); c.restore();

  // the follower: dragged toward Wrath, shrinking + dissolving into wisps
  const fx=lerp(Fx0, Wx+70, pull);
  const fs=lerp(0.9, 0.1, pull);
  const fAlpha=clamp(1-pull*1.05,0,1);
  if(fAlpha>0.01) figure(c,{x:fx,base,s:fs,fill:FIG,alpha:fAlpha});

  // Wrath figure
  figure(c,{x:Wx,base,s:1.0,fill:FIG});
  // outstretched arm reaching toward the follower
  const handX=lerp(Wx+50, lerp(Wx+260, Wx+90, pull), reach);
  const handY=base-440;
  c.save(); c.strokeStyle=FIG; c.lineWidth=30; c.lineCap='round';
  c.beginPath(); c.moveTo(Wx+50,base-468); c.lineTo(handX,handY); c.stroke();
  // open grasping hand
  c.fillStyle=FIG; c.beginPath(); c.arc(handX,handY,20,0,Math.PI*2); c.fill();
  c.save(); c.strokeStyle=FIG; c.lineWidth=7; c.lineCap='round';
  for(let i=0;i<4;i++){ const a=-0.6+i*0.4; c.beginPath(); c.moveTo(handX,handY); c.lineTo(handX+Math.cos(a)*26,handY+Math.sin(a)*26); c.stroke(); }
  c.restore(); c.restore();

  // soul-stream of red wisps flowing from the follower into Wrath's chest
  if(pull>0.05){
    c.save(); c.globalCompositeOperation='screen';
    for(let i=0;i<10;i++){ const ph=frac(pull*1.3 - i*0.1); if(ph<=0.02||ph>=0.98) continue;
      const x=lerp(fx, Wx, ph), y=lerp(base-300, base-360, ph) - Math.sin(ph*Math.PI)*60;
      c.globalAlpha=Math.sin(ph*Math.PI)*0.9; c.fillStyle=i%2?'#ff8a6a':'#ffd27a'; c.shadowColor=P.glow; c.shadowBlur=12;
      c.beginPath(); c.arc(x,y,5,0,Math.PI*2); c.fill();
    }
    c.restore();
  }

  // Wrath absorbs the life → a heart-glow forms on his chest (his extra life)
  if(gain>0.02){
    const hx=Wx, hy=base-360, s=40*clamp(gain,0,1.1);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(gain,0,1);
    c.fillStyle=radial(c,hx,hy,170,[[0,'rgba(255,90,60,0.6)'],[1,'rgba(255,90,60,0)']]); c.fillRect(hx-190,hy-190,380,380);
    c.fillStyle='#ff8a6a'; c.shadowColor=P.glow; c.shadowBlur=24;
    c.beginPath(); c.moveTo(hx,hy+s); c.bezierCurveTo(hx+s*1.3,hy-s*0.42,hx+s*0.55,hy-s*1.12,hx,hy-s*0.34); c.bezierCurveTo(hx-s*0.55,hy-s*1.12,hx-s*1.3,hy-s*0.42,hx,hy+s); c.closePath(); c.fill();
    c.restore();
    ring(c,hx,hy,interp([1.5,1.9],[0,1])(t),P.glow,40,320);
  }
  grade(c,'vice',0.33);
  },
};

export default clip;
