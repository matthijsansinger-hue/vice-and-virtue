// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Wrath Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "wrath",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
  const P=CAMP.vice;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(255,120,90,0.6)',14);
  const cx=960, base=940;

  const morph=interp([0.8,1.45],[0,1],E.easeInOutQuad)(t);
  // virtue (blue) figure, corrupted to a vice follower (dark red)
  figure(c,{x:cx,base,s:0.96,fill:'#1c3a86'});
  if(morph>0.01) figure(c,{x:cx,base,s:0.96,fill:'#2a0810',alpha:clamp(morph,0,1)});

  // red tendrils snake out and wrap the figure
  const grab=interp([0.25,1.05],[0,1],E.easeOutCubic)(t);
  const tend=[[110,300],[70,640],[180,920],[1810,360],[1850,720],[1740,940]];
  tend.forEach(([sx,sy],i)=>{
    const g=clamp((grab - i*0.05)/0.5,0,1); if(g<=0) return;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=g*0.9;
    c.strokeStyle=P.glow; c.lineWidth=6; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=18;
    const ex=lerp(sx,cx,g), ey=lerp(sy,560,g);
    const mx=(sx+cx)/2 + Math.sin(t*3+i)*70, my=(sy+560)/2 + Math.cos(t*2+i)*60;
    c.beginPath(); c.moveTo(sx,sy); c.quadraticCurveTo(mx,my,ex,ey); c.stroke();
    // creeping tip
    c.fillStyle='#ff8a6a'; c.beginPath(); c.arc(ex,ey,5,0,Math.PI*2); c.fill();
    c.restore();
  });

  // corruption aura swallowing the figure as it turns
  if(morph>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=morph*0.6;
    c.fillStyle=radial(c,cx,560,300,[[0,'rgba(255,90,60,0.5)'],[1,'rgba(255,90,60,0)']]); c.fillRect(cx-340,260,680,640); c.restore();
    // red rim on the new follower
    c.save(); c.globalAlpha=morph*0.8; c.lineWidth=3; c.strokeStyle='#ff8a6a'; c.shadowColor=P.glow; c.shadowBlur=14;
    c.beginPath(); c.arc(cx,base-528,44,0,Math.PI*2); c.stroke(); c.restore();
  }
  ring(c,cx,560,interp([1.25,1.9],[0,1])(t),P.glow,60,440);
  grade(c,'vice',0.33);
  },
};

export default clip;
