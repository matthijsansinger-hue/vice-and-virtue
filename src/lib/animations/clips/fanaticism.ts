// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "fanaticism",
  bg: "#0c0406",
  poster: 1.4,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG,frac}=AB;
    const P=CAMP.vice;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(255,120,90,0.5)',12);
    const Lx=650, Rx=1270, base=940;

    // soft backlight so each silhouette reads against the dark
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.28;
    c.fillStyle=radial(c,Lx,660,320,[[0,'rgba(255,90,60,0.45)'],[1,'rgba(255,90,60,0)']]); c.fillRect(Lx-360,300,720,640);
    c.fillStyle=radial(c,Rx,660,320,[[0,'rgba(255,90,60,0.4)'],[1,'rgba(255,90,60,0)']]); c.fillRect(Rx-360,300,720,640);
    c.restore();

    figure(c,{x:Lx,base,s:0.9,fill:FIG});
    figure(c,{x:Rx,base,s:0.9,fill:FIG});

    // bomb passes hand-to-hand
    const pass=interp([0.3,1.1],[0,1],E.easeInOutQuad)(t);
    const boom=interp([1.55,1.8],[0,1],E.easeOutCubic)(t);
    const bx=lerp(Lx+96,Rx-96,pass), by=lerp(560,560,pass)-Math.sin(pass*Math.PI)*170;

    if(boom<0.4){
      // bomb body
      c.save(); c.translate(bx,by);
      c.fillStyle='#0a0608'; c.beginPath(); c.arc(0,0,42,0,Math.PI*2); c.fill();
      c.fillStyle='#241015'; c.beginPath(); c.arc(-12,-12,16,0,Math.PI*2); c.fill();
      // cap
      c.fillStyle='#1a0e10'; c.fillRect(-12,-54,24,16);
      c.restore();
      // fuse + travelling spark
      const burn = t>1.0 ? clamp(1-(t-1.0)/0.55,0,1) : 1;
      const fx=bx, fy=by-54;
      c.save(); c.strokeStyle='#5a4226'; c.lineWidth=4; c.lineCap='round';
      c.beginPath(); c.moveTo(fx,fy); c.quadraticCurveTo(fx+18,fy-30, fx+8,fy-50*burn-6); c.stroke(); c.restore();
      // spark
      const sx=fx+8, sy=fy-50*burn-6;
      c.save(); c.globalCompositeOperation='screen';
      c.fillStyle=radial(c,sx,sy,30,[[0,'#fff'],[0.4,'#ffb347'],[1,'rgba(255,120,40,0)']]); c.beginPath(); c.arc(sx,sy,26,0,Math.PI*2); c.fill();
      for(let i=0;i<6;i++){ const a=frac(t*3+i*0.17)*6.28; const r=10+frac(t*2+i)*22; c.globalAlpha=(1-frac(t*2+i))*0.8; c.fillStyle='#ffd27a'; c.beginPath(); c.arc(sx+Math.cos(a)*r,sy+Math.sin(a)*r,2.4,0,Math.PI*2); c.fill(); }
      c.restore();
    }

    // detonation
    if(boom>0){
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=interp([1.55,1.7,1.9],[0,1,0.3])(t);
      c.fillStyle=radial(c,Rx-96,540,lerp(80,520,boom),[[0,'#fff'],[0.3,'#ff8a4a'],[1,'rgba(184,0,28,0)']]); c.fillRect(0,0,1920,1080); c.restore();
      ring(c,Rx-96,540,boom,P.glow,18,480);
    }
    grade(c,'vice',0.32);
  },
};

export default clip;
