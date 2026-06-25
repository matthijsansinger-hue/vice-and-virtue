// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Truthfulness Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "truthfulness",
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

    figure(c,{x:cx,base,s:0.95,fill:FIG});

    // prison bars over the jailed figure
    c.save(); c.strokeStyle='#8b97a4'; c.lineWidth=14; c.lineCap='round'; c.shadowColor='rgba(0,0,0,0.5)'; c.shadowBlur=6;
    for(let x=cx-180;x<=cx+180;x+=72){ c.beginPath(); c.moveTo(x,320); c.lineTo(x,base-8); c.stroke(); }
    c.lineWidth=12; [368,860].forEach(y=>{ c.beginPath(); c.moveTo(cx-200,y); c.lineTo(cx+200,y); c.stroke(); }); c.restore();

    // voters around the cell; glowing beams trace from each to the jailed figure
    const beam=interp([0.55,1.45],[0,1],E.easeOutCubic)(t);
    const voters=[[430,560],[540,830],[1390,540],[1470,820],[680,300],[1250,310]];
    voters.forEach(([vx,vy],i)=>{
      const lp=clamp((beam - i*0.07)/0.5,0,1); if(lp<=0) return;
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=lp; c.strokeStyle=P.glow; c.lineWidth=3; c.shadowColor=P.glow; c.shadowBlur=14;
      const ex=lerp(vx,cx,lp*0.9), ey=lerp(vy,540,lp*0.9);
      c.beginPath(); c.moveTo(vx,vy); c.lineTo(ex,ey); c.stroke();
      // moving pip along the beam
      c.fillStyle='#fff'; c.beginPath(); c.arc(ex,ey,5,0,Math.PI*2); c.fill();
      // voter avatar dot
      c.globalCompositeOperation='source-over'; c.fillStyle=FIG; c.beginPath(); c.arc(vx,vy,18,0,Math.PI*2); c.fill();
      c.fillStyle=P.soft; c.beginPath(); c.arc(vx,vy-4,9,0,Math.PI*2); c.fill();
      c.restore();
    });

    // an unfurling scroll/ledger beneath, listing the exposed votes
    const scroll=interp([0.3,0.9],[0,1],E.easeOutCubic)(t);
    if(scroll>0.01){
      const sw=lerp(80,420,clamp(scroll,0,1)), sh=120, sx=cx, sy=base+18;
      c.save(); c.globalAlpha=clamp(scroll,0,1);
      c.fillStyle='#ece2c4'; c.beginPath(); c.roundRect(sx-sw/2,sy-sh/2,sw,sh,10); c.fill();
      c.fillStyle='#c9b78a'; c.fillRect(sx-sw/2,sy-sh/2,sw,8); c.fillRect(sx-sw/2,sy+sh/2-8,sw,8);
      if(scroll>0.6){ c.globalAlpha=(scroll-0.6)/0.4; c.fillStyle='rgba(40,30,16,0.6)';
        for(let r=0;r<3;r++){ c.fillRect(sx-sw/2+30,sy-30+r*28,sw-120,8); } }
      c.restore();
    }
    ring(c,cx,540,interp([1.4,1.9],[0,1])(t),P.glow,60,440);
    grade(c,'virtue',0.34);
  },
};

export default clip;
