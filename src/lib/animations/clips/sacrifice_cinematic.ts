// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Sacrifice - Video Export.html".
import type { ClipConfig } from "../engine";

const FW = 1920, FH = 1080, CARD_W = 1024, CARD_H = 1536, DURATION = 3.6;
let ctx;
let card;

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const E = {
  linear:t=>t,
  easeInQuad:t=>t*t,
  easeOutQuad:t=>t*(2-t),
  easeInCubic:t=>t*t*t,
  easeOutCubic:t=>(--t)*t*t+1,
  easeOutSine:t=>Math.sin(t*Math.PI/2),
  easeInOutSine:t=>-(Math.cos(Math.PI*t)-1)/2,
};
function interp(input, output, ease){
  ease = ease || E.linear;
  return (t)=>{
    if(t<=input[0]) return output[0];
    if(t>=input[input.length-1]) return output[output.length-1];
    for(let i=0;i<input.length-1;i++){
      if(t>=input[i] && t<=input[i+1]){
        const span=input[i+1]-input[i];
        const local=span===0?0:(t-input[i])/span;
        const ef=Array.isArray(ease)?(ease[i]||E.linear):ease;
        return output[i]+(output[i+1]-output[i])*ef(local);
      }
    }
    return output[output.length-1];
  };
}

const T = {
  fadeIn:[0,0.5], push:[0,1.05], draw:[1.0,1.46], flash:1.46,
  black:[1.5,2.62], slashes:[1.66,2.0,2.34], reveal:[2.6,3.5], finale:[99,99],
};

// embers seeds (match scenes.jsx)
const COUNT = 26;
const seeds = Array.from({length:COUNT},(_,i)=>({
  x:(i*97+13)%100, size:1.5+((i*53)%100)/100*3.5, speed:8+((i*37)%100)/100*22,
  phase:((i*71)%100)/100, drift:(((i*29)%100)/100-0.5)*60, flick:0.6+((i*41)%100)/100*1.8,
}));

function drawCardCamera(time){
  const zoom = interp(
    [0,T.push[1],T.draw[0],T.draw[1],T.reveal[0],T.reveal[1]],
    [1.98,2.16,2.16,2.34,1.92,1.82],
    [E.easeOutSine,E.linear,E.easeInCubic,E.linear,E.easeOutSine]
  )(time);
  const fy = interp(
    [0,T.push[1],T.draw[1],T.reveal[0],T.reveal[1]],
    [0.185,0.235,0.255,0.40,0.45],
    [E.easeOutSine,E.linear,E.linear,E.easeInOutSine]
  )(time);
  const shakeAmp = interp([T.draw[0],T.draw[1],T.flash+0.05],[0,7,0])(time);
  const sx = Math.sin(time*140)*shakeAmp, sy = Math.cos(time*170)*shakeAmp;
  const bright = interp([0,0.5,T.push[1],T.draw[1]],[0.35,0.7,0.92,1.18])(time);
  const inReveal = time >= T.reveal[0];
  const fallT = clamp((time-(T.reveal[0]+0.28))/(T.reveal[1]-T.reveal[0]-0.28),0,1);
  const fallEase = E.easeInCubic(fallT);
  const rotate = fallEase*5.5;
  const dropY = fallEase*140;
  const revealOpacity = inReveal ? interp([T.reveal[1]-0.35,T.reveal[1]],[1,0])(time) : 1;
  const filter = inReveal
    ? `brightness(${0.95-fallEase*0.7}) contrast(1.15) sepia(0.35) saturate(${1.4-fallEase*0.6}) hue-rotate(-12deg)`
    : `brightness(${bright}) contrast(1.06) saturate(0.92) sepia(0.16)`;

  const w = CARD_W*zoom, h = CARD_H*zoom;
  const left = FW/2 - 0.5*w, top = FH/2 - fy*h + dropY;
  const ox = left+0.5*w, oy = top+0.3*h;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.translate(ox, oy); ctx.rotate(rotate*Math.PI/180); ctx.translate(-ox, -oy);
  ctx.filter = filter;
  ctx.globalAlpha = revealOpacity;
  ctx.drawImage(card, left, top, w, h);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.restore();

  // warm wash (screen)
  if(!inReveal){
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const g = ctx.createRadialGradient(960, 324, 0, 960, 324, 900);
    g.addColorStop(0,'rgba(255,190,90,0.12)'); g.addColorStop(0.7,'rgba(255,190,90,0)');
    ctx.fillStyle = g; ctx.fillRect(0,0,FW,FH);
    ctx.restore();
  }
  return { inReveal, fallEase, sx, sy };
}

function drawEmbers(time, opacity){
  ctx.save();
  for(const s of seeds){
    const life = (time*s.speed/100 + s.phase)%1;
    const y = FH*(1-life);
    const x = s.x/100*FW + Math.sin(time*s.flick+s.phase*6)*s.drift;
    const fade = Math.sin(life*Math.PI);
    ctx.globalAlpha = fade*0.55*opacity;
    ctx.fillStyle = 'rgba(255,210,120,0.9)';
    ctx.shadowColor = 'rgba(255,180,70,0.7)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(x, y, s.size, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawVignette(strength, rgb){
  ctx.save();
  const g = ctx.createRadialGradient(960, 454, 300, 960, 454, 1250);
  g.addColorStop(0.30, `rgba(${rgb},0)`);
  g.addColorStop(1, `rgba(${rgb},${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0,0,FW,FH);
  ctx.restore();
}

function drawGlint(time){
  if(time < T.draw[0] || time >= T.flash+0.05) return;
  const gp = clamp((time-T.draw[0])/(T.draw[1]-T.draw[0]),0,1);
  const gx = interp([0,1],[-700, FW+200])(E.easeInQuad(gp));
  const slant = 0.3*FH*Math.tan(18*Math.PI/180);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.sin(gp*Math.PI);
  const grad = ctx.createLinearGradient(gx, 0, gx+420, 0);
  grad.addColorStop(0,'rgba(255,236,170,0)');
  grad.addColorStop(0.5,'rgba(255,240,190,0.55)');
  grad.addColorStop(0.6,'rgba(255,255,255,0.95)');
  grad.addColorStop(0.8,'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(gx+slant, 0); ctx.lineTo(gx+420+slant, 0);
  ctx.lineTo(gx+420-slant, FH); ctx.lineTo(gx-slant, FH); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRedBloom(time, inReveal){
  if(!inReveal) return;
  const v = interp([T.reveal[0],T.reveal[0]+0.5,T.reveal[1]],[0,0.32,0.7])(time);
  if(v<=0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = v;
  const g = ctx.createRadialGradient(960, 594, 0, 960, 594, 1100);
  g.addColorStop(0,'rgba(150,15,15,0.9)'); g.addColorStop(0.7,'rgba(40,0,0,0.4)'); g.addColorStop(1,'rgba(40,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,FW,FH);
  ctx.restore();
}

const gashMarks = [
  {x:250,y:430,a:-34,t:T.reveal[0]+0.02},{x:1640,y:470,a:30,t:T.reveal[0]+0.08},
  {x:470,y:720,a:-22,t:T.reveal[0]+0.16},{x:1500,y:720,a:24,t:T.reveal[0]+0.12},
  {x:960,y:880,a:-10,t:T.reveal[0]+0.2},
];
function drawEnemyGashes(time, inReveal){
  if(!inReveal) return;
  for(const g of gashMarks){
    const age = time-g.t;
    if(age<-0.02 || age>0.7) continue;
    const a = clamp(age/0.7,0,1);
    const grow = E.easeOutCubic(clamp(age/0.12,0,1));
    const col = a<0.2 ? '255,255,255' : '181,22,22';
    const W = 150*grow, H = a<0.2?5:3;
    ctx.save();
    ctx.translate(g.x, g.y); ctx.rotate(g.a*Math.PI/180);
    ctx.globalAlpha = (1-a)*0.95;
    ctx.shadowColor = a<0.25?'rgba(255,255,255,0.8)':'rgba(180,20,20,0.6)';
    ctx.shadowBlur = a<0.25?14:10;
    const grad = ctx.createLinearGradient(-W/2,0,W/2,0);
    grad.addColorStop(0,`rgba(${col},0)`); grad.addColorStop(0.25,`rgba(${col},1)`);
    grad.addColorStop(0.75,`rgba(${col},1)`); grad.addColorStop(1,`rgba(${col},0)`);
    ctx.fillStyle = grad; ctx.fillRect(-W/2,-H/2,W,H);
    ctx.restore();
  }
}

function drawSlash(time, at, angle, offY){
  const SWING = 0.16, len = 2900;
  const p = (time-at)/SWING;
  const gashAge = time-(at+SWING*0.45);
  if((p<=-0.05||p>=1.15) && (gashAge<=-0.02||gashAge>=0.6)) return;
  ctx.save();
  ctx.translate(960, 540+offY); ctx.rotate(angle*Math.PI/180);
  // blade light
  if(p>-0.05 && p<1.15){
    const e = E.easeInQuad(clamp(p,0,1));
    const x = interp([0,1],[-len*0.58, len*0.58])(e);
    ctx.save();
    ctx.globalAlpha = clamp(1.1-Math.abs(p-0.5)*0.6,0,1);
    ctx.shadowColor = 'rgba(255,235,180,0.8)'; ctx.shadowBlur = 22;
    const grad = ctx.createLinearGradient(x-260,0,x+260,0);
    grad.addColorStop(0,'rgba(255,255,255,0)'); grad.addColorStop(0.4,'rgba(255,240,200,0.5)');
    grad.addColorStop(0.72,'rgba(255,255,255,1)'); grad.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(x-260,-3,520,6);
    ctx.restore();
  }
  // gash
  if(gashAge>-0.02 && gashAge<0.6){
    const ga = clamp(gashAge/0.6,0,1);
    const white = ga<0.18;
    const col = white?'255,255,255':'156,20,20';
    const H = white?4:2.5;
    ctx.save();
    ctx.globalAlpha = (1-ga)*(white?1:0.85);
    ctx.shadowColor = white?'rgba(255,255,255,0.8)':'rgba(150,20,20,0.55)';
    ctx.shadowBlur = white?16:10;
    const grad = ctx.createLinearGradient(-len/2,0,len/2,0);
    grad.addColorStop(0.08,`rgba(${col},0)`); grad.addColorStop(0.30,`rgba(${col},1)`);
    grad.addColorStop(0.70,`rgba(${col},1)`); grad.addColorStop(0.92,`rgba(${col},0)`);
    ctx.fillStyle = grad; ctx.fillRect(-len/2,-H/2,len,H);
    ctx.restore();
  }
  ctx.restore();
}

function drawFinale(time){
  // opaque radial bg
  const g = ctx.createRadialGradient(960,540,0,960,540,1100);
  g.addColorStop(0,'#1a1009'); g.addColorStop(0.8,'#050302'); g.addColorStop(1,'#050302');
  ctx.fillStyle = g; ctx.fillRect(0,0,FW,FH);
  const eyebrow = interp([T.finale[0]-0.1,T.finale[0]+0.35],[0,1],E.easeOutQuad)(time);
  const scale = interp([T.finale[0]+0.12,T.finale[0]+0.9],[0.92,1.0],E.easeOutCubic)(time);
  const ruleW = interp([T.finale[0]+0.3,T.finale[0]+0.85],[0,420],E.easeOutCubic)(time);
  // title
  ctx.save();
  ctx.translate(960, 528);
  ctx.scale(scale, scale);
  ctx.globalAlpha = eyebrow;
  ctx.font = '700 64px Cinzel, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.letterSpacing = '29px';
  ctx.fillStyle = '#e3b510';
  ctx.shadowColor = 'rgba(227,181,16,0.5)'; ctx.shadowBlur = 36;
  ctx.fillText('SACRIFICE', 14, 0);
  ctx.restore();
  // rule
  ctx.save();
  ctx.globalAlpha = eyebrow;
  const rg = ctx.createLinearGradient(960-ruleW/2,0,960+ruleW/2,0);
  rg.addColorStop(0,'rgba(227,181,16,0)'); rg.addColorStop(0.5,'rgba(227,181,16,1)'); rg.addColorStop(1,'rgba(227,181,16,0)');
  ctx.fillStyle = rg; ctx.fillRect(960-ruleW/2, 588, ruleW, 1.5);
  ctx.restore();
}

function drawFrame(time){
  ctx.clearRect(0,0,FW,FH);
  ctx.fillStyle = '#050403'; ctx.fillRect(0,0,FW,FH);

  const inBlack = time >= T.black[0] && time < T.reveal[0];
  const inFinale = time >= T.finale[0]-0.2;
  let inReveal = time >= T.reveal[0];

  if(inFinale){
    drawFinale(time);
  } else {
    if(!inBlack){
      const cam = drawCardCamera(time);
      inReveal = cam.inReveal;
      drawEmbers(time, inReveal ? 0.4*(1-cam.fallEase) : 1);
    }
    drawGlint(time);
    if(!inBlack) drawVignette(inReveal?0.96:0.9, inReveal?'40,0,0':'0,0,0');
    drawRedBloom(time, inReveal);
    drawEnemyGashes(time, inReveal);

    // black void + slashes
    const voidV = interp([T.black[0]-0.04,T.black[0],T.reveal[0]-0.02,T.reveal[0]],[0,1,1,0])(time);
    if(voidV>0.001){
      ctx.save();
      ctx.globalAlpha = voidV;
      ctx.fillStyle = '#040303'; ctx.fillRect(0,0,FW,FH);
      // void texture pulse
      ctx.save();
      ctx.globalAlpha = voidV*(0.6+0.4*Math.sin(time*6));
      const tg = ctx.createRadialGradient(960,540,0,960,540,900);
      tg.addColorStop(0,'rgba(60,30,15,0.18)'); tg.addColorStop(0.7,'rgba(60,30,15,0)');
      ctx.fillStyle = tg; ctx.fillRect(0,0,FW,FH);
      ctx.restore();
      let voidShake = 0;
      T.slashes.forEach(s=>{ const d=time-s; if(d>0&&d<0.12) voidShake+=Math.sin(d*120)*(1-d/0.12)*6; });
      ctx.translate(voidShake, -voidShake*0.6);
      drawSlash(time, T.slashes[0], -27, -40);
      drawSlash(time, T.slashes[1], 22, 70);
      drawSlash(time, T.slashes[2], -15, -110);
      ctx.restore();
    }

    // white flash
    const flashV = interp([T.flash-0.05,T.flash,T.flash+0.06,T.black[0]],[0,1,0.85,0])(time);
    if(flashV>0.001){ ctx.save(); ctx.globalAlpha=flashV; ctx.fillStyle='#fff'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
  }

  // global fade-in from black
  const fadeIn = interp(T.fadeIn,[1,0],E.easeOutQuad)(time);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
  // fade-out to black at the end (no wordmark)
  const fadeOut = interp([DURATION-0.4,DURATION],[0,1])(time);
  if(fadeOut>0.001){ ctx.save(); ctx.globalAlpha=fadeOut; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "sacrifice_cinematic",
  bg: "#050403",
  duration: DURATION,
  fadeFromBlack: false,
  images: { card: "/cards/sacrifice.png" },
  draw(c, t, AB, assets) {
    ctx = c;
    card = assets.card;
    drawFrame(t);
  },
};

export default clip;
