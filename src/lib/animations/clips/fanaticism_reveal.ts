// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Reveal Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "fanaticism_reveal",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG}=AB;
    const P=CAMP.vice;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(255,120,90,0.5)',12);
    const base=940, xs=[520,760,1000,1240,1480], carrier=2;

    // a sweeping scan beam passes across the line-up
    const scan=interp([0.25,1.05],[0,1],E.easeInOutQuad)(t);
    const beamX=lerp(420,1560,scan);
    const found=interp([1.0,1.45],[0,1],E.easeOutBack)(t);

    xs.forEach((x,i)=>{
      const isC=i===carrier;
      const revealed = isC && found>0.02;
      // backlight
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.2;
      c.fillStyle=radial(c,x,660,220,[[0,'rgba(255,90,60,0.4)'],[1,'rgba(255,90,60,0)']]); c.fillRect(x-240,360,480,560); c.restore();
      figure(c,{x,base,s:0.62,fill:FIG});
      // carrier lights up red when found
      if(revealed){
        c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(found,0,1);
        c.fillStyle=radial(c,x,base-200,220,[[0,'rgba(255,90,60,0.6)'],[1,'rgba(255,90,60,0)']]); c.fillRect(x-240,base-440,480,440); c.restore();
        c.save(); c.globalAlpha=clamp(found,0,1)*0.9; c.lineWidth=3; c.strokeStyle='#ff8a6a'; c.shadowColor=P.glow; c.shadowBlur=14;
        c.beginPath(); c.arc(x,base-330,28,0,Math.PI*2); c.stroke(); c.restore();
        // bomb icon floating above the carrier
        const by=base-440-clamp(found,0,1)*10;
        c.save(); c.translate(x,by); c.scale(clamp(found,0,1),clamp(found,0,1));
        c.fillStyle='#0a0608'; c.beginPath(); c.arc(0,0,30,0,Math.PI*2); c.fill();
        c.fillStyle='#1a0e10'; c.fillRect(-9,-40,18,12);
        c.save(); c.globalCompositeOperation='screen'; c.fillStyle='#ffb347'; c.shadowColor='#ffb347'; c.shadowBlur=12; c.beginPath(); c.arc(6,-44,6,0,Math.PI*2); c.fill(); c.restore();
        c.restore();
      }
    });

    // the scan beam itself
    if(scan>0.01 && scan<1){
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.5;
      const g=c.createLinearGradient(beamX-60,0,beamX+60,0); g.addColorStop(0,'rgba(255,90,60,0)'); g.addColorStop(0.5,'rgba(255,140,90,0.7)'); g.addColorStop(1,'rgba(255,90,60,0)');
      c.fillStyle=g; c.fillRect(beamX-60,120,120,820);
      c.restore();
    }
    ring(c,xs[carrier],base-330,interp([1.4,1.9],[0,1])(t),P.glow,40,300);
    grade(c,'vice',0.32);
  },
};

export default clip;
