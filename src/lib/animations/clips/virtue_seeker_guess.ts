// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Virtue Seeker Guess Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "virtue_seeker_guess",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
    const P=CAMP.virtue, V=CAMP.vice;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(125,180,255,0.6)',14);
    const base=940, xs=[470,720,970,1220,1470], target=1;

    const sweep=interp([0.2,0.85],[0,1],E.easeInOutQuad)(t);
    const lock=interp([0.85,1.0],[0,1])(t);
    const confirm=interp([1.0,1.4],[0,1],E.easeOutBack)(t);   // red Worshipper emblem revealed
    const jail=interp([1.32,1.7],[0,1],E.easeOutCubic)(t);    // correct → bars slam down
    const rx=lerp(xs[0], xs[target], sweep);

    xs.forEach((x,i)=>{
      const isT=i===target;
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.18;
      c.fillStyle=radial(c,x,660,210,[[0,'rgba(125,180,255,0.4)'],[1,'rgba(125,180,255,0)']]); c.fillRect(x-240,360,480,560); c.restore();
      figure(c,{x,base,s:0.66,fill:FIG});
      // confirmed Vice Worshipper glows red with a worshipper emblem
      if(isT && confirm>0.02){
        c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(confirm,0,1)*0.8;
        c.fillStyle=radial(c,x,base-200,200,[[0,'rgba(255,90,60,0.6)'],[1,'rgba(255,90,60,0)']]); c.fillRect(x-220,base-420,440,440); c.restore();
        const ey=base-440-clamp(confirm,0,1)*8;
        c.save(); c.translate(x,ey); c.scale(clamp(confirm,0,1),clamp(confirm,0,1));
        c.strokeStyle=V.soft; c.lineWidth=5; c.shadowColor=V.glow; c.shadowBlur=14;
        c.beginPath(); c.moveTo(0,-24); c.lineTo(22,14); c.lineTo(-22,14); c.closePath(); c.stroke();
        c.fillStyle=V.glow; c.beginPath(); c.arc(0,2,7,0,Math.PI*2); c.fill();
        c.restore();
      }
    });

    // reticle (blue)
    if(t<1.55){
      const ry=base-320, R=clamp(lerp(120,86,lock),70,130), a=t*3;
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(0.5+lock*0.5,0,1);
      c.translate(rx,ry); c.rotate(a*0.3);
      c.strokeStyle=lock>0.5?'#7db4ff':'#bcd6ff'; c.lineWidth=4; c.shadowColor=P.glow; c.shadowBlur=16;
      c.beginPath(); c.arc(0,0,R,0,Math.PI*2); c.stroke();
      for(let i=0;i<4;i++){ const aa=i/4*6.283; c.beginPath(); c.moveTo(Math.cos(aa)*(R-16),Math.sin(aa)*(R-16)); c.lineTo(Math.cos(aa)*(R+16),Math.sin(aa)*(R+16)); c.stroke(); }
      c.restore();
    }

    // iron bars slam down over the confirmed worshipper (jailed)
    if(jail>0.01){
      const x=xs[target], topY=base-560, barH=(base-30)-topY;
      c.save();
      const drop=interp([0,1],[0,1],E.easeOutCubic)(jail);
      c.globalAlpha=clamp(jail*1.4,0,1);
      c.strokeStyle='#cfd6de'; c.lineWidth=12; c.lineCap='round'; c.shadowColor='rgba(0,0,0,0.5)'; c.shadowBlur=8;
      for(let k=-2;k<=2;k++){ const bx=x+k*46; const yEnd=topY+barH*drop;
        c.beginPath(); c.moveTo(bx,topY); c.lineTo(bx,yEnd); c.stroke(); }
      if(drop>0.6){ c.lineWidth=10;
        [topY+90, base-120].forEach(yy=>{ c.beginPath(); c.moveTo(x-110,yy); c.lineTo(x+110,yy); c.stroke(); }); }
      c.restore();
      // impact dust at the base when bars land
      if(drop>0.9){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-(drop-0.9)/0.1)*0.5;
        c.fillStyle=radial(c,x,base-20,160,[[0,'rgba(200,220,255,0.5)'],[1,'rgba(200,220,255,0)']]); c.fillRect(x-180,base-120,360,140); c.restore(); }
    }
    ring(c,xs[target],base-330,interp([1.4,1.85],[0,1])(t),P.glow,40,360);
    grade(c,'virtue',0.32);
  },
};

export default clip;
