// @ts-nocheck
/* eslint-disable */
// Ported verbatim from the design handoff: trailer/"Black Market - Video Export.html"
// (2026 phase-transition rework). Plays as the store phase stinger.
// Everything below copied VERBATIM from the source <script>, except:
//   * `const ctx = canvas.getContext('2d')` -> module-level `let ctx;` (set in draw)
//   * removed: canvas/status/record lookups, load flags, previewLoop,
//     recordVideo/pickMime/onRecord, trailing requestAnimationFrame boot, window.drawFrame
import type { ClipConfig } from "../engine";

const FW = 1920, FH = 1080, DURATION = 4.0;
let ctx;

// ── palette ──────────────────────────────────────────────────────────────────
const WOOD='#4e3624', WOOD_D='#372315', PANEL='#3a281a', INK='#15120e',
      GOLD='#e3b510', WARM='#ffcf7a', CREAM='#ffefc5',
      GREEN='#3f9d5a', PURPLE='#7b4bb0', RED='#b8472f', EARTHEN='#9c7b54',
      CYAN='#7de0f0', BURG='#800020', STONE='#4b4742';

// ── easing / interp ─────────────────────────────────────────────────────────
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=t=>t*t*(3-2*t);
const E = {
  linear:t=>t, easeInQuad:t=>t*t, easeOutQuad:t=>t*(2-t),
  easeInOutQuad:t=>t<0.5?2*t*t:-1+(4-2*t)*t,
  easeInCubic:t=>t*t*t, easeOutCubic:t=>(--t)*t*t+1,
  easeOutBack:t=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);},
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
function lerp(a,b,t){ return a+(b-a)*t; }
function frac(x){ return x-Math.floor(x); }
function radial(c, cx, cy, r, stops){ const g=c.createRadialGradient(cx,cy,0,cx,cy,r); for(const [o,col] of stops) g.addColorStop(o,col); return g; }
function vlin(c, x0,y0,x1,y1, stops){ const g=c.createLinearGradient(x0,y0,x1,y1); for(const [o,col] of stops) g.addColorStop(o,col); return g; }

// ── timeline ─────────────────────────────────────────────────────────────────
// all in absolute SECONDS
const COIN=[0.45,1.5], PAY=[1.45,1.72], DOOR=[1.68,2.6], FREE=[2.35,3.25];
const TEXT1=[0.7,1.25], TEXT2=[2.62,3.2];
const FLOOR=846, COUNTER=600, SHELF=536;

// ── camera (push-in + pan from stall to the cell) ───────────────────────────
function applyCam(c, t){
  const e=smooth(clamp(t/2.9,0,1));
  const k=lerp(1.05,1.13,e);
  const fx=lerp(800,1170,e), fy=lerp(540,524,e);
  c.translate(960,540); c.scale(k,k); c.translate(-fx,-fy);
}

// ── hall backdrop + torches ─────────────────────────────────────────────────
function drawHall(c, t){
  c.fillStyle=vlin(c,0,0,0,FH,[[0,'#241a12'],[0.55,'#1c140d'],[1,'#0e0a06']]);
  c.fillRect(-200,-200,FW+400,FH+400);
  // stone courses (faint)
  c.save(); c.globalAlpha=0.16; c.strokeStyle='#000'; c.lineWidth=3;
  for(let y=80;y<FLOOR;y+=92){ c.beginPath(); c.moveTo(-100,y); c.lineTo(FW+100,y); c.stroke(); }
  for(let y=80;y<FLOOR;y+=92){ const off=((y/92)%2)*110; for(let x=-100+off;x<FW+100;x+=220){ c.beginPath(); c.moveTo(x,y); c.lineTo(x,y+92); c.stroke(); } }
  c.restore();
  // floor
  c.fillStyle=vlin(c,0,FLOOR,0,FH,[[0,'#2a2018'],[1,'#0c0805']]);
  c.fillRect(-200,FLOOR,FW+400,FH-FLOOR+200);
  c.strokeStyle='rgba(0,0,0,0.4)'; c.lineWidth=4; c.beginPath(); c.moveTo(-100,FLOOR); c.lineTo(FW+100,FLOOR); c.stroke();
  // torches
  [ [150,250], [1840,210] ].forEach(([tx,ty],i)=>{
    const fl=0.8+0.2*Math.sin(t*16+i*3)*Math.sin(t*6+i);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=fl;
    c.fillStyle=radial(c,tx,ty,440,[[0,'rgba(255,150,50,0.5)'],[0.7,'rgba(255,150,50,0)']]);
    c.fillRect(tx-460,ty-460,920,920); c.restore();
    // sconce + flame
    c.fillStyle='#1a120a'; c.fillRect(tx-7,ty,14,90);
    c.save(); c.globalCompositeOperation='screen';
    const fy2=ty-6+Math.sin(t*20+i)*3;
    c.fillStyle=radial(c,tx,fy2,40,[[0,'#fff3c0'],[0.4,'#ffb347'],[1,'rgba(255,120,40,0)']]);
    c.beginPath(); c.ellipse(tx,fy2,22,34,0,0,Math.PI*2); c.fill(); c.restore();
  });
}

// ── one potion bottle (shape + glowing liquid + bubbles) ────────────────────
function bottleBody(c, b){
  const {x,w,h,shape}=b; const bx=x, by=SHELF; // base sits on shelf line passed via b.base
  const base=b.base;
  c.beginPath();
  if(shape==='flask'){
    c.moveTo(bx-w*0.18, base-h);            // neck top L
    c.lineTo(bx-w*0.18, base-h*0.62);
    c.lineTo(bx-w*0.5, base-2);
    c.quadraticCurveTo(bx, base+10, bx+w*0.5, base-2);
    c.lineTo(bx+w*0.18, base-h*0.62);
    c.lineTo(bx+w*0.18, base-h); c.closePath();
  } else if(shape==='round'){
    c.moveTo(bx-w*0.16, base-h);
    c.lineTo(bx-w*0.16, base-h*0.55);
    c.arc(bx, base-w*0.42, w*0.46, Math.PI*0.78, Math.PI*0.22, false);
    c.lineTo(bx+w*0.16, base-h); c.closePath();
  } else if(shape==='orb'){
    c.moveTo(bx-w*0.14, base-h);
    c.lineTo(bx-w*0.14, base-h*0.6);
    c.arc(bx, base-w*0.46, w*0.5, -Math.PI*0.7, Math.PI*1.7, false);
    c.closePath();
  } else if(shape==='vial'){
    c.roundRect(bx-w*0.28, base-h, w*0.56, h, [w*0.1,w*0.1,5,5]);
  } else { // tall
    c.roundRect(bx-w*0.5, base-h, w, h, [w*0.18,w*0.18,7,7]);
  }
}
function drawBottle(c, b, t){
  const base=b.base;
  // glass body
  c.save();
  bottleBody(c, b);
  c.save(); c.clip();
  // glass tint
  c.fillStyle='rgba(220,235,230,0.10)'; c.fillRect(b.x-120,base-b.h-20,240,b.h+40);
  // liquid
  const liqTop = base - b.h*(b.fill||0.6) + Math.sin(t*3+b.x)*1.5;
  c.fillStyle=b.col; c.fillRect(b.x-120, liqTop, 240, base-liqTop+12);
  // liquid sheen
  c.fillStyle='rgba(255,255,255,0.18)'; c.fillRect(b.x-120, liqTop, 240, 6);
  // bubbles
  c.fillStyle='rgba(255,255,255,0.5)';
  for(let i=0;i<5;i++){
    const ph=(i*0.27+b.x*0.01);
    const by=base-12 - frac(t*(0.5+i*0.18)+ph)*(base-12-liqTop);
    const bxx=b.x + Math.sin(t*4+i)*b.w*0.16 + (i-2)*b.w*0.12;
    c.globalAlpha=0.5; c.beginPath(); c.arc(bxx,by,1.6+i*0.5,0,Math.PI*2); c.fill();
  }
  c.globalAlpha=1;
  c.restore();
  // glass outline + glow
  c.lineWidth=2.5; c.strokeStyle='rgba(20,14,8,0.85)';
  if(b.glow){ c.shadowColor=b.col; c.shadowBlur=18; }
  bottleBody(c, b); c.stroke();
  c.restore();
  // cork
  c.fillStyle='#5a4226'; const cw=(b.shape==='vial'||b.shape==='tall')?b.w*0.4:b.w*0.34;
  c.fillRect(b.x-cw/2, base-b.h-14, cw, 16);
  c.fillStyle='#6f5230'; c.fillRect(b.x-cw/2, base-b.h-14, cw, 5);
}

// ── ingredient props ─────────────────────────────────────────────────────────
function drawSkull(c,x,y,s){ // y = base
  c.save(); c.translate(x,y); c.scale(s,s);
  c.fillStyle='#ded3b8';
  c.beginPath(); c.arc(0,-26,26,Math.PI,0); c.lineTo(20,-6); c.quadraticCurveTo(20,2,8,2); c.lineTo(-8,2); c.quadraticCurveTo(-20,2,-20,-6); c.closePath(); c.fill();
  // jaw
  c.fillRect(-14,0,28,9);
  // eyes + nose
  c.fillStyle='#2a2016'; c.beginPath(); c.arc(-11,-22,7,0,Math.PI*2); c.arc(11,-22,7,0,Math.PI*2); c.fill();
  c.beginPath(); c.moveTo(0,-14); c.lineTo(-4,-6); c.lineTo(4,-6); c.closePath(); c.fill();
  c.restore();
}
function drawEyeJar(c,x,y,s,t){ // jar with floating eyeball
  c.save(); c.translate(x,y); c.scale(s,s);
  c.fillStyle='rgba(150,200,180,0.18)';
  c.beginPath(); c.roundRect(-22,-58,44,58,[6,6,8,8]); c.fill();
  c.strokeStyle='rgba(20,14,8,0.7)'; c.lineWidth=2.5; c.beginPath(); c.roundRect(-22,-58,44,58,[6,6,8,8]); c.stroke();
  c.fillStyle='#3f6d52'; c.globalAlpha=0.5; c.fillRect(-20,-32,40,30); c.globalAlpha=1;
  // eyeball bobbing
  const ey=-30+Math.sin(t*2.2)*5;
  c.fillStyle='#f2ecd9'; c.beginPath(); c.arc(0,ey,11,0,Math.PI*2); c.fill();
  c.fillStyle=CYAN; c.beginPath(); c.arc(2,ey,5,0,Math.PI*2); c.fill();
  c.fillStyle='#1a1410'; c.beginPath(); c.arc(2,ey,2.4,0,Math.PI*2); c.fill();
  c.strokeStyle=BURG; c.lineWidth=1; c.globalAlpha=0.6;
  c.beginPath(); c.moveTo(-8,ey-3); c.lineTo(-3,ey); c.moveTo(9,ey+4); c.lineTo(4,ey+1); c.stroke();
  // lid
  c.globalAlpha=1; c.fillStyle='#5a4226'; c.fillRect(-24,-64,48,8);
  c.restore();
}
function drawMortar(c,x,y,s){
  c.save(); c.translate(x,y); c.scale(s,s);
  c.fillStyle='#3a342c'; c.beginPath(); c.moveTo(-26,-20); c.quadraticCurveTo(0,18,26,-20); c.lineTo(20,-20); c.quadraticCurveTo(0,8,-20,-20); c.closePath(); c.fill();
  c.fillStyle='#2c2720'; c.beginPath(); c.ellipse(0,-20,26,7,0,0,Math.PI*2); c.fill();
  c.fillStyle='#5a4226'; c.save(); c.translate(10,-22); c.rotate(-0.5); c.fillRect(-3,-26,6,30); c.beginPath(); c.arc(0,4,5,0,Math.PI*2); c.fill(); c.restore();
  c.restore();
}
function drawHerbBundle(c,x,y,s){ // hanging dried herbs (from awning)
  c.save(); c.translate(x,y); c.scale(s,s);
  c.strokeStyle='#7a6a3a'; c.lineWidth=3; c.lineCap='round';
  for(let i=-3;i<=3;i++){ c.beginPath(); c.moveTo(0,0); c.quadraticCurveTo(i*5,40,i*9,84); c.stroke(); }
  c.fillStyle='#5d6b35';
  for(let i=-3;i<=3;i++){ for(let j=1;j<5;j++){ c.beginPath(); c.ellipse(i*7,j*18,5,9,i*0.2,0,Math.PI*2); c.fill(); } }
  c.fillStyle='#6b4a26'; c.fillRect(-7,-4,14,10); // tie
  c.restore();
}
function drawCauldron(c,x,y,s,t){
  c.save(); c.translate(x,y); c.scale(s,s);
  // legs
  c.strokeStyle='#0f0a06'; c.lineWidth=6; c.lineCap='round';
  c.beginPath(); c.moveTo(-30,0); c.lineTo(-40,28); c.moveTo(30,0); c.lineTo(40,28); c.moveTo(0,6); c.lineTo(0,30); c.stroke();
  // pot
  c.fillStyle='#15110c'; c.beginPath(); c.arc(0,-20,54,0.1,Math.PI-0.1,false); c.lineTo(-50,-30); c.quadraticCurveTo(0,-44,50,-30); c.closePath(); c.fill();
  c.fillStyle='#241c14'; c.beginPath(); c.ellipse(0,-30,52,14,0,0,Math.PI*2); c.fill();
  // brew
  c.save(); c.beginPath(); c.ellipse(0,-30,46,11,0,0,Math.PI*2); c.clip();
  c.fillStyle=GREEN; c.fillRect(-50,-42,100,24);
  c.fillStyle='rgba(180,255,200,0.5)';
  for(let i=0;i<4;i++){ const bx=-30+i*20+Math.sin(t*3+i)*6; const r=4+3*Math.abs(Math.sin(t*4+i)); c.beginPath(); c.arc(bx,-30,r,0,Math.PI*2); c.fill(); }
  c.restore();
  c.fillStyle=GREEN; c.shadowColor=GREEN; c.shadowBlur=20; c.globalAlpha=0.5; c.beginPath(); c.ellipse(0,-30,46,11,0,0,Math.PI*2); c.fill(); c.shadowBlur=0; c.globalAlpha=1;
  // steam
  c.globalCompositeOperation='screen';
  for(let i=0;i<3;i++){
    const life=frac(t*0.4+i*0.33); const sy=-40-life*120; const sx=(i-1)*16+Math.sin(t*2+i+life*5)*16;
    c.globalAlpha=(1-life)*0.32; c.fillStyle=radial(c,sx,sy,30,[[0,'rgba(180,255,200,0.7)'],[1,'rgba(180,255,200,0)']]);
    c.beginPath(); c.arc(sx,sy,26,0,Math.PI*2); c.fill();
  }
  c.restore();
}

// ── the stall ────────────────────────────────────────────────────────────────
const SHELF_BOTTLES=[
  {x:362,w:62,h:128,shape:'flask',col:GREEN,fill:0.62,glow:false},
  {x:452,w:46,h:150,shape:'tall', col:PURPLE,fill:0.66,glow:true},
  {x:534,w:64,h:104,shape:'orb',  col:CYAN, fill:0.7, glow:true},
  {x:624,w:58,h:120,shape:'round',col:BURG, fill:0.6, glow:false},
  {x:712,w:40,h:158,shape:'vial', col:GOLD, fill:0.72,glow:true},
  {x:792,w:54,h:112,shape:'tall', col:EARTHEN,fill:0.55,glow:false},
  {x:878,w:60,h:116,shape:'round',col:RED,  fill:0.64,glow:false},
  {x:966,w:42,h:140,shape:'vial', col:GREEN,fill:0.6, glow:false},
];
const COUNTER_BOTTLES=[
  {x:486,w:84,h:150,shape:'flask',col:RED,  fill:0.6, glow:true},   // hero brew
  {x:760,w:48,h:120,shape:'tall', col:PURPLE,fill:0.66,glow:true},
  {x:828,w:38,h:96, shape:'vial', col:CYAN, fill:0.7, glow:true},
];

function drawStall(c, t){
  // back shelf board
  c.fillStyle=WOOD_D; c.fillRect(300,SHELF,720,16);
  c.fillStyle='rgba(0,0,0,0.35)'; c.fillRect(300,SHELF+16,720,8);
  // shelf bottles
  SHELF_BOTTLES.forEach(b=>{ b.base=SHELF; drawBottle(c,b,t); });

  // the shopkeeper (rigged), behind the counter, arranging wares
  if(window.AB){
    const {rig}=AB.RIG;
    const sway=Math.sin(t*1.1)*0.02;
    const tend=Math.sin(t*2.3);
    rig(c,{ x:914, ground:770, s:1.0, facing:-1,
      pal:{ cloth:'#3f5a2e', clothD:'#28401c', under:'#141f0e', skin:'#c9b28a',
        trim:'#c99b2e', rim:'rgba(255,207,122,0.9)', boot:'#141f0e', glove:'#1c2a12' },
      hoodUp:true, lean:0.08+sway, bow:0.28,
      handF:[112+tend*9,-92-tend*6], handB:[-8,-68], bendF:-1, bendB:-1,
      cape:0.25, skirt:1, eyes:0.55, eyeCol:WARM, rim:0.7 });
  }
  // hanging herbs + sign from awning underside (drawn before awning? draw here over shelf)

  // counter block
  c.fillStyle=vlin(c,0,COUNTER,0,FLOOR,[[0,'#5a4026'],[0.5,'#46301c'],[1,'#2e2012']]);
  c.fillRect(150,COUNTER,930,FLOOR-COUNTER);
  c.fillStyle=WOOD; c.fillRect(140,COUNTER-18,950,26); // counter top lip
  c.fillStyle='#6b4c2c'; c.fillRect(140,COUNTER-18,950,6);
  // plank lines
  c.strokeStyle='rgba(0,0,0,0.25)'; c.lineWidth=2;
  for(let x=210;x<1080;x+=120){ c.beginPath(); c.moveTo(x,COUNTER); c.lineTo(x,FLOOR); c.stroke(); }

  // items on the counter (base = COUNTER-18)
  const cb=COUNTER-20;
  drawCauldron(c,210,FLOOR-6,1.0,t);
  drawSkull(c,330,cb,1.25);
  drawMortar(c,408,cb,1.1);
  COUNTER_BOTTLES.forEach(b=>{ b.base=cb; drawBottle(c,b,t); });
  drawEyeJar(c,648,cb,1.15,t);
  // scattered loose ingredients
  c.fillStyle='#6d5a30'; // mushrooms
  [[888,cb],[916,cb]].forEach(([mx,my],i)=>{ c.save(); c.translate(mx,my); c.fillStyle='#caa56a'; c.beginPath(); c.ellipse(0,-22,12-i*2,7,0,Math.PI,0); c.fill(); c.fillStyle='#e8dcc0'; c.fillRect(-3,-22,6,22); c.restore(); });
  // crossed bones
  c.save(); c.translate(966,cb-6); c.strokeStyle='#ded3b8'; c.lineWidth=6; c.lineCap='round';
  c.beginPath(); c.moveTo(-16,-10); c.lineTo(16,4); c.moveTo(-16,4); c.lineTo(16,-10); c.stroke();
  c.fillStyle='#ded3b8'; [[-16,-10],[16,4],[-16,4],[16,-10]].forEach(([bx,by])=>{ c.beginPath(); c.arc(bx,by,4,0,Math.PI*2); c.fill(); }); c.restore();

  // awning posts
  c.fillStyle=WOOD_D; c.fillRect(150,300,18,FLOOR-300); c.fillRect(1062,300,18,FLOOR-300);
  // awning
  const sway=Math.sin(t*1.5)*2;
  c.fillStyle='#6a2f24'; c.beginPath(); c.moveTo(120,300); c.lineTo(1110,300); c.lineTo(1110,250); c.lineTo(120,250); c.closePath(); c.fill();
  c.fillStyle='#e8e0cf';
  for(let x=120;x<1100;x+=140){ c.fillStyle=((x/140)|0)%2?'#7a3528':'#e8e0cf'; c.beginPath(); c.moveTo(x,300); c.lineTo(x+140,300); c.lineTo(x+70,338+sway); c.closePath(); c.fill(); }
  c.fillStyle=WOOD_D; c.fillRect(110,238,1010,16);
  // hanging herbs from awning
  drawHerbBundle(c,1030,300,0.7);
  drawHerbBundle(c,200,300,0.6);

  // hanging carved sign
  c.save();
  const sgx=720, sgy=312; const sw2=Math.sin(t*1.3)*0.015;
  c.translate(sgx,300); c.rotate(sw2);
  c.strokeStyle='#2a1c10'; c.lineWidth=3; c.beginPath(); c.moveTo(-70,0); c.lineTo(-70,18); c.moveTo(70,0); c.lineTo(70,18); c.stroke();
  c.fillStyle=WOOD; c.beginPath(); c.roundRect(-96,18,192,58,8); c.fill();
  c.lineWidth=3; c.strokeStyle=GOLD; c.globalAlpha=0.7; c.beginPath(); c.roundRect(-96,18,192,58,8); c.stroke(); c.globalAlpha=1;
  c.font='700 30px Cinzel, serif'; c.textAlign='center'; c.textBaseline='middle'; c.letterSpacing='4px';
  c.fillStyle=GOLD; c.shadowColor='rgba(227,181,16,0.5)'; c.shadowBlur=12; c.fillText('POTIONS',0,49); c.letterSpacing='0px';
  c.restore();
}

// ── prison cell + door + prisoner ────────────────────────────────────────────
function drawPrison(c, t){
  const L=1300, R=1786, spring=372, top=232, mid=(L+R)/2;
  const lit=interp([DOOR[0],DOOR[1]+0.2],[0,1],E.easeOutCubic)(t);
  const open=interp([DOOR[0],DOOR[1]],[0,1],E.easeOutCubic)(t);

  // stone arch surround
  c.fillStyle=vlin(c,L,top,R,top,[[0,'#3b3833'],[0.5,'#54504a'],[1,'#33302b']]);
  c.beginPath();
  c.moveTo(L-26,FLOOR); c.lineTo(L-26,spring); c.arc(mid,spring,(R-L)/2+26,Math.PI,0,false); c.lineTo(R+26,FLOOR);
  c.lineTo(R+10,FLOOR); c.lineTo(R+10,spring); c.arc(mid,spring,(R-L)/2-10,0,Math.PI,true); c.lineTo(L-10,FLOOR); c.closePath(); c.fill();
  // voussoir lines
  c.strokeStyle='rgba(0,0,0,0.35)'; c.lineWidth=2;
  for(let a=Math.PI;a<=2*Math.PI+0.01;a+=Math.PI/9){ const r1=(R-L)/2-10,r2=(R-L)/2+26; c.beginPath(); c.moveTo(mid+Math.cos(a)*r1,spring+Math.sin(a)*r1); c.lineTo(mid+Math.cos(a)*r2,spring+Math.sin(a)*r2); c.stroke(); }

  // ---- everything inside the cell opening, clipped to the arch ----
  c.save();
  c.beginPath();
  c.moveTo(L-8,FLOOR); c.lineTo(L-8,spring); c.arc(mid,spring,(R-L)/2+8,Math.PI,0,false); c.lineTo(R+8,FLOOR); c.closePath();
  c.clip();

  // dark interior
  c.fillStyle='#0a0806'; c.fillRect(L-30,top-30,R-L+80,FLOOR-top+60);
  // warm light pouring from the freed doorway (right half), grows as door opens
  if(lit>0.001){
    c.save(); c.globalAlpha=lit;
    c.fillStyle=radial(c, mid+110, 600, 360, [[0,'#ffdca0'],[0.45,'#caa05a'],[1,'rgba(120,80,30,0)']]);
    c.fillRect(L-30,top-30,R-L+80,FLOOR-top+60);
    c.restore();
  }

  // prisoner — rigged, backlit, lifts his head and walks free
  const fp=interp([FREE[0],FREE[1]],[0,1],E.easeInOutQuad)(t);
  if(window.AB){
    const {rig, walkPose, shadow}=AB.RIG;
    const fr=v=>v-Math.floor(v);
    const px=lerp(mid+150, mid+62, fp), py=FLOOR-6;
    const stepping = fp>0.02 && fp<0.98;
    const w=walkPose(fr(t*1.7), 34);
    shadow(c, px, py+4, 66, 0.5*lit);
    rig(c,{ x:px, ground:py, s:0.64, facing:-1,
      pal:{ cloth:'#141210', clothD:'#0c0a08', under:'#060505', skin:'#8a7263',
        trim:'#3a3020', rim:'rgba(255,207,122,0.95)', boot:'#080606', glove:'#0e0c0a' },
      hoodUp:false,
      lean:0.05, bow:lerp(0.55,0.12,fp),          // head lifts as he's freed
      footF:stepping?w.footF:[24,186], footB:stepping?w.footB:[-20,186],
      handF:stepping?w.handF:null, handB:stepping?w.handB:null,
      relaxF:!stepping, relaxB:!stepping,
      hipH:186-(stepping?w.hipBob:0),
      cape:0, skirt:0.55,
      eyes:0.4*lit, eyeCol:WARM, rim:clamp(lit*1.1,0,1) });
  }

  // static iron bars over the LEFT half (this part of the cage never opens)
  (function leftBars(){
    c.save();
    c.beginPath(); c.rect(L-30, top-20, (mid)-(L-30)-2, FLOOR-top+40); c.clip();
    c.strokeStyle=vlin(c,0,0,8,0,[[0,'#1b1f24'],[0.5,'#565d66'],[1,'#15181c']]); c.lineWidth=11; c.lineCap='round';
    for(let x=L+24;x<mid;x+=58){ const h=Math.sqrt(Math.max(0,((R-L)/2)**2-((x-mid)**2))); const yt=spring-h+10; c.beginPath(); c.moveTo(x,Math.max(yt,top+6)); c.lineTo(x,FLOOR-4); c.stroke(); }
    c.lineWidth=9; [spring+40, FLOOR-70].forEach(y=>{ c.beginPath(); c.moveTo(L+18,y); c.lineTo(mid,y); c.stroke(); });
    c.restore();
  })();

  // ---- the cell DOOR (right half) swings open: foreshorten toward the right hinge ----
  const hingeX=R-22;
  c.save();
  c.translate(hingeX,0); c.scale(1-open*0.9, 1); c.translate(-hingeX,0);
  // door frame
  c.strokeStyle='#3a3f47'; c.lineWidth=12; c.lineJoin='round';
  c.strokeRect(mid+4, spring-120, hingeX-(mid+4), FLOOR-(spring-120)-26);
  // door bars
  c.strokeStyle=vlin(c,0,0,8,0,[[0,'#1b1f24'],[0.5,'#565d66'],[1,'#15181c']]); c.lineWidth=11; c.lineCap='round';
  for(let x=mid+34;x<hingeX-8;x+=54){ const h=Math.sqrt(Math.max(0,((R-L)/2)**2-((x-mid)**2))); const yt=spring-h+10; c.beginPath(); c.moveTo(x,Math.max(yt,top+10)); c.lineTo(x,FLOOR-30); c.stroke(); }
  c.lineWidth=9; [spring+40, FLOOR-70].forEach(y=>{ c.beginPath(); c.moveTo(mid+10,y); c.lineTo(hingeX-6,y); c.stroke(); });
  // lock + glowing keyhole on the door
  c.fillStyle='#26120e'; c.fillRect(mid+18, 600, 50, 60);
  c.fillStyle=GOLD; c.shadowColor=GOLD; c.shadowBlur=interp([PAY[0],PAY[1]],[5,26])(t);
  c.beginPath(); c.arc(mid+43, 624, 8,0,Math.PI*2); c.fill(); c.fillRect(mid+39,628,8,18); c.shadowBlur=0;
  c.restore();

  c.restore(); // arch clip
}

// ── guard + bribe ─────────────────────────────────────────────────────────────
function drawGuard(c, t){
  if(!window.AB) return;
  const {rig, shadow}=AB.RIG;
  const gx=1206, G=FLOOR-2, s=1.05;
  // turns slightly + receiving hand dips as the coins arrive, then stashes them
  const turn=interp([PAY[0],PAY[1]],[0,0.10])(t);
  const handDip=interp([COIN[1]-0.18,COIN[1],PAY[1]],[0,12,5])(t);
  const pocket=interp([PAY[1]+0.1,PAY[1]+0.55],[0,1],E.easeInOutQuad)(t);
  shadow(c, gx, G+6, 118, 0.5);
  const A=rig(c,{ x:gx, ground:G, s, facing:1,
    pal:{ cloth:'#23222b', clothD:'#141319', under:'#0b0a10', skin:'#b98a6c',
      trim:'#c99b2e', rim:'rgba(255,207,122,0.95)', boot:'#0e0d13', glove:'#16151d' },
    hoodUp:false,
    lean:0.02+turn,
    footF:[32,186], footB:[-28,186],
    // near hand: open receiving palm → tucks the pouch away at the belt
    handF: pocket>0.02? [lerp(46,10,pocket), lerp(38,-46,pocket)] : [46, 38+handDip*0.3],
    bendF:1,
    handB:[-34,-30], bendB:-1,
    cape:0.3, capeSway:-0.03, skirt:1,
    eyes:0.5, eyeCol:WARM, rim:0.85 });
  // conical iron helm over the rig's head
  const hx=A.head[0], hy=A.head[1], hr=A.headR;
  c.fillStyle='#1a1a22';
  c.beginPath(); c.moveTo(hx-hr-7,hy-3); c.lineTo(hx+2, hy-hr*2.5); c.lineTo(hx+hr+7,hy-3); c.closePath(); c.fill();
  c.fillStyle='#26262f'; c.fillRect(hx-hr-9, hy-7, (hr+9)*2, 10);
  c.save(); c.globalAlpha=0.6; c.strokeStyle=WARM; c.lineWidth=2.4; c.shadowColor=WARM; c.shadowBlur=8;
  c.beginPath(); c.moveTo(hx+hr+5,hy-5); c.lineTo(hx+2,hy-hr*2.5); c.stroke(); c.restore();
  // halberd planted in the far hand
  const bx=A.handB[0], by=A.handB[1];
  c.save();
  c.strokeStyle='#2a1c10'; c.lineWidth=11; c.lineCap='round';
  c.beginPath(); c.moveTo(bx-4, G+22); c.lineTo(bx+6, G-520); c.stroke();
  c.fillStyle=STONE; c.beginPath(); c.moveTo(bx+6,G-514); c.lineTo(bx-32,G-488); c.lineTo(bx+4,G-462); c.closePath(); c.fill();
  c.fillStyle=STONE; c.beginPath(); c.moveTo(bx+6,G-524); c.lineTo(bx+12,G-556); c.lineTo(bx+18,G-524); c.closePath(); c.fill();
  // warm rim along the shaft
  c.globalAlpha=0.45; c.strokeStyle=WARM; c.lineWidth=2; c.shadowColor=WARM; c.shadowBlur=6;
  c.beginPath(); c.moveTo(bx+2, G-40); c.lineTo(bx+7, G-460); c.stroke();
  c.restore();
}

function drawBribe(c, t){
  const p=t;
  const prog=interp(COIN,[0,1],E.easeOutCubic)(p);
  if(prog<=0.001) return;
  // pouch path from lower-right up to the guard's palm
  const x=lerp(1330, 1252, prog), y=lerp(1010, FLOOR-152, prog);
  // the briber's cloaked arm reaches in from the lower right with the pouch
  const pull=interp([PAY[1], PAY[1]+0.45],[0,1],E.easeInQuad)(p);
  if(window.AB && pull<0.99){
    const {taper}=AB.RIG;
    const hx=x+pull*240, hy=y+pull*230;
    const sx=1680+pull*140, sy=1170;
    const ex=(hx+sx)/2+44, ey=(hy+sy)/2+64;
    c.save(); c.globalAlpha=1-pull;
    taper(c, sx,sy, ex,ey, 70,52, '#161016');
    taper(c, ex,ey, hx+8,hy+22, 50,30, '#1d141d');
    c.fillStyle='#241a24'; c.beginPath(); c.arc(hx+2,hy+16,20,0,Math.PI*2); c.fill();
    // warm rim along the sleeve (lit by the torch)
    c.globalAlpha=(1-pull)*0.5; c.strokeStyle=WARM; c.lineWidth=2.5; c.shadowColor=WARM; c.shadowBlur=8;
    c.beginPath(); c.moveTo(sx-24,sy-34); c.quadraticCurveTo(ex-18,ey-28, hx-4,hy+2); c.stroke();
    c.restore();
  }
  const settle=interp([COIN[1]-0.05,COIN[1]],[1,0])(p); // pouch fades as coins handed over
  if(settle>0.01){
    c.save(); c.globalAlpha=settle; c.translate(x,y);
    // coin pouch
    c.fillStyle='#3a2614'; c.beginPath(); c.ellipse(0,4,30,34,0,0,Math.PI*2); c.fill();
    c.fillStyle='#2a1b0e'; c.fillRect(-14,-30,28,14);
    c.strokeStyle='#1a1208'; c.lineWidth=4; c.beginPath(); c.moveTo(-14,-20); c.quadraticCurveTo(0,-12,14,-20); c.stroke();
    // spilling coins
    c.fillStyle=GOLD; c.shadowColor=GOLD; c.shadowBlur=10;
    for(let i=0;i<3;i++){ c.beginPath(); c.ellipse(-10+i*11,-26,7,4,0,0,Math.PI*2); c.fill(); }
    c.restore();
  }
  // sparkle on handoff
  const sp=interp([PAY[0],PAY[1]],[0,1])(p);
  if(sp>0 && sp<1){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-sp);
    const hx=1250, hy=FLOOR-150;
    c.strokeStyle=GOLD; c.lineWidth=3; c.shadowColor=GOLD; c.shadowBlur=14;
    for(let i=0;i<6;i++){ const a=i/6*6.283; const r=10+sp*40; c.beginPath(); c.moveTo(hx+Math.cos(a)*r*0.4,hy+Math.sin(a)*r*0.4); c.lineTo(hx+Math.cos(a)*r,hy+Math.sin(a)*r); c.stroke(); }
    c.fillStyle=GOLD; for(let i=0;i<4;i++){ const a=i/4*6.283+0.6; c.beginPath(); c.arc(hx+Math.cos(a)*(20+sp*30),hy+Math.sin(a)*(20+sp*30),3,0,Math.PI*2); c.fill(); }
    c.restore();
  }
}

// ── caption ───────────────────────────────────────────────────────────────────
function drawText(c, t){
  const o1=interp(TEXT1,[0,1],E.easeOutCubic)(t);
  const o2=interp(TEXT2,[0,1],E.easeOutCubic)(t);
  if(o1<=0.001 && o2<=0.001) return;
  const scrim=Math.max(o1,o2);
  c.save(); c.globalAlpha=scrim*0.9;
  c.fillStyle=vlin(c,0,872,0,FH,[[0,'rgba(8,5,2,0)'],[1,'rgba(6,4,2,0.94)']]); c.fillRect(0,872,FW,FH-872); c.restore();
  c.save(); c.textAlign='center'; c.textBaseline='middle';
  c.globalAlpha=o1; c.font='600 54px Cinzel, serif'; c.letterSpacing='3px';
  c.fillStyle=CREAM; c.shadowColor='rgba(0,0,0,0.85)'; c.shadowBlur=22;
  c.fillText('Buy potions.', 960, 952 + (1-o1)*16);
  c.globalAlpha=o2; c.font='700 66px Cinzel, serif'; c.letterSpacing='2px';
  c.fillStyle=GOLD; c.shadowColor='rgba(227,181,16,0.4)'; c.shadowBlur=28;
  c.fillText('Change the outcome.', 960, 1024 + (1-o2)*18);
  c.letterSpacing='0px';
  c.restore();
}

// ── master frame ──────────────────────────────────────────────────────────────
function drawFrame(t){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  ctx.fillStyle=INK; ctx.fillRect(0,0,FW,FH);

  ctx.save();
  applyCam(ctx, t);

  drawHall(ctx, t);
  drawPrison(ctx, t);
  drawGuard(ctx, t);
  drawStall(ctx, t);
  drawBribe(ctx, t);

  ctx.restore();

  // warm ambient grade + vignette (screen-space)
  ctx.save(); ctx.globalCompositeOperation='soft-light'; ctx.globalAlpha=0.5;
  ctx.fillStyle=radial(ctx,820,520,1100,[[0,'#ffcf7a'],[1,'#1a0e04']]); ctx.fillRect(0,0,FW,FH); ctx.restore();
  ctx.fillStyle=radial(ctx,960,540,1220,[[0.42,'rgba(0,0,0,0)'],[1,'rgba(8,5,2,0.82)']]);
  ctx.fillRect(0,0,FW,FH);

  // floating dust embers
  ctx.save(); ctx.globalCompositeOperation='screen';
  for(let i=0;i<22;i++){ const sp=6+(i%5)*3, life=frac(t*sp/100+(i*61%100)/100); const x=((i*113+20)%100)/100*FW+Math.sin(t*1.1+i)*24; const y=FH*(1-life*0.9);
    ctx.globalAlpha=Math.sin(life*Math.PI)*0.4; ctx.fillStyle='rgba(255,200,110,0.9)'; ctx.beginPath(); ctx.arc(x,y,1.4+(i%3),0,Math.PI*2); ctx.fill(); }
  ctx.restore();

  drawText(ctx, t);

  // open from black
  const fadeIn=interp([0,0.2],[1,0],E.easeOutQuad)(t);
  if(fadeIn>0.001){ ctx.save(); ctx.globalAlpha=fadeIn; ctx.fillStyle='#000'; ctx.fillRect(0,0,FW,FH); ctx.restore(); }
}

const clip: ClipConfig = {
  name: "black_market",
  bg: "#15120e",
  duration: DURATION,
  fadeFromBlack: false,
  draw(c, t, AB, assets) {
    ctx = c;
    drawFrame(t);
  },
};

export default clip;
