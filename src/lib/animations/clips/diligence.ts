// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Diligence Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "diligence",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,grade,ring,motes,CAMP,FIG}=AB;
    const P=CAMP.virtue;
    c.fillStyle=radial(c,960,480,1180,[[0,P.bg0],[1,P.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(125,180,255,0.5)',12);

    const lx=960, w=560, rows=4, py=300, rh=120;
    // ledger / scroll
    c.save();
    c.fillStyle='#ece2c4'; c.beginPath(); c.roundRect(lx-w/2,py-40,w,rows*rh+70,16); c.fill();
    c.fillStyle='#c9b78a'; c.fillRect(lx-w/2,py-40,w,12); c.fillRect(lx-w/2,py+rows*rh+18,w,12);
    c.restore();

    // steady blue glow border that never breaks (the passive)
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.5+0.15*Math.sin(t*4);
    c.strokeStyle=P.glow; c.lineWidth=5; c.shadowColor=P.glow; c.shadowBlur=20;
    c.beginPath(); c.roundRect(lx-w/2-6,py-46,w+12,rows*rh+82,18); c.stroke(); c.restore();

    const prog=interp([0.3,1.45],[0,1])(t);
    const wrongRow=2;
    for(let i=0;i<rows;i++){
      const ry=py+i*rh+rh/2-20;
      // name bar
      c.fillStyle='rgba(40,30,16,0.18)'; c.fillRect(lx-w/2+110,ry-2,w-220,18);
      c.fillStyle='rgba(40,30,16,0.12)'; c.fillRect(lx-w/2+110,ry+26,w-300,12);
      // mark appears as the quill passes this row
      const m=clamp((prog - i/rows)*rows,0,1);
      if(m>0.05){
        c.save(); c.translate(lx-w/2+62, ry+12); c.scale(clamp(m,0,1),clamp(m,0,1));
        if(i===wrongRow){ // a wrong guess — X, but the ledger holds
          c.strokeStyle='#b8001c'; c.lineWidth=8; c.lineCap='round'; c.shadowColor='#ff5a3c'; c.shadowBlur=10;
          c.beginPath(); c.moveTo(-18,-18); c.lineTo(18,18); c.moveTo(18,-18); c.lineTo(-18,18); c.stroke();
        } else { // a correct tick
          c.strokeStyle=P.deep; c.lineWidth=9; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=10;
          c.beginPath(); c.moveTo(-20,2); c.lineTo(-4,20); c.lineTo(22,-18); c.stroke();
        }
        c.restore();
      }
    }

    // the quill, moving steadily down the ledger
    const qy=py+clamp(prog,0,1)*(rows*rh)-20, qx=lx+w/2-90;
    c.save(); c.translate(qx,qy); c.rotate(-0.5);
    c.strokeStyle='#dfe9ff'; c.lineWidth=5; c.lineCap='round'; c.shadowColor=P.glow; c.shadowBlur=10;
    c.beginPath(); c.moveTo(0,0); c.lineTo(44,-128); c.stroke();
    c.lineWidth=2.4; for(let k=1;k<10;k++){ const px=k*4.2, pyy=-k*12.4; c.beginPath(); c.moveTo(px,pyy); c.lineTo(px-15,pyy-2); c.moveTo(px,pyy); c.lineTo(px+11,pyy-7); c.stroke(); }
    c.fillStyle='#bcd6ff'; c.beginPath(); c.moveTo(0,0); c.lineTo(-7,-12); c.lineTo(5,-7); c.closePath(); c.fill();
    c.restore();

    grade(c,'virtue',0.32);
  },
};

export default clip;
