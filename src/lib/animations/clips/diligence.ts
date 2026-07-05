// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Diligence Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// The scribe works at the lectern, quill ticking checks down the ledger; a
// red X lands against them — but the steady blue glow holds.
const clip: ClipConfig = {
  name: "diligence",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  video: "/animations/diligence.mp4",
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow}=AB.RIG;
  const P=AB.CAMP.virtue;
  const G=940, sx=760, lx=1160;

  stage(c,t,'virtue');

  // ── lectern + ledger ──
  const bookX=lx, bookY=560;
  c.save();
  // pedestal
  c.fillStyle='#241a2c'; c.beginPath();
  c.moveTo(lx-34,G); c.lineTo(lx-22,640); c.lineTo(lx+22,640); c.lineTo(lx+34,G); c.closePath(); c.fill();
  c.fillStyle='#2e2238'; c.beginPath();
  c.moveTo(lx-130,640); c.lineTo(lx+130,600); c.lineTo(lx+140,660); c.lineTo(lx-120,704); c.closePath(); c.fill();
  // the open ledger
  c.save(); c.translate(bookX,bookY+70); c.rotate(-0.12);
  c.fillStyle='#ece2c4'; c.beginPath(); c.roundRect(-150,-96,150,180,8); c.fill();
  c.fillStyle='#e2d5b0'; c.beginPath(); c.roundRect(0,-96,150,180,8); c.fill();
  c.fillStyle='#3a2a4a'; c.fillRect(-4,-96,8,180);
  c.restore();
  c.restore();

  // rows + progressive checks
  const write=interp([0.25,1.2],[0,1],E.linear)(t);
  const rows=4;
  const rowPos=i=>{ // world position of row i on the right page
    const bx=bookX, by=bookY+70;
    const rx=bx+26+ Math.cos(-0.12)*0, ry=by-70+i*40;
    return [bx+30 - (i*5), ry];
  };
  for(let i=0;i<rows;i++){
    const [rx,ry]=rowPos(i);
    c.save(); c.globalAlpha=0.55; c.fillStyle='#6a5a3a';
    c.fillRect(rx,ry-4,84,6); c.restore();
    const cp=clamp((write - i*0.22)/0.14,0,1);
    if(cp>0.01){
      c.save(); c.globalAlpha=cp; c.strokeStyle='#2a6fdb'; c.lineWidth=5; c.lineCap='round';
      c.shadowColor=P.glow; c.shadowBlur=10;
      c.beginPath(); c.moveTo(rx+96,ry); c.lineTo(rx+104,ry+9*cp); c.lineTo(rx+120,ry-10*cp); c.stroke();
      c.restore();
    }
  }
  // the red X strikes the third row — but the glow holds
  const xMark=interp([1.3,1.5],[0,1],E.easeOutBack)(t);
  if(xMark>0.01){
    const [rx,ry]=rowPos(4*0+3);
    c.save(); c.globalAlpha=clamp(xMark,0,1); c.strokeStyle='#ff5a3c'; c.lineWidth=6; c.lineCap='round';
    c.shadowColor='#ff5a3c'; c.shadowBlur=14; const s=clamp(xMark,0,1)*14;
    c.beginPath(); c.moveTo(rx+40-s,ry-s); c.lineTo(rx+40+s,ry+s);
    c.moveTo(rx+40+s,ry-s); c.lineTo(rx+40-s,ry+s); c.stroke(); c.restore();
  }
  const hold=interp([1.5,1.85],[0,1],E.easeOutCubic)(t);
  if(hold>0.01){ // the steady blue ward over the ledger
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=hold*(0.6+0.14*Math.sin(t*7));
    c.fillStyle=radial(c,bookX,bookY+40,260,[[0,'rgba(125,180,255,0.5)'],[1,'rgba(125,180,255,0)']]);
    c.fillRect(bookX-280,bookY-240,560,560); c.restore();
    AB.ring(c,bookX,bookY+40,interp([1.55,1.95],[0,1])(t),P.glow,50,340);
  }

  // ── the scribe: bowed over the page, quill hand ticking row to row ──
  const rowIdx=clamp(Math.floor(write*4.4),0,3);
  const rowFrac=clamp(write*4.4-rowIdx,0,1);
  const dip=Math.sin(rowFrac*Math.PI)*14;
  const qTarget=[ 226 - rowIdx*4, -240 + rowIdx*22 + dip*0.4 ];
  shadow(c, sx, G+6, 130, 0.5);
  const A=rig(c,{ x:sx, ground:G, s:1.0, facing:1, pal:'virtue',
    lean: 0.2, bow: 0.34 + Math.sin(t*2.4)*0.02,
    handF: qTarget, bendF:1,
    handB:[ 120, -140 ], bendB:1,     // steadying the lectern
    footF:[ 36, 186 ], footB:[ -32, 186 ],
    cape:0.5, capeSway:0.02, skirt:0.85,
    eyes:0.5, eyeCol:'#bcd6ff', rim:0.85 });
  // the quill
  const qa=-0.9 - dip*0.012;
  c.save(); c.translate(A.handF[0],A.handF[1]); c.rotate(qa);
  c.strokeStyle='#d8cba6'; c.lineWidth=4; c.lineCap='round';
  c.beginPath(); c.moveTo(0,0); c.lineTo(0,-52); c.stroke();
  c.fillStyle='#e8e0cf'; c.beginPath();
  c.moveTo(0,-30); c.quadraticCurveTo(20,-64,6,-96); c.quadraticCurveTo(-4,-70,-6,-40); c.closePath(); c.fill();
  c.fillStyle='#33202a'; c.beginPath(); c.moveTo(-2,4); c.lineTo(2,4); c.lineTo(0,12); c.closePath(); c.fill();
  c.restore();
  // ink sparkle at the nib while writing
  if(write>0.02 && write<1){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.6+0.3*Math.sin(t*12);
    c.fillStyle=P.soft; c.beginPath(); c.arc(A.handF[0]+Math.sin(qa)*12,A.handF[1]+12,3,0,Math.PI*2); c.fill();
    c.restore();
  }
  // candle on the lectern
  (function candle(){
    const cxx=lx-100, cyy=636;
    c.fillStyle='#e8e0cf'; c.fillRect(cxx-7,cyy-40,14,40);
    const fl=0.8+0.2*Math.sin(t*16)*Math.sin(t*5);
    c.save(); c.globalCompositeOperation='screen';
    c.fillStyle=radial(c,cxx,cyy-52,90,[[0,'rgba(255,196,108,0.6)'],[1,'rgba(255,196,108,0)']]);
    c.globalAlpha=fl; c.fillRect(cxx-100,cyy-152,200,200);
    c.fillStyle=radial(c,cxx,cyy-50,16,[[0,'#fff3c0'],[0.5,'#ffb347'],[1,'rgba(255,120,40,0)']]);
    c.beginPath(); c.ellipse(cxx,cyy-50,8,14,0,0,Math.PI*2); c.fill(); c.restore();
  })();

  AB.motes(c,t,'rgba(125,180,255,0.6)',12);
  AB.grade(c,'virtue',0.33);
  },
};

export default clip;
