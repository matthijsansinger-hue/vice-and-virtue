// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Wandering Soul Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "wandering_soul",
  bg: "#05100f",
  poster: 1.6,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/wandering_soul.mp4",
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,grade,ring,motes,CAMP,frac}=AB;
    const P=CAMP.neutral;
    // castle-interior void
    c.fillStyle=radial(c,960,360,1180,[[0,'#10302c'],[0.5,'#0a1c1c'],[1,'#040d0c']]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(160,255,240,0.6)',18);

    const cx=960;
    const rise=interp([0.2,1.4],[0,1],E.easeInOutQuad)(t);
    const escape=interp([1.25,1.85],[0,1],E.easeOutCubic)(t);
    const y=lerp(940,300,rise);
    const alpha=clamp(1-escape,0,1);

    // rift of light above, brightening as the soul nears
    const rift=interp([0.4,1.5],[0,1],E.easeOutCubic)(t);
    c.save(); c.globalCompositeOperation='screen';
    c.globalAlpha=clamp(rift,0,1)*(0.6+0.2*Math.sin(t*5));
    c.fillStyle=radial(c,cx,150,360*(0.5+rift),[[0,'rgba(216,255,246,0.9)'],[0.4,'rgba(127,233,214,0.4)'],[1,'rgba(127,233,214,0)']]);
    c.fillRect(cx-420,-60,840,520);
    // descending light shaft
    c.globalAlpha=clamp(rift,0,1)*0.4;
    const grd=c.createLinearGradient(cx,120,cx,760); grd.addColorStop(0,'rgba(216,255,246,0.5)'); grd.addColorStop(1,'rgba(127,233,214,0)');
    c.fillStyle=grd; c.beginPath(); c.moveTo(cx-70,140); c.lineTo(cx+70,140); c.lineTo(cx+200,820); c.lineTo(cx-200,820); c.closePath(); c.fill();
    c.restore();

    // the wandering soul — a translucent wisp rising
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=alpha;
    // aura
    c.fillStyle=radial(c,cx,y-40,200,[[0,'rgba(160,255,240,0.5)'],[1,'rgba(127,233,214,0)']]); c.fillRect(cx-220,y-240,440,440);
    // body: head + robe tapering into a wavy tail
    c.fillStyle='rgba(180,255,242,0.55)'; c.shadowColor=P.glow; c.shadowBlur=30;
    c.beginPath();
    c.arc(cx,y-150,46,Math.PI,0,false);                 // head top
    c.quadraticCurveTo(cx+70,y-60,cx+60,y+40);           // right shoulder/body
    const wob=Math.sin(t*4)*16;
    c.quadraticCurveTo(cx+40,y+120,cx+wob,y+170);        // tail right
    c.quadraticCurveTo(cx-40+wob,y+120,cx-60,y+40);      // tail left
    c.quadraticCurveTo(cx-70,y-60,cx-46,y-150);          // left shoulder
    c.closePath(); c.fill();
    // hollow eyes
    c.globalCompositeOperation='source-over'; c.globalAlpha=alpha*0.8; c.fillStyle='#06201e';
    c.beginPath(); c.ellipse(cx-16,y-150,8,12,0,0,Math.PI*2); c.ellipse(cx+16,y-150,8,12,0,0,Math.PI*2); c.fill();
    c.restore();

    // dissolving sparkles as it escapes into the light
    if(escape>0.02){
      c.save(); c.globalCompositeOperation='screen';
      for(let i=0;i<20;i++){ const lp=clamp(escape - (i%6)*0.05,0,1); const a2=(i*53%100)/100*6.283;
        const r=lp*240; const x=cx+Math.cos(a2)*r*0.7, yy=y - lp*200 + Math.sin(a2)*r*0.4;
        c.globalAlpha=(1-lp)*0.8; c.fillStyle='#d8fff6'; c.beginPath(); c.arc(x,yy,2.6,0,Math.PI*2); c.fill(); }
      c.restore();
    }
    ring(c,cx,180,interp([1.45,1.9],[0,1])(t),P.glow,40,440);

    // teal grade + vignette
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.3;
    c.fillStyle=radial(c,cx,360,1000,[[0,P.key],[1,'rgba(0,0,0,0)']]); c.fillRect(0,0,1920,1080); c.restore();
    c.fillStyle=radial(c,cx,500,1240,[[0.44,'rgba(0,0,0,0)'],[1,'rgba(2,8,7,0.9)']]); c.fillRect(0,0,1920,1080);
  },
};

export default clip;
