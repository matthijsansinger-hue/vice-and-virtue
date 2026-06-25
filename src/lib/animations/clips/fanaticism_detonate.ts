// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Detonate Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "fanaticism_detonate",
  bg: "#0c0406",
  poster: 1.0,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG,frac}=AB;
    const P=CAMP.vice;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(255,120,90,0.5)',12);
    const cx=960, base=940;

    const boom=interp([0.92,1.25],[0,1],E.easeOutCubic)(t);
    const burn = clamp(1 - t/0.9, 0, 1); // fuse burns down over first ~0.9s

    // backlight + the holder figure (vanishes in the blast)
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.26;
    c.fillStyle=radial(c,cx,660,340,[[0,'rgba(255,90,60,0.45)'],[1,'rgba(255,90,60,0)']]); c.fillRect(cx-380,300,760,640); c.restore();
    if(boom<0.5) figure(c,{x:cx,base,s:0.95,fill:FIG,alpha:clamp(1-boom*2,0,1)});

    // the held bomb with a burning, shortening fuse
    if(boom<0.4){
      const bx=cx, by=base-300;
      c.save(); c.translate(bx,by);
      c.fillStyle='#0a0608'; c.beginPath(); c.arc(0,0,46,0,Math.PI*2); c.fill();
      c.fillStyle='#241015'; c.beginPath(); c.arc(-14,-14,18,0,Math.PI*2); c.fill();
      c.fillStyle='#1a0e10'; c.fillRect(-14,-58,28,16);
      c.restore();
      const fx=bx, fy=by-58;
      c.save(); c.strokeStyle='#5a4226'; c.lineWidth=5; c.lineCap='round';
      c.beginPath(); c.moveTo(fx,fy); c.quadraticCurveTo(fx+20,fy-34,fx+10,fy-58*burn-8); c.stroke(); c.restore();
      const sx=fx+10, sy=fy-58*burn-8;
      c.save(); c.globalCompositeOperation='screen';
      c.fillStyle=radial(c,sx,sy,34,[[0,'#fff'],[0.4,'#ffb347'],[1,'rgba(255,120,40,0)']]); c.beginPath(); c.arc(sx,sy,28,0,Math.PI*2); c.fill();
      for(let i=0;i<7;i++){ const a=frac(t*4+i*0.14)*6.28; const r=12+frac(t*3+i)*26; c.globalAlpha=(1-frac(t*3+i))*0.85; c.fillStyle='#ffd27a'; c.beginPath(); c.arc(sx+Math.cos(a)*r,sy+Math.sin(a)*r,2.6,0,Math.PI*2); c.fill(); }
      c.restore();
    }

    // detonation
    if(boom>0){
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=interp([0.92,1.05,1.5],[0,1,0.25])(t);
      c.fillStyle=radial(c,cx,base-300,lerp(90,760,boom),[[0,'#fff'],[0.3,'#ff8a4a'],[0.6,'#b8001c'],[1,'rgba(184,0,28,0)']]); c.fillRect(0,0,1920,1080); c.restore();
      ring(c,cx,base-300,boom,P.glow,20,640);
      ring(c,cx,base-300,interp([1.05,1.5],[0,1])(t),'#ffd27a',12,520);
      // flying debris
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-boom)*0.9; c.strokeStyle='#ffae6a'; c.lineWidth=4; c.shadowColor=P.glow; c.shadowBlur=16;
      for(let i=0;i<12;i++){ const a=(i/12)*6.283; const r0=60+boom*120, r1=120+boom*420; c.beginPath(); c.moveTo(cx+Math.cos(a)*r0,base-300+Math.sin(a)*r0); c.lineTo(cx+Math.cos(a)*r1,base-300+Math.sin(a)*r1); c.stroke(); }
      c.restore();
    }
    grade(c,'vice',0.3);
  },
};

export default clip;
