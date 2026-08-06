// @ts-nocheck
/* eslint-disable */
// Shared rig-based draw routines from the design handoff's 2026 rig rework.
// Each was defined identically in two export pages (PUNCH_HOSPITAL in
// Intoxication + Vengeance Hospitalise; CLOAK_REVEAL in the Worshipper/Seeker
// reveals; GUESS_LINEUP in their guess clips) — extracted once here. Called as
// HELPER(c, t, AB, opts) from the owning clip's draw.

export const PUNCH_HOSPITAL = function(c,t,AB,opts){
  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,impact,PAL}=AB.RIG;
  const P=AB.CAMP.vice; opts=opts||{};
  const G=940, Ax0=760, Vx=1140;

  stage(c,t,'vice');
  // hospital corner: cot at right + wall cross
  const cotX=1520, cotTop=806;
  (function cot(){
    c.fillStyle='#241318'; c.fillRect(cotX-190,cotTop+40,16,94); c.fillRect(cotX+174,cotTop+40,16,94);
    c.fillStyle='#3a2029'; c.beginPath(); c.roundRect(cotX-210,cotTop+10,420,34,8); c.fill();
    c.fillStyle='#4e3a41'; c.beginPath(); c.roundRect(cotX-210,cotTop-10,420,24,10); c.fill(); // mattress
    c.fillStyle='#5f4a50'; c.beginPath(); c.roundRect(cotX-206,cotTop-26,96,26,10); c.fill();  // pillow
    c.fillStyle='#241318'; c.fillRect(cotX-216,cotTop-64,14,110); // headboard
  })();
  // wall cross (glows once he lands)
  const crossGlow=interp([1.28,1.62],[0.12,1],E.easeOutCubic)(t);
  (function cross(){
    const cx2=cotX-6, cy2=580, a=15,b=52;
    c.save(); c.globalAlpha=crossGlow; c.shadowColor='#ff6a5a'; c.shadowBlur=30*crossGlow;
    c.fillStyle='#f4e6e6'; c.fillRect(cx2-a,cy2-b,a*2,b*2); c.fillRect(cx2-b,cy2-a,b*2,a*2);
    c.fillStyle=P.key; c.shadowBlur=0; const a2=9,b2=42; c.fillRect(cx2-a2,cy2-b2,a2*2,b2*2); c.fillRect(cx2-b2,cy2-a2,b2*2,a2*2);
    c.restore();
    AB.ring(c,cx2,cy2,interp([1.34,1.85],[0,1])(t),P.glow,40,300);
  })();

  // ── attacker timing ──
  const windup=interp([0.28,0.55],[0,1],E.easeOutCubic)(t);
  const punch=interp([0.55,0.72],[0,1],E.easeInCubic)(t);
  const settle=interp([0.85,1.35],[0,1],E.easeOutCubic)(t);
  const breathe=Math.sin(t*3.2)*0.02;

  // ── victim: standing → hit → flies back onto the cot ──
  const hitP=interp([0.68,0.78],[0,1],E.easeOutQuad)(t);
  const flyP=interp([0.74,1.30],[0,1],E.easeOutQuad)(t);
  const vHipX=lerp(Vx, cotX+40, flyP);
  const vHipY=lerp(G-186, cotTop-26, flyP) - Math.sin(flyP*Math.PI)*120;
  const vRot=lerp(0, Math.PI*0.46, interp([0.74,1.26],[0,1],E.easeOutCubic)(t));
  const headSnap=hitP*(1-flyP)*0.5;

  shadow(c, vHipX, G+6, lerp(120,150,flyP)*(1-flyP*0.5), 0.45*(1-flyP*0.4));
  c.save();
  c.translate(vHipX, vHipY); c.rotate(vRot); c.translate(-0,-0);
  rig(c,{ x:0, ground:186, s:0.97, facing:-1, pal:'shade',
    lean: -headSnap*0.7 + flyP*0.25, bow: headSnap*0.9,
    relaxF: flyP<0.2, relaxB: flyP<0.2,
    handF: flyP>=0.2?[ -40-flyP*50, -120+flyP*40 ]:null,
    handB: flyP>=0.2?[ 30-flyP*60, -150+flyP*60 ]:null,
    bendF:-1, bendB:1,
    footF:[ 30+flyP*40, 186 ], footB:[ -26-flyP*30, 186-flyP*20 ],
    cape:0.4, capeSway: -flyP*0.5, skirt:0.7, hipH:186,
    rim:0.65 });
  c.restore();

  // ── attacker ──
  const aLean = -0.16*windup + 0.34*punch - 0.18*settle + breathe;
  const aX = Ax0 - 26*windup + 178*punch - 60*settle;
  const cock=[ -54, -168 ], ext=[ 152, -196 ], hang=[ 30, -48 ];
  const hp=[ lerp(cock[0],ext[0],punch), lerp(cock[1],ext[1],punch) ];
  const hf=[ lerp(hp[0],hang[0],settle), lerp(hp[1],hang[1],settle) ];
  shadow(c, aX+10, G+6, 130, 0.5);
  const female=!!opts.female;
  const A=rig(c,{ x:aX, ground:G, s:1.0, facing:1, pal:female?'vice2':'vice',
    hoodUp:!female, skirt:female?1.0:0.75,
    lean:aLean, eyes:0.6+punch*0.4, eyeCol:'#ffb08a',
    handF: windup>0.02?hf:null, relaxF: windup<=0.02, bendF:1,
    handB:[ -36-windup*16+punch*30, -150-windup*10 ], bendB:-1,
    footF:[ 40+punch*104-settle*50, 186 ], footB:[ -44-windup*18, 186 ],
    kneeF:-1, kneeB:-1,
    cape:0.6, capeSway: -0.1*windup + 0.28*punch, skirt2:0,
    hipH: 186-8*punch, rim:0.9 });
  // clenched fist emphasis
  c.save(); c.fillStyle=PAL.vice.glove; c.beginPath(); c.arc(A.handF[0],A.handF[1],14,0,Math.PI*2); c.fill();
  c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.5*punch;
  c.strokeStyle='#ffb08a'; c.lineWidth=2.4; c.beginPath(); c.arc(A.handF[0],A.handF[1],15,-2.4,0.6); c.stroke(); c.restore(); c.restore();

  // punch speed lines (trail just behind the fist)
  if(punch>0.3 && punch<1 && flyP<0.4){
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-punch)*0.8;
    c.strokeStyle='#ffb08a'; c.lineWidth=3; c.lineCap='round';
    for(let i=0;i<4;i++){ const y=A.handF[1]-20+i*13;
      c.beginPath(); c.moveTo(A.handF[0]-130+i*10,y); c.lineTo(A.handF[0]-24,y); c.stroke(); }
    c.restore();
  }
  impact(c, Vx-28, 552, interp([0.69,0.76,1.0],[0,1,0])(t), '#ff8a5a');
  AB.motes(c,t,'rgba(255,120,90,0.5)',12);
  AB.grade(c,'vice',0.3);
};

export const CLOAK_REVEAL = function(c,t,AB,opts){
  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,PAL}=AB.RIG;
  const camp=opts.camp, P=AB.CAMP[camp];
  const pal=PAL[camp];
  const G=940, cx=960;

  stage(c,t,camp);

  const open=interp([0.35,0.7],[0,1],E.easeOutBack)(t)*interp([1.5,1.85],[1,0],E.easeInOutQuad)(t);
  const sig=interp([0.55,0.85],[0,1],E.easeOutCubic)(t)*interp([1.42,1.7],[1,0])(t);

  // figure — hands pull the cloak edges out and apart
  const hx=lerp(26,148,open), hy=lerp(-64,-190,open);
  shadow(c, cx, G+6, 140, 0.5);
  const A=rig(c,{ x:cx, ground:G, s:1.05, facing:1, pal:camp,
    lean: -0.04*open, bow: -0.1*open,
    handF:[ hx, hy ], bendF:-1,
    handB:[ -hx*0.94, hy+8 ], bendB:1,
    footF:[ 40, 186 ], footB:[ -40, 186 ],
    cape:0.85, capeSway:Math.sin(t*2)*0.03,
    skirt:0.85, eyes:0.4+sig*0.6, eyeCol:P.glow, rim:0.95 });

  // the cloak flaps, hanging from the shoulders to each hand
  c.save(); c.fillStyle=pal.clothD;
  const sh=[A.shoulderF[0]-30,A.shoulderF[1]-10];
  function flap(hand, dir){
    c.beginPath();
    c.moveTo(cx+dir*10, G-186-160);
    c.quadraticCurveTo(cx+dir*40, G-320, hand[0], hand[1]);
    c.quadraticCurveTo(hand[0]+dir*24, hand[1]+150, cx+dir*46, G-40);
    c.quadraticCurveTo(cx+dir*20, G-60, cx+dir*8, G-80);
    c.closePath(); c.fill();
  }
  flap(A.handF, 1); flap(A.handB, -1);
  // hands gripping the hems
  c.fillStyle=pal.glove;
  c.beginPath(); c.arc(A.handF[0],A.handF[1],12,0,Math.PI*2); c.fill();
  c.beginPath(); c.arc(A.handB[0],A.handB[1],11.5,0,Math.PI*2); c.fill();
  c.restore();

  // the burning sigil on the chest
  if(sig>0.01){
    const sx=cx+6, sy=G-186-150;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(sig,0,1);
    c.fillStyle=radial(c,sx,sy,150,[[0,P.key+'99'],[1,P.key+'00']]);
    c.fillRect(sx-170,sy-170,340,340);
    c.translate(sx,sy); const s=clamp(sig,0,1);
    c.scale(s,s);
    c.strokeStyle=P.soft; c.lineWidth=7; c.lineJoin='round'; c.shadowColor=P.glow; c.shadowBlur=22;
    if(opts.sigil==='triangle'){
      c.beginPath(); c.moveTo(0,-46); c.lineTo(42,30); c.lineTo(-42,30); c.closePath(); c.stroke();
      c.fillStyle=P.glow; c.beginPath(); c.arc(0,6,12,0,Math.PI*2); c.fill();
    } else {
      c.beginPath(); c.arc(0,0,42,0,Math.PI*2); c.stroke();
      c.fillStyle=P.glow; c.beginPath(); c.arc(0,0,13,0,Math.PI*2); c.fill();
      c.beginPath(); c.moveTo(0,-58); c.lineTo(0,-42); c.moveTo(0,42); c.lineTo(0,58);
      c.moveTo(-58,0); c.lineTo(-42,0); c.moveTo(42,0); c.lineTo(58,0); c.stroke();
    }
    c.restore();
    AB.ring(c,sx,sy,interp([0.6,1.2],[0,1])(t),P.glow,60,420);
  }
  AB.motes(c,t,camp==='vice'?'rgba(255,120,90,0.6)':'rgba(125,180,255,0.6)',14);
  AB.grade(c,camp,0.33);
};

export const GUESS_LINEUP = function(c,t,AB,opts){
  const {interp,E,lerp,clamp,radial}=AB;
  const {rig,stage,shadow,impact}=AB.RIG;
  const camp=opts.camp, P=AB.CAMP[camp], V=AB.CAMP[opts.emblemCamp];
  const G=955, xs=[440,700,960,1220,1480], target=opts.target;

  stage(c,t,camp,{floorY:955});

  const sweep=interp([0.18,0.8],[0,1],E.easeInOutQuad)(t);
  const lock=interp([0.8,0.95],[0,1])(t);
  const confirm=interp([0.95,1.3],[0,1],E.easeOutBack)(t);
  const strike=interp([1.32,1.7],[0,1],E.easeOutCubic)(t);
  const rx=lerp(xs[0], xs[target], sweep);

  xs.forEach((x,i)=>{
    const isT=i===target;
    const s=0.72;
    const jailed = isT && opts.mode==='jail' ? strike : 0;
    const dead   = isT && opts.mode==='kill' ? strike : 0;
    shadow(c, x, G+5, 95*(1-dead*0.3), 0.4);
    if(dead>0.02){
      const hy=lerp(G-186*s, G-40*s, dead);
      c.save(); c.translate(x+dead*36*s, hy); c.rotate(dead*Math.PI*0.42);
      c.globalAlpha=clamp(1-dead*0.25,0,1);
      rig(c,{ x:0, ground:186, s, facing:-1, pal:'shade', lean:-dead*0.2, bow:dead*0.5,
        relaxF:true, relaxB:true, cape:0.4, skirt:0.72, rim:0.5 });
      c.restore();
    } else {
      rig(c,{ x, ground:G, s, facing: i<2?1:(i>2?-1:1), pal:'shade',
        lean: Math.sin(t*1.8+i*1.7)*0.02 - (isT?confirm*0.08:0),
        bow: 0.04 + (isT?confirm*0.1:0),
        handF: isT&&confirm>0.1? [ 54, -180 ] : null, relaxF: !(isT&&confirm>0.1), bendF:-1,
        relaxB:true, footF:[ 26, 186 ], footB:[ -24, 186 ],
        cape:0.45, skirt:0.72,
        eyes: 0.25+(isT?confirm*0.75:0), eyeCol: isT?V.glow:'#ffd7b0',
        rim: 0.5+(isT?confirm*0.5:0) });
    }
    // the unmasked emblem above the target
    if(isT && confirm>0.02 && dead<0.5){
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(confirm,0,1)*0.8;
      c.fillStyle=radial(c,x,G-250,240,[[0,V.key+'88'],[1,V.key+'00']]);
      c.fillRect(x-260,G-500,520,520); c.restore();
      const ey=G-560-clamp(confirm,0,1)*10;
      c.save(); c.translate(x,ey); const sc=clamp(confirm,0,1); c.scale(sc,sc);
      c.strokeStyle=V.soft; c.lineWidth=6; c.lineJoin='round'; c.shadowColor=V.glow; c.shadowBlur=16;
      if(opts.emblem==='circle'){ c.beginPath(); c.arc(0,0,26,0,Math.PI*2); c.stroke();
        c.fillStyle=V.glow; c.beginPath(); c.arc(0,0,9,0,Math.PI*2); c.fill(); }
      else { c.beginPath(); c.moveTo(0,-26); c.lineTo(24,16); c.lineTo(-24,16); c.closePath(); c.stroke();
        c.fillStyle=V.glow; c.beginPath(); c.arc(0,2,8,0,Math.PI*2); c.fill(); }
      c.restore();
    }
    // jail bars slam down on the target
    if(jailed>0.01){
      const topY=G-186*s-380*s;
      const drop=E.easeOutCubic(jailed);
      c.save(); c.globalAlpha=clamp(jailed*1.4,0,1);
      c.strokeStyle='#cfd6de'; c.lineWidth=11; c.lineCap='round';
      c.shadowColor='rgba(0,0,0,0.5)'; c.shadowBlur=8;
      for(let k=-2;k<=2;k++){ const bx=x+k*44;
        c.beginPath(); c.moveTo(bx,topY); c.lineTo(bx,topY+((G-16)-topY)*drop); c.stroke(); }
      if(drop>0.6){ c.lineWidth=9;
        [topY+80, G-100].forEach(yy=>{ c.beginPath(); c.moveTo(x-104,yy); c.lineTo(x+104,yy); c.stroke(); }); }
      c.restore();
      if(drop>0.92){ c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=(1-(drop-0.92)/0.08)*0.4;
        c.fillStyle=radial(c,x,G-16,150,[[0,'rgba(210,225,255,0.5)'],[1,'rgba(210,225,255,0)']]);
        c.fillRect(x-170,G-120,340,140); c.restore(); }
    }
  });

  // reticle
  if(t<1.34){
    const ry=G-330, R=clamp(lerp(120,84,lock),70,130);
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=clamp(0.5+lock*0.5,0,1);
    c.translate(rx,ry); c.rotate(t*0.9);
    c.strokeStyle=lock>0.5?P.glow:P.soft; c.lineWidth=4; c.shadowColor=P.glow; c.shadowBlur=16;
    c.beginPath(); c.arc(0,0,R,0,Math.PI*2); c.stroke();
    for(let i=0;i<4;i++){ const aa=i/4*6.283;
      c.beginPath(); c.moveTo(Math.cos(aa)*(R-16),Math.sin(aa)*(R-16)); c.lineTo(Math.cos(aa)*(R+16),Math.sin(aa)*(R+16)); c.stroke(); }
    c.restore();
  }
  // kill slash on the confirmed target
  if(opts.mode==='kill'){
    const slash=interp([1.3,1.4,1.68],[0,1,0])(t);
    if(slash>0.01){
      const ix=xs[target], iy=G-320;
      c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=slash;
      c.strokeStyle=P.glow; c.lineWidth=10; c.shadowColor=P.glow; c.shadowBlur=26; c.lineCap='round';
      c.beginPath(); c.moveTo(ix-130,iy-110); c.lineTo(ix+130,iy+110); c.stroke();
      c.strokeStyle='#fff'; c.lineWidth=4;
      c.beginPath(); c.moveTo(ix-130,iy-110); c.lineTo(ix+130,iy+110); c.stroke();
      c.restore();
    }
    impact(c, xs[target], G-320, interp([1.32,1.42,1.66],[0,1,0])(t), P.glow);
  }
  AB.ring(c,xs[target],G-320,interp([1.35,1.85],[0,1])(t),P.glow,40,340);
  AB.motes(c,t,camp==='vice'?'rgba(255,120,90,0.5)':'rgba(125,180,255,0.6)',12);
  AB.grade(c,camp,0.32);
};
