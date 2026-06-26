// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Vice Worshipper Guess Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "vice_worshipper_guess",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
    const P=CAMP.vice, V=CAMP.virtue;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(255,120,90,0.5)',12);
    const base=940, xs=[470,720,970,1220,1470], target=3;

    // a red targeting reticle sweeps the line-up, then snaps onto the guess
    const sweep=interp([0.2,0.85],[0,1],E.easeInOutQuad)(t);
    const lock=interp([0.85,1.0],[0,1])(t);
    const confirm=interp([1.0,1.4],[0,1],E.easeOutBack)(t);   // blue Seeker emblem revealed
    const kill=interp([1.35,1.7],[0,1],E.easeInCubic)(t);     // correct → killed, falls
    const slash=interp([1.3,1.42,1.7],[0,1,0])(t);
    const rx=lerp(xs[0], xs[target], sweep);

    xs.forEach((x,i)=>{
      const isT=i===target;
      // backlight
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.2;
      c.fillStyle=radial(c,x,660,210,[[0,'rgba(255,90,60,0.4)'],[1,'rgba(255,90,60,0)']]); c.fillRect(x-240,360,480,560); c.restore();
      if(isT && kill>0.02){
        // target falls when killed
        c.save(); c.globalAlpha=clamp(1-kill*0.9,0,1); c.translate(0,kill*40);
        c.translate(x,base); c.rotate(kill*0.5); c.translate(-x,-base);
        figure(c,{x,base,s:0.66,fill:FIG}); c.restore();
      } else {
        figure(c,{x,base,s:0.66,fill:FIG});
      }
      // the confirmed Virtue Seeker glows blue with a seeker emblem
      if(isT && confirm>0.02 && kill<0.5){
        c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(confirm,0,1)*0.8;
        c.fillStyle=radial(c,x,base-200,200,[[0,'rgba(125,180,255,0.6)'],[1,'rgba(125,180,255,0)']]); c.fillRect(x-220,base-420,440,440); c.restore();
        const ey=base-440-clamp(confirm,0,1)*8;
        c.save(); c.translate(x,ey); c.scale(clamp(confirm,0,1),clamp(confirm,0,1));
        c.strokeStyle=V.soft; c.lineWidth=5; c.shadowColor=V.glow; c.shadowBlur=14;
        c.beginPath(); c.arc(0,0,24,0,Math.PI*2); c.stroke();
        c.fillStyle=V.glow; c.beginPath(); c.arc(0,0,9,0,Math.PI*2); c.fill();
        c.restore();
      }
    });

    // reticle
    if(t<1.6){
      const ry=base-320, R=clamp(lerp(120,86,lock),70,130), a=t*3;
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(0.5+lock*0.5,0,1);
      c.translate(rx,ry); c.rotate(a*0.3);
      c.strokeStyle=lock>0.5?'#ff5a3c':'#ff8a6a'; c.lineWidth=4; c.shadowColor=P.glow; c.shadowBlur=16;
      c.beginPath(); c.arc(0,0,R,0,Math.PI*2); c.stroke();
      for(let i=0;i<4;i++){ const aa=i/4*6.283; c.beginPath(); c.moveTo(Math.cos(aa)*(R-16),Math.sin(aa)*(R-16)); c.lineTo(Math.cos(aa)*(R+16),Math.sin(aa)*(R+16)); c.stroke(); }
      c.restore();
    }

    // red kill slash on the confirmed target
    if(slash>0.01){
      const ix=xs[target], iy=base-330;
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=slash;
      c.strokeStyle='#ff6a4a'; c.lineWidth=10; c.shadowColor=P.glow; c.shadowBlur=26;
      c.beginPath(); c.moveTo(ix-150,iy-120); c.lineTo(ix+150,iy+120); c.stroke();
      c.strokeStyle='#fff'; c.lineWidth=4; c.beginPath(); c.moveTo(ix-150,iy-120); c.lineTo(ix+150,iy+120); c.stroke();
      c.restore();
    }
    ring(c,xs[target],base-330,interp([1.4,1.85],[0,1])(t),P.glow,40,360);
    grade(c,'vice',0.32);
  },
};

export default clip;
