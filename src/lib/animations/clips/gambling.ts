// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Gambling Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "gambling",
  bg: "#0c0406",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,grade,ring,motes,CAMP}=AB;
    const P=CAMP.vice;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(255,120,90,0.5)',12);
    const cx=960, cy=520, sz=170;

    // tumble + settle
    const drop=interp([0.1,0.95],[0,1],E.easeOutCubic)(t);
    const bounce=Math.abs(Math.sin(drop*Math.PI*1.5))*(1-drop)*120;
    const y=lerp(120,cy,drop) - bounce;
    const rot=lerp(0,Math.PI*3.2,drop)*(1-drop)+0.0; // spins, slows to 0
    const locked=t>1.5;
    const face = locked ? 6 : 1+Math.floor((t*26)%6);

    // result glow once locked
    const gl=interp([1.5,1.75],[0,1],E.easeOutBack)(t);
    if(gl>0.01){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(gl,0,1)*0.7;
      c.fillStyle=radial(c,cx,cy,360,[[0,'rgba(255,90,60,0.6)'],[1,'rgba(255,90,60,0)']]); c.fillRect(cx-400,cy-400,800,800); c.restore(); }

    // shadow on the floor
    c.save(); c.globalAlpha=0.4*drop; c.fillStyle='#000'; c.beginPath(); c.ellipse(cx,cy+sz*0.7,sz*0.7,sz*0.16,0,0,Math.PI*2); c.fill(); c.restore();

    // the die
    c.save(); c.translate(cx,y); c.rotate(rot);
    c.fillStyle='#efe6cc'; c.shadowColor='rgba(0,0,0,0.5)'; c.shadowBlur=24; c.shadowOffsetY=10;
    c.beginPath(); c.roundRect(-sz/2,-sz/2,sz,sz,26); c.fill(); c.shadowBlur=0; c.shadowOffsetY=0;
    // bevel
    c.strokeStyle='rgba(120,90,60,0.5)'; c.lineWidth=4; c.beginPath(); c.roundRect(-sz/2+8,-sz/2+8,sz-16,sz-16,20); c.stroke();
    // pips
    const o=sz*0.26, r=sz*0.082;
    const PIP={1:[[0,0]],2:[[-1,-1],[1,1]],3:[[-1,-1],[0,0],[1,1]],4:[[-1,-1],[1,-1],[-1,1],[1,1]],5:[[-1,-1],[1,-1],[0,0],[-1,1],[1,1]],6:[[-1,-1],[1,-1],[-1,0],[1,0],[-1,1],[1,1]]};
    c.fillStyle = locked ? P.deep : '#2a1410';
    (PIP[face]||[]).forEach(([dx,dy])=>{ c.beginPath(); c.arc(dx*o,dy*o,r,0,Math.PI*2); c.fill(); });
    c.restore();

    ring(c,cx,cy,interp([1.55,1.9],[0,1])(t),P.glow,50,420);
    grade(c,'vice',0.3);
  },
};

export default clip;
