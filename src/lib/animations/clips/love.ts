// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Love Ability - Video Export.html"
// (2026 rig rework — articulated AB.RIG characters on the torch-lit stage).
import type { ClipConfig } from "../engine";

// A radiant heart blooms above a hunched vice follower; bathed in its light
// they unclench, lift their head, and turn to virtue.
const clip: ClipConfig = {
  name: "love",
  bg: "#050818",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {

  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,heart}=AB.RIG;
  const P=AB.CAMP.virtue;
  const G=940, cx=960;

  stage(c,t,'virtue');

  const bloom=interp([0.25,0.85],[0,1],E.easeOutBack)(t);
  const wash=interp([0.6,1.0],[0,1],E.easeOutCubic)(t);
  const morph=interp([0.8,1.45],[0,1],E.easeInOutQuad)(t);

  // shared pose: hunched + fists → open, head lifted to the light
  const open=morph;
  const pose={
    x:cx, ground:G, s:1.0, facing:1,
    lean: 0.22*(1-open) - 0.04*open,
    bow: 0.5*(1-open) - 0.28*open,
    handF:[ lerp(20,96,open), lerp(-58,-190,open) ], bendF: open>0.5?-1:1,
    handB:[ lerp(-16,-84,open), lerp(-52,-178,open) ], bendB: open>0.5?1:-1,
    footF:[ 30, 186 ], footB:[ -26, 186 ],
    hipH: 186-14*(1-open),
    cape:0.55, capeSway: Math.sin(t*2)*0.04,
    skirt:0.8, rim:0.85,
  };
  shadow(c, cx, G+6, 140, 0.5);
  rig(c,{ ...pose, pal:'vice', eyes:0.4*(1-morph), eyeCol:'#ff8a6a' });
  if(morph>0.01){
    c.save(); c.globalAlpha=clamp(morph,0,1);
    rig(c,{ ...pose, pal:'virtue', eyes:morph, eyeCol:'#bcd6ff' });
    c.restore();
  }

  // the blooming heart
  const hy=380, hs=72*clamp(bloom,0,1.05);
  if(bloom>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(bloom,0,1);
    c.fillStyle=radial(c,cx,hy,280,[[0,'rgba(140,190,255,0.55)'],[1,'rgba(140,190,255,0)']]); c.fillRect(cx-320,hy-280,640,680);
    c.restore();
    heart(c, cx, hy, hs, P.soft, P.glow);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(bloom,0,1)*0.5;
    heart(c, cx, hy, hs*0.5, '#ffffff', '#fff'); c.restore();
  }
  // light shaft washing down over the figure
  if(wash>0.02){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=wash*0.45;
    const g=c.createLinearGradient(cx,hy,cx,920); g.addColorStop(0,'rgba(140,190,255,0.55)'); g.addColorStop(1,'rgba(140,190,255,0)');
    c.fillStyle=g;
    c.beginPath(); c.moveTo(cx-74,hy+40); c.lineTo(cx+74,hy+40); c.lineTo(cx+210,920); c.lineTo(cx-210,920); c.closePath(); c.fill();
    c.restore();
    // drifting heart-sparks in the shaft
    c.save(); c.globalCompositeOperation='screen';
    for(let i=0;i<7;i++){ const ph=AB.frac(t*0.5+i*0.14); const sy=lerp(hy+80,890,ph);
      c.globalAlpha=Math.sin(ph*Math.PI)*0.7*wash; c.fillStyle=P.soft;
      const sx=cx+Math.sin(i*2.4+t)*110*(0.4+ph);
      heart(c, sx, sy, 9, P.soft, P.glow); }
    c.restore();
  }

  AB.ring(c,cx,560,interp([1.25,1.9],[0,1])(t),P.glow,60,440);
  AB.motes(c,t,'rgba(125,180,255,0.6)',14);
  AB.grade(c,'virtue',0.33);
  },
};

export default clip;
