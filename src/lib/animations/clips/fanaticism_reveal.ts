// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Fanaticism Reveal Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// A scan beam sweeps the line-up; when it crosses the carrier they flinch
// and light up red — the bomb hovering exposed above their head.
const clip: ClipConfig = {
  name: "fanaticism_reveal",
  bg: "#0c0406",
  poster: 1.6,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,bomb}=AB.RIG;
  const P=AB.CAMP.vice;
  const G=955, xs=[420,690,960,1230,1500], carrier=2;

  stage(c,t,'vice',{floorY:955});

  const scan=interp([0.2,1.0],[0,1],E.easeInOutQuad)(t);
  const beamX=lerp(330,1590,scan);
  const found=interp([0.95,1.35],[0,1],E.easeOutBack)(t);

  xs.forEach((x,i)=>{
    const isC=i===carrier;
    const s=0.72;
    const lit = clamp(1-Math.abs(beamX-x)/160,0,1)*(scan<1?1:0);
    const flinch = isC? found : 0;
    shadow(c, x, G+5, 95, 0.4);
    rig(c,{ x, ground:G, s, facing: i<2?1:(i>2?-1:1), pal: isC&&found>0.3?'vice':'shade',
      lean: Math.sin(t*1.8+i*1.7)*0.02 - flinch*0.14,
      bow: 0.04 + flinch*0.2,
      handF: flinch>0.1? [ 60, -190 ] : null, relaxF: flinch<=0.1, bendF:-1,
      relaxB:true,
      footF:[ 26, 186 ], footB:[ -24, 186 ],
      cape:0.45, skirt:0.75,
      eyes: 0.25+lit*0.5+(isC?found*0.5:0), eyeCol: isC&&found>0.3?'#ff5a3c':'#ffd7b0',
      rim: 0.5+lit*0.5 });
    // scan spotlight on whoever the beam crosses
    if(lit>0.02){
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=lit*0.35;
      c.fillStyle=radial(c,x,G-260,240,[[0,'rgba(255,140,90,0.6)'],[1,'rgba(255,140,90,0)']]);
      c.fillRect(x-260,G-520,520,540); c.restore();
    }
    // the carrier revealed
    if(isC && found>0.02){
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(found,0,1)*0.8;
      c.fillStyle=radial(c,x,G-240,260,[[0,'rgba(255,90,60,0.6)'],[1,'rgba(255,90,60,0)']]);
      c.fillRect(x-280,G-520,560,560); c.restore();
      const by=G-540-clamp(found,0,1)*14 + Math.sin(t*3)*6;
      c.save(); const sc=clamp(found,0,1); c.translate(x,by); c.scale(sc,sc); c.translate(-x,-by);
      bomb(c, x, by, 30, t, 0.8);
      c.restore();
      AB.ring(c,x,G-300,interp([1.3,1.85],[0,1])(t),P.glow,50,340);
    }
  });

  // the sweeping scan beam
  if(scan>0.005 && scan<0.995){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.6;
    const g=c.createLinearGradient(beamX-70,0,beamX+70,0);
    g.addColorStop(0,'rgba(255,90,60,0)'); g.addColorStop(0.5,'rgba(255,150,100,0.75)'); g.addColorStop(1,'rgba(255,90,60,0)');
    c.fillStyle=g; c.fillRect(beamX-70,110,140,860);
    // beam source glint at top
    c.fillStyle=radial(c,beamX,110,60,[[0,'#fff'],[0.4,'rgba(255,170,110,0.7)'],[1,'rgba(255,170,110,0)']]);
    c.beginPath(); c.arc(beamX,110,56,0,Math.PI*2); c.fill();
    c.restore();
  }
  AB.motes(c,t,'rgba(255,120,90,0.5)',12);
  AB.grade(c,'vice',0.32);
  },
};

export default clip;
