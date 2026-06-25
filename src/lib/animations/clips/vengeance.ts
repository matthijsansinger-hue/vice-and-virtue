// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vengeance Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "vengeance",
  bg: "#0c0406",
  poster: 1.55,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
  const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
  const P=CAMP.vice;
  c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
  motes(c,t,'rgba(255,120,90,0.6)',14);

  const cx=720, base=940;
  figure(c,{x:cx,base,s:0.92,fill:FIG});
  // bars over the jailed avenger
  c.save(); c.strokeStyle='#8b97a4'; c.lineWidth=13; c.lineCap='round';
  for(let x=cx-170;x<=cx+170;x+=70){ c.beginPath(); c.moveTo(x,330); c.lineTo(x,base-8); c.stroke(); }
  c.lineWidth=11; [378,860].forEach(y=>{ c.beginPath(); c.moveTo(cx-190,y); c.lineTo(cx+190,y); c.stroke(); }); c.restore();

  // jailers on the right (foot positions)
  const jailers=[[1320,560],[1520,720],[1340,930]];
  const target=0;
  const beam=interp([0.55,1.05],[0,1],E.easeInQuad)(t);
  const kill=interp([1.05,1.55],[0,1],E.easeOutCubic)(t);
  jailers.forEach(([jx,jy],i)=>{
    const dead = i===target ? kill : 0;
    c.save(); c.globalAlpha=clamp(1-dead*0.85,0,1);
    c.translate(0, dead*40);
    figure(c,{x:jx,base:jy,s:0.42,fill:'#2a0a0e'});
    c.restore();
  });

  // red accusing beam from the avenger to the target jailer
  const [tx,ty]=jailers[target]; const thead=ty-230*0.42*1 - 20; // approx head height
  if(beam>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(beam,0,1)*(1-kill*0.5);
    c.strokeStyle=P.glow; c.lineWidth=6; c.shadowColor=P.glow; c.shadowBlur=24;
    const ex=lerp(cx+50, tx, clamp(beam,0,1)), ey=lerp(560, ty-150, clamp(beam,0,1));
    c.beginPath(); c.moveTo(cx+50,560); c.lineTo(ex,ey); c.stroke();
    // arrowhead
    if(beam>0.95){ c.fillStyle=P.glow; c.beginPath(); c.arc(tx,ty-150,9,0,Math.PI*2); c.fill(); }
    c.restore();
  }
  // kill burst on the target
  if(kill>0 && kill<1){
    ring(c,tx,ty-150,kill,P.glow,30,180);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-kill); c.strokeStyle='#fff'; c.lineWidth=3; c.shadowColor=P.glow; c.shadowBlur=18;
    for(let i=0;i<8;i++){ const a=i/8*6.28; const r=20+kill*70; c.beginPath(); c.moveTo(tx,ty-150); c.lineTo(tx+Math.cos(a)*r,ty-150+Math.sin(a)*r); c.stroke(); }
    c.restore();
  }
  grade(c,'vice',0.33);
  },
};

export default clip;
