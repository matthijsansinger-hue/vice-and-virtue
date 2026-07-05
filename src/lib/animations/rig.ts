// @ts-nocheck
/* eslint-disable */
// ── Vice & Virtue · character rig + staging for ability clips ───────────────
// Ported verbatim from the design handoff's `trailer/ability-rig.js` (the 2026
// rig rework). An articulated, hooded dark-fantasy character (two-bone IK
// limbs, cloak, tunic, boots, rim light) matching the painted card art mood,
// plus stage backdrops and prop drawing.
//
// The handoff attached this to `window.AB.RIG`; here it's a factory so the
// engine can hand in its own helpers without an import cycle:
// `engine.ts` calls `createRig({ lerp, clamp, frac, radial, vlin, CAMP })`
// and exposes the result as `AB.RIG` to every clip draw.

export function createRig(deps) {
  const { lerp, clamp, frac, radial, vlin, CAMP } = deps;

  // ── palettes (garment colors per camp, card-art mood) ─────────────────────
  const PAL = {
    vice:    { cloth:'#5a1620', clothD:'#380d16', under:'#16090d', skin:'#c9987a', trim:'#c99b2e',
               rim:'rgba(255,158,112,0.95)', boot:'#241014', glove:'#2e1216' },
    vice2:   { cloth:'#6e2030', clothD:'#43101d', under:'#190a0f', skin:'#b98a6c', trim:'#c99b2e',
               rim:'rgba(255,158,112,0.95)', boot:'#241014', glove:'#2e1216' },
    virtue:  { cloth:'#1d3a63', clothD:'#122442', under:'#0a1220', skin:'#c9a27e', trim:'#c99b2e',
               rim:'rgba(168,206,255,0.95)', boot:'#101a2c', glove:'#152238' },
    virtue2: { cloth:'#28527f', clothD:'#173252', under:'#0a1424', skin:'#b9926e', trim:'#c99b2e',
               rim:'rgba(168,206,255,0.95)', boot:'#101a2c', glove:'#152238' },
    neutral: { cloth:'#245448', clothD:'#153229', under:'#0a1512', skin:'#c9b28a', trim:'#c99b2e',
               rim:'rgba(216,255,246,0.95)', boot:'#102019', glove:'#152a22' },
    shade:   { cloth:'#1c1520', clothD:'#120d16', under:'#0a070d', skin:'#8a7263', trim:'#6e5a28',
               rim:'rgba(180,160,200,0.55)', boot:'#0e0a12', glove:'#141019' },
  };

  // two-bone IK: shoulder S → hand target H, lengths l1,l2, bend ±1.
  function ik(Sx,Sy, Hx,Hy, l1,l2, bend){
    let dx=Hx-Sx, dy=Hy-Sy, d=Math.hypot(dx,dy)||0.0001;
    const dc=Math.min(d, (l1+l2)*0.999);
    Hx=Sx+dx/d*dc; Hy=Sy+dy/d*dc; d=dc;
    const a=Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));
    const b=Math.atan2(Hy-Sy,Hx-Sx);
    const Ex=Sx+Math.cos(b - a*bend)*l1, Ey=Sy+Math.sin(b - a*bend)*l1;
    return [Ex,Ey,Hx,Hy];
  }
  function taper(c, x1,y1,x2,y2, w1,w2, col){
    const a=Math.atan2(y2-y1,x2-x1), p=a+Math.PI/2;
    c.fillStyle=col; c.beginPath();
    c.moveTo(x1+Math.cos(p)*w1/2, y1+Math.sin(p)*w1/2);
    c.lineTo(x2+Math.cos(p)*w2/2, y2+Math.sin(p)*w2/2);
    c.lineTo(x2-Math.cos(p)*w2/2, y2-Math.sin(p)*w2/2);
    c.lineTo(x1-Math.cos(p)*w1/2, y1-Math.sin(p)*w1/2);
    c.closePath(); c.fill();
    c.beginPath(); c.arc(x2,y2,w2/2,0,Math.PI*2); c.fill();
  }

  // ── the rig ────────────────────────────────────────────────────────────────
  // pose (all local units; hip at origin, +x = facing dir, y down; ~470 tall):
  //   x, ground (world y of feet), s, facing(1|-1), alpha
  //   hipH (default 186 — distance hip→ground), lean (rad), headTilt (rad), bow (0..1 head bow)
  //   handF/handB: [x,y] hand targets (F = near/front arm); bendF/bendB (default 1)
  //   footF/footB: [x,y] (default stand); kneeF/kneeB bend (default -1 → knees forward)
  //   relaxF/relaxB: true → arm hangs (ignores hand target)
  //   cape: 0..1 flare, capeSway rad; skirt: 0..1 (tunic skirt length factor)
  //   eyes: 0..1 glow, eyeCol; hoodUp (default true); rimSide (1|-1, default -facing→light from front)
  //   pal: palette object or camp name
  // returns world joints: {hip,chest,head,handF,handB,elbowF,elbowB,footF,footB}
  function rig(c, o){
    const s=o.s??1, facing=o.facing??1, hipH=o.hipH??186;
    const pal=typeof o.pal==='string'?PAL[o.pal]:(o.pal||PAL.shade);
    const lean=o.lean??0, bow=o.bow??0;
    const world=(px,py)=>[o.x+px*facing*s, o.ground-hipH*s+py*s];

    c.save();
    c.translate(o.x, o.ground-hipH*s);
    c.scale(facing*s, s);
    if(o.alpha!=null) c.globalAlpha*=o.alpha;

    // torso frame (leaned)
    const rot=(px,py)=>[px*Math.cos(lean)-py*Math.sin(lean), px*Math.sin(lean)+py*Math.cos(lean)];
    const [chX,chY]=rot(6,-150);            // chest
    const [nkX,nkY]=rot(8,-172);            // neck base
    const hdOff=rot(10+bow*14,-206+bow*10); // head center
    const hdX=hdOff[0], hdY=hdOff[1], hdR=31;
    const shF=rot(16,-146), shB=rot(-6,-146); // shoulders near/far

    const armU=80, armL=78, legU=96, legL2=96;
    const ground=hipH;
    // foot targets are authored against a 186 hip height; remap so "186" always
    // means "on the ground" even when hipH changes (crouch/lunge)
    const fmap=f=>[f[0], f[1]+(hipH-186)];
    const footF=fmap(o.footF||[26,186]), footB=fmap(o.footB||[-22,186]);
    const kneeF=o.kneeF??-1, kneeB=o.kneeB??-1;
    const [kFx,kFy,fFx,fFy]=ik(10,-6, footF[0],footF[1]-6, legU,legL2, kneeF);
    const [kBx,kBy,fBx,fBy]=ik(-10,-6, footB[0],footB[1]-6, legU,legL2, kneeB);

    // arm targets (default hang)
    const hangF=[shF[0]+10, shF[1]+armU+armL-18], hangB=[shB[0]-8, shB[1]+armU+armL-18];
    const tF=o.relaxF?hangF:(o.handF||hangF), tB=o.relaxB?hangB:(o.handB||hangB);
    const [eFx,eFy,hFx,hFy]=ik(shF[0],shF[1], tF[0],tF[1], armU,armL, o.bendF??1);
    const [eBx,eBy,hBx,hBy]=ik(shB[0],shB[1], tB[0],tB[1], armU,armL, o.bendB??1);

    // ── paint ──
    // cape behind (flares + sway)
    const capeF=o.cape??0.55, sway=o.capeSway??0;
    if(capeF>0.01){
      c.save(); c.fillStyle=pal.clothD;
      const hemY=ground-8, hemBack=-64-capeF*66, hemFwd=6+capeF*10;
      c.beginPath();
      c.moveTo(shB[0]-16, shB[1]-6);
      c.quadraticCurveTo(-46+sway*40, -60, hemBack+sway*90, hemY);
      c.quadraticCurveTo((hemBack+hemFwd)/2+sway*50, hemY+10, hemFwd+sway*30, hemY-4);
      c.quadraticCurveTo(10, -80, shF[0]+8, shF[1]-8);
      c.closePath(); c.fill();
      c.restore();
    }
    // far arm + far leg (underlayer color)
    taper(c, shB[0],shB[1], eBx,eBy, 26,20, pal.under);
    taper(c, eBx,eBy, hBx,hBy, 19,13, pal.under);
    c.fillStyle=pal.glove; c.beginPath(); c.arc(hBx,hBy,11,0,Math.PI*2); c.fill();
    taper(c, -10,-6, kBx,kBy, 34,24, pal.under);
    taper(c, kBx,kBy, fBx,fBy, 22,15, '#0b0709');
    // far boot
    c.fillStyle='#0b0709'; c.beginPath(); c.ellipse(fBx+7,fBy+2,17,8,0,0,Math.PI*2); c.fill();

    // near leg
    taper(c, 10,-6, kFx,kFy, 36,26, pal.clothD);
    taper(c, kFx,kFy, fFx,fFy, 24,16, pal.boot);
    c.fillStyle=pal.boot; c.beginPath(); c.ellipse(fFx+8,fFy+2,18,8,0,0,Math.PI*2); c.fill();
    c.fillStyle=pal.clothD; c.beginPath(); c.ellipse(kFx,kFy,15,11,0,0,Math.PI*2); c.fill();

    // tunic skirt
    const skirt=o.skirt??0.8;
    if(skirt>0.01){
      const skY=-2+64*skirt, spread=44+16*skirt;
      c.fillStyle=pal.cloth; c.beginPath();
      c.moveTo(-30,-38); c.lineTo(30,-38);
      c.quadraticCurveTo(spread+sway*20, skY*0.6, spread-8+sway*30, skY);
      c.lineTo(-spread+10+sway*26, skY);
      c.quadraticCurveTo(-spread-2+sway*16, skY*0.6, -30,-38);
      c.closePath(); c.fill();
    }
    // torso
    c.fillStyle=pal.cloth;
    c.beginPath();
    c.moveTo(-28,-30);
    c.quadraticCurveTo(-34,-96, shB[0]-22, shB[1]-4);
    c.quadraticCurveTo(chX-6, chY-34, shF[0]+20, shF[1]-6);
    c.quadraticCurveTo(34,-92, 30,-30);
    c.quadraticCurveTo(0,-16,-28,-30);
    c.closePath(); c.fill();
    // chest shading (far side darker)
    c.save(); c.globalAlpha=0.55; c.fillStyle=pal.clothD;
    c.beginPath(); c.moveTo(-28,-30); c.quadraticCurveTo(-34,-96, shB[0]-22, shB[1]-4);
    c.quadraticCurveTo(chX-14,chY-20, chX-10,-30); c.closePath(); c.fill(); c.restore();
    // belt + clasp
    c.fillStyle=pal.under; const b=rot(0,-44);
    c.save(); c.translate(b[0],b[1]); c.rotate(lean); c.fillRect(-31,-8,62,15);
    c.fillStyle=pal.trim; c.fillRect(-7,-6,14,11); c.restore();

    // head: neck, face hint, hood
    taper(c, nkX,nkY, hdX,hdY+hdR*0.5, 20,16, pal.skin);
    const hoodUp=o.hoodUp??true;
    // face (crescent lit from front)
    c.fillStyle=pal.skin;
    c.beginPath(); c.arc(hdX+4,hdY+3,hdR-6,-Math.PI*0.42,Math.PI*0.52); c.quadraticCurveTo(hdX+2,hdY+hdR-4,hdX-6,hdY+hdR-10); c.closePath(); c.fill();
    c.save(); c.globalAlpha=0.35; c.fillStyle=pal.under; c.beginPath(); c.arc(hdX+2,hdY+2,hdR-8,Math.PI*0.6,Math.PI*1.5); c.fill(); c.restore();
    if(hoodUp){
      c.fillStyle=pal.cloth;
      c.beginPath();
      c.moveTo(hdX-hdR-10, hdY+hdR*0.9);
      c.quadraticCurveTo(hdX-hdR-16, hdY-hdR*0.8, hdX-6, hdY-hdR-14);
      c.quadraticCurveTo(hdX+hdR*0.9, hdY-hdR-10, hdX+hdR+6, hdY-4);
      c.quadraticCurveTo(hdX+hdR+2, hdY+6, hdX+hdR-8, hdY+10);   // hood lip
      c.quadraticCurveTo(hdX+6, hdY-hdR+2, hdX-hdR+4, hdY+2);    // inner opening
      c.quadraticCurveTo(hdX-hdR+2, hdY+hdR*0.8, hdX-hdR-10, hdY+hdR*0.9);
      c.closePath(); c.fill();
      // inner hood shadow
      c.save(); c.globalAlpha=0.7; c.fillStyle=pal.under;
      c.beginPath(); c.moveTo(hdX-hdR+4,hdY+2); c.quadraticCurveTo(hdX+6,hdY-hdR+2,hdX+hdR-8,hdY+10);
      c.quadraticCurveTo(hdX+2,hdY+8,hdX-hdR+6,hdY+8); c.closePath(); c.fill(); c.restore();
    } else {
      // hair sweep
      c.fillStyle=pal.under; c.beginPath();
      c.arc(hdX-2,hdY-4,hdR+2,Math.PI*0.85,Math.PI*1.95); c.quadraticCurveTo(hdX+hdR,hdY-2,hdX+hdR-10,hdY+8);
      c.quadraticCurveTo(hdX+8,hdY-hdR*0.7,hdX-hdR,hdY+6); c.closePath(); c.fill();
    }
    // eye glint
    if(o.eyes>0.01){
      c.save(); c.globalAlpha=clamp(o.eyes,0,1); c.globalCompositeOperation='screen';
      c.fillStyle=o.eyeCol||'#ffcf7a'; c.shadowColor=o.eyeCol||'#ffcf7a'; c.shadowBlur=8;
      c.beginPath(); c.ellipse(hdX+12,hdY-1,4.6,2.6,0.08,0,Math.PI*2); c.fill();
      c.beginPath(); c.ellipse(hdX-6,hdY,4.2,2.4,-0.06,0,Math.PI*2); c.fill();
      c.restore();
    }

    // near arm (cloth sleeve)
    taper(c, shF[0],shF[1], eFx,eFy, 30,22, pal.cloth);
    taper(c, eFx,eFy, hFx,hFy, 20,14, pal.cloth);
    c.fillStyle=pal.glove; c.beginPath(); c.arc(hFx,hFy,11.5,0,Math.PI*2); c.fill();
    c.fillStyle=pal.cloth; c.beginPath(); c.arc(shF[0],shF[1],17,0,Math.PI*2); c.fill(); // shoulder pad
    c.save(); c.strokeStyle=pal.trim; c.globalAlpha=0.65; c.lineWidth=2.4;
    c.beginPath(); c.arc(shF[0],shF[1],16,-Math.PI*0.85,Math.PI*0.15); c.stroke(); c.restore();

    // rim light along the lit edge
    const rimA=o.rim??0.8;
    if(rimA>0.01){
      c.save(); c.globalAlpha=rimA; c.globalCompositeOperation='screen';
      c.strokeStyle=pal.rim; c.lineWidth=2.6; c.lineCap='round';
      c.shadowColor=pal.rim; c.shadowBlur=7;
      c.beginPath();
      if(hoodUp){ c.save(); c.globalAlpha=rimA*0.65; c.arc(hdX,hdY-4,hdR+7,-Math.PI*0.5,Math.PI*0.22); c.stroke(); c.restore(); c.beginPath(); }
      else { c.arc(hdX,hdY-2,hdR+1,-Math.PI*0.5,Math.PI*0.3); }
      c.stroke();
      c.beginPath(); c.moveTo(shF[0]+18,shF[1]-4);
      c.quadraticCurveTo(34,-92,30,-32); c.stroke();
      c.restore();
    }
    c.restore();

    return {
      hip:world(0,0), chest:world(chX*1,chY),
      head:world(hdX,hdY), headR:hdR*s,
      handF:world(hFx,hFy), handB:world(hBx,hBy),
      elbowF:world(eFx,eFy), elbowB:world(eBx,eBy),
      footF:world(fFx,fFy), footB:world(fBx,fBy),
      shoulderF:world(shF[0],shF[1]),
    };
  }

  // walking pose helper — phase in [0,1) is one full stride cycle.
  // Returns {footF, footB, handF, handB, hipBob} in rig-local coords.
  function walkPose(phase, stride=58, hipH=186){
    const a=phase*Math.PI*2;
    const fF=[Math.sin(a)*stride, hipH - Math.max(0,Math.cos(a))*26];
    const fB=[Math.sin(a+Math.PI)*stride, hipH - Math.max(0,Math.cos(a+Math.PI))*26];
    const hF=[26+Math.sin(a+Math.PI)*30, 10];
    const hB=[-18+Math.sin(a)*30, 8];
    return { footF:fF, footB:fB, handF:hF, handB:hB, hipBob:Math.abs(Math.sin(a))*7 };
  }

  // ── stage backdrops ────────────────────────────────────────────────────────
  // torch-lit stone chamber; camp-tinted. opts: {floorY (default 940), arches}
  function stage(c, t, camp, opts){
    opts=opts||{};
    const P=CAMP[camp]||CAMP.neutral;
    const floorY=opts.floorY??940;
    // wall
    c.fillStyle=vlin(c,0,0,0,floorY,[[0,'#181017'],[0.6,'#120b10'],[1,'#0a0609']]);
    c.fillRect(0,0,1920,floorY);
    // camp glow core behind the action
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.5;
    c.fillStyle=radial(c,960,floorY-320,900,[[0,P.key+'55'],[0.5,P.key+'22'],[1,'rgba(0,0,0,0)']]);
    c.fillRect(0,0,1920,floorY); c.restore();
    // stone block courses
    c.save(); c.globalAlpha=0.14; c.strokeStyle='#000'; c.lineWidth=3;
    for(let y=70;y<floorY-40;y+=86){ c.beginPath(); c.moveTo(0,y); c.lineTo(1920,y); c.stroke();
      const off=((y/86)|0)%2*105; for(let x=off;x<1920;x+=210){ c.beginPath(); c.moveTo(x,y); c.lineTo(x,y+86); c.stroke(); } }
    c.restore();
    // arched window glows
    if(opts.arches!==false){
      [[320,300],[1600,300]].forEach(([ax,ay],i)=>{
        const fl=0.75+0.25*Math.sin(t*7+i*2.4)*Math.sin(t*3+i);
        c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.5*fl;
        c.fillStyle=radial(c,ax,ay,300,[[0,'rgba(255,170,80,0.35)'],[1,'rgba(255,170,80,0)']]);
        c.fillRect(ax-320,ay-320,640,640); c.restore();
        // arch shape
        c.save(); c.fillStyle='rgba(255,190,110,0.13)';
        c.beginPath(); c.moveTo(ax-52,ay+130); c.lineTo(ax-52,ay-30); c.arc(ax,ay-30,52,Math.PI,0); c.lineTo(ax+52,ay+130); c.closePath(); c.fill();
        c.strokeStyle='rgba(0,0,0,0.5)'; c.lineWidth=8;
        c.beginPath(); c.moveTo(ax,ay-82); c.lineTo(ax,ay+130); c.moveTo(ax-52,ay+20); c.lineTo(ax+52,ay+20); c.stroke();
        c.restore();
      });
    }
    // floor
    c.fillStyle=vlin(c,0,floorY,0,1080,[[0,'#241820'],[0.5,'#170f15'],[1,'#0b070a']]);
    c.fillRect(0,floorY,1920,1080-floorY);
    // flagstone joints (converging)
    c.save(); c.globalAlpha=0.22; c.strokeStyle='#000'; c.lineWidth=3;
    for(let i=-6;i<=6;i++){ c.beginPath(); c.moveTo(960+i*150,floorY); c.lineTo(960+i*340,1080); c.stroke(); }
    [floorY+34,floorY+86,floorY+160].forEach(y=>{ c.beginPath(); c.moveTo(0,y); c.lineTo(1920,y); c.stroke(); });
    c.restore();
    // floor sheen under the action
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=0.4;
    c.fillStyle=radial(c,960,floorY+40,760,[[0,P.key+'44'],[1,'rgba(0,0,0,0)']]);
    c.fillRect(0,floorY-20,1920,1080-floorY+20); c.restore();
  }

  // contact shadow under a character
  function shadow(c, x, y, w, a=0.5){
    c.save(); c.globalAlpha=a; c.fillStyle='#000';
    c.beginPath(); c.ellipse(x,y,w,w*0.16,0,0,Math.PI*2); c.fill(); c.restore();
  }

  // ── props ──────────────────────────────────────────────────────────────────
  // dagger held at (x,y), pointing along ang; s scale
  function knife(c, x, y, ang, s=1){
    c.save(); c.translate(x,y); c.rotate(ang); c.scale(s,s);
    c.fillStyle='#2e1a10'; c.fillRect(-16,-5,20,10);            // grip
    c.fillStyle='#c99b2e'; c.fillRect(4,-11,7,22);              // guard
    const g=c.createLinearGradient(11,0,86,0); g.addColorStop(0,'#9aa6b2'); g.addColorStop(0.45,'#f2f7fd'); g.addColorStop(1,'#b9c4d1');
    c.fillStyle=g; c.beginPath(); c.moveTo(11,-7); c.lineTo(74,-3); c.lineTo(88,0); c.lineTo(74,3); c.lineTo(11,7); c.closePath(); c.fill();
    c.save(); c.globalAlpha=0.85; c.strokeStyle='#fff'; c.lineWidth=1.6;
    c.beginPath(); c.moveTo(14,-4); c.lineTo(76,-1); c.stroke(); c.restore();
    c.restore();
  }
  function sword(c, x, y, ang, s=1){
    c.save(); c.translate(x,y); c.rotate(ang); c.scale(s,s);
    c.fillStyle='#2e1a10'; c.fillRect(-26,-6,30,12);
    c.fillStyle='#c99b2e'; c.beginPath(); c.arc(-28,0,8,0,Math.PI*2); c.fill();
    c.fillStyle='#c99b2e'; c.fillRect(4,-20,10,40);
    const g=c.createLinearGradient(14,0,210,0); g.addColorStop(0,'#9aa6b2'); g.addColorStop(0.5,'#eef4fb'); g.addColorStop(1,'#c2ccd8');
    c.fillStyle=g; c.beginPath(); c.moveTo(14,-11); c.lineTo(190,-5); c.lineTo(212,0); c.lineTo(190,5); c.lineTo(14,11); c.closePath(); c.fill();
    c.save(); c.globalAlpha=0.85; c.strokeStyle='#fff'; c.lineWidth=2;
    c.beginPath(); c.moveTo(18,-6); c.lineTo(194,-1); c.stroke(); c.restore();
    c.restore();
  }
  // heater shield centered at (x,y); emblem: fn(c) drawn in ~±40 box
  function shield(c, x, y, s, pal, emblem){
    c.save(); c.translate(x,y); c.scale(s,s);
    c.fillStyle=pal.clothD||'#101a2c';
    c.beginPath(); c.moveTo(-52,-62); c.lineTo(52,-62); c.lineTo(52,22); c.quadraticCurveTo(0,88,-52,22); c.closePath(); c.fill();
    c.strokeStyle=pal.trim||'#c99b2e'; c.lineWidth=6;
    c.beginPath(); c.moveTo(-52,-62); c.lineTo(52,-62); c.lineTo(52,22); c.quadraticCurveTo(0,88,-52,22); c.closePath(); c.stroke();
    c.save(); c.globalAlpha=0.25; c.fillStyle='#fff';
    c.beginPath(); c.moveTo(-52,-62); c.lineTo(52,-62); c.lineTo(52,-38); c.lineTo(-52,-26); c.closePath(); c.fill(); c.restore();
    if(emblem){ c.save(); emblem(c); c.restore(); }
    c.restore();
  }
  // round iron-banded bomb at (x,y) radius r, with fuse spark at sparkT (0..1 → length)
  function bomb(c, x, y, r, t, sparkLen=1){
    c.save(); c.translate(x,y);
    const g=radial(c,-r*0.35,-r*0.35,r*1.9,[[0,'#3a3440'],[0.4,'#17131c'],[1,'#0a070d']]);
    c.fillStyle=g; c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.fill();
    c.save(); c.globalAlpha=0.5; c.strokeStyle='#000'; c.lineWidth=r*0.16;
    c.beginPath(); c.arc(0,0,r*0.82,-0.5,2.4); c.stroke(); c.restore();
    c.save(); c.globalAlpha=0.5; c.fillStyle='#8a93a2'; c.beginPath(); c.ellipse(-r*0.34,-r*0.4,r*0.22,r*0.13,-0.6,0,Math.PI*2); c.fill(); c.restore();
    c.fillStyle='#1c1420'; c.fillRect(-r*0.22,-r-r*0.28,r*0.44,r*0.32);
    // fuse
    const fx=0, fy=-r-r*0.24;
    c.strokeStyle='#5a4226'; c.lineWidth=Math.max(3,r*0.1); c.lineCap='round';
    c.beginPath(); c.moveTo(fx,fy); c.quadraticCurveTo(fx+r*0.5,fy-r*0.6, fx+r*0.28, fy-r*0.85*sparkLen - r*0.12); c.stroke();
    const sx=fx+r*0.28, sy=fy-r*0.85*sparkLen - r*0.12;
    c.save(); c.globalCompositeOperation='screen';
    c.fillStyle=radial(c,sx,sy,r*0.5,[[0,'#fff'],[0.35,'#ffb347'],[1,'rgba(255,120,40,0)']]);
    c.beginPath(); c.arc(sx,sy,r*0.45,0,Math.PI*2); c.fill();
    for(let i=0;i<6;i++){ const a2=frac(t*3.2+i*0.17)*6.283, rr=r*0.2+frac(t*2.3+i)*r*0.4;
      c.globalAlpha=(1-frac(t*2.3+i))*0.85; c.fillStyle='#ffd27a';
      c.beginPath(); c.arc(sx+Math.cos(a2)*rr, sy+Math.sin(a2)*rr, 2.4,0,Math.PI*2); c.fill(); }
    c.restore();
    c.restore();
  }
  // glowing heart centered (x,y), size s, col
  function heart(c, x, y, s, col, glow){
    c.save(); c.fillStyle=col; c.shadowColor=glow||col; c.shadowBlur=24;
    c.beginPath(); c.moveTo(x,y+s);
    c.bezierCurveTo(x+s*1.3,y-s*0.42,x+s*0.55,y-s*1.12,x,y-s*0.34);
    c.bezierCurveTo(x-s*0.55,y-s*1.12,x-s*1.3,y-s*0.42,x,y+s);
    c.closePath(); c.fill();
    c.save(); c.globalAlpha=0.55; c.fillStyle='#fff';
    c.beginPath(); c.arc(x-s*0.32,y-s*0.34,s*0.2,0,Math.PI*2); c.fill(); c.restore();
    c.restore();
  }
  // impact starburst
  function impact(c, x, y, p, col){
    if(p<=0.01) return;
    c.save(); c.globalCompositeOperation='screen'; c.globalAlpha=p;
    c.fillStyle=radial(c,x,y,95,[[0,'#fff'],[0.4,col+'b0'],[1,col+'00']]);
    c.beginPath(); c.arc(x,y,90,0,Math.PI*2); c.fill();
    c.strokeStyle='#fff'; c.lineWidth=4;
    for(let i=0;i<8;i++){ const a=i/8*6.283, r=32+p*46;
      c.beginPath(); c.moveTo(x+Math.cos(a)*17,y+Math.sin(a)*17); c.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r); c.stroke(); }
    c.restore();
  }

  return { PAL, rig, walkPose, stage, shadow, knife, sword, shield, bomb, heart, impact, ik, taper };
}
