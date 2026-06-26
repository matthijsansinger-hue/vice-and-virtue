// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Wandering Soul Escape Ability - Video Export.html".
import type { ClipConfig } from "../engine";

const clip: ClipConfig = {
  name: "wandering_soul_escape",
  bg: "#05100f",
  poster: 1.7,
  duration: 2.0,
  fadeFromBlack: true,
  draw(c, t, AB) {
    const {interp,E,lerp,clamp,radial,figure,grade,ring,motes,CAMP,FIG,frac}=AB;
    const N=CAMP.neutral, V=CAMP.vice, U=CAMP.virtue;
    c.fillStyle=radial(c,960,480,1180,[[0,N.bg0],[1,N.bg1]]); c.fillRect(0,0,1920,1080);
    motes(c,t,'rgba(216,255,246,0.6)',16);
    const base=940, xs=[420,700,980,1260,1540];
    // each suspect's true camp; soul tags every one correctly
    const camps=['vice','virtue','vice','virtue','virtue'];

    // tags resolve one-by-one across the first ~1.1s
    const tagAt = i => interp([0.25+i*0.16, 0.5+i*0.16],[0,1],E.easeOutBack)(t);
    const allTagged=interp([0.95,1.15],[0,1])(t);
    const escape=interp([1.2,1.95],[0,1],E.easeInCubic)(t);   // soul ascends + dissolves
    const flash=interp([1.15,1.3,1.7],[0,1,0.2])(t);

    xs.forEach((x,i)=>{
      const camp=camps[i], col=camp==='vice'?V:U;
      const tg=tagAt(i);
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.16;
      c.fillStyle=radial(c,x,660,200,[[0,'rgba(216,255,246,0.4)'],[1,'rgba(216,255,246,0)']]); c.fillRect(x-220,360,440,560); c.restore();
      figure(c,{x,base,s:0.58,fill:FIG});
      if(tg>0.02){
        // camp halo
        c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(tg,0,1)*0.7;
        c.fillStyle=radial(c,x,base-180,170,[[0,(camp==='vice'?'rgba(255,90,60,0.55)':'rgba(125,180,255,0.55)')],[1,'rgba(0,0,0,0)']]); c.fillRect(x-200,base-380,400,400); c.restore();
        // camp emblem above + a correct-guess check
        const ey=base-410;
        c.save(); c.translate(x,ey); c.scale(clamp(tg,0,1),clamp(tg,0,1));
        c.strokeStyle=col.soft; c.lineWidth=5; c.shadowColor=col.glow; c.shadowBlur=12;
        if(camp==='vice'){ c.beginPath(); c.moveTo(0,-22); c.lineTo(20,14); c.lineTo(-20,14); c.closePath(); c.stroke(); }
        else { c.beginPath(); c.arc(0,-2,20,0,Math.PI*2); c.stroke(); }
        c.restore();
        // green check mark = correct
        c.save(); c.globalAlpha=clamp((tg-0.3)/0.7,0,1); c.translate(x+44,ey-30); c.scale(clamp(tg,0,1),clamp(tg,0,1));
        c.strokeStyle='#7fe9b0'; c.lineWidth=7; c.lineCap='round'; c.shadowColor='#7fe9b0'; c.shadowBlur=12;
        c.beginPath(); c.moveTo(-14,0); c.lineTo(-4,12); c.lineTo(16,-14); c.stroke(); c.restore();
      }
    });

    // all-correct flash of light
    if(flash>0.01){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=flash*0.7;
      c.fillStyle=radial(c,960,540,1100,[[0,'rgba(216,255,246,0.8)'],[0.5,'rgba(127,233,214,0.3)'],[1,'rgba(127,233,214,0)']]); c.fillRect(0,0,1920,1080); c.restore(); }

    // the Wandering Soul rises into the light and escapes (sole winner)
    if(escape>0.01){
      const sy=lerp(base, 220, escape), sx=960, sc=lerp(0.62,0.5,escape), al=clamp(1-escape*0.9,0.06,1);
      // doorway of light it ascends toward
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(escape*1.1,0,1)*0.8;
      c.fillStyle=radial(c,sx,180,360,[[0,'rgba(216,255,246,0.85)'],[0.6,'rgba(127,233,214,0.25)'],[1,'rgba(127,233,214,0)']]); c.fillRect(sx-380,-60,760,520); c.restore();
      // ascending wisps
      c.save(); c.globalCompositeOperation='screen';
      for(let i=0;i<12;i++){ const ph=frac(escape*1.2 + i*0.08); const wy=lerp(base-100, 200, ph), wx=sx+Math.sin(ph*6+i)*60*(1-ph);
        c.globalAlpha=Math.sin(ph*Math.PI)*0.6; c.fillStyle='#d8fff6'; c.beginPath(); c.arc(wx,wy,3+(i%3),0,Math.PI*2); c.fill(); }
      c.restore();
      c.save(); c.globalAlpha=al; c.globalCompositeOperation='screen';
      c.fillStyle=radial(c,sx,sy-260,240,[[0,'rgba(216,255,246,0.5)'],[1,'rgba(216,255,246,0)']]); c.fillRect(sx-260,sy-520,520,520); c.restore();
      c.save(); c.globalAlpha=al; figure(c,{x:sx,base:sy,s:sc,fill:'#bdfff2'}); c.restore();
      ring(c,sx,sy-260,interp([1.4,1.95],[0,1])(t),N.glow,60,460);
    }
    grade(c,'neutral',0.3);
  },
};

export default clip;
