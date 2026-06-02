// Shared Web Audio synthesis: a UI click and the castle-entry whoosh.
// All sounds run through ONE lazily-created AudioContext so they share
// the same unlock — ClickSound resumes it on the first tap, so by the
// time the lore intro plays the whoosh the context is already running.
// Everything is synthesized (no audio files) and fails silently.

type WindowWithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let clickNoise: AudioBuffer | null = null;
let whooshNoise: AudioBuffer | null = null;

function makeNoise(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
  if (!AC) return null;
  try {
    if (!ctx) {
      ctx = new AC();
      clickNoise = makeNoise(ctx, 0.05);
      whooshNoise = makeNoise(ctx, 2);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Snappy wooden "tock" — a dry contact tick over a short warm body.
export function playClick(): void {
  const c = getCtx();
  if (!c) return;
  try {
    const now = c.currentTime;

    const body = c.createOscillator();
    const bodyGain = c.createGain();
    body.type = "sine";
    body.frequency.setValueAtTime(300, now);
    body.frequency.exponentialRampToValueAtTime(250, now + 0.03);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.1, now + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    body.connect(bodyGain).connect(c.destination);
    body.start(now);
    body.stop(now + 0.05);

    const ring = c.createOscillator();
    const ringGain = c.createGain();
    ring.type = "triangle";
    ring.frequency.setValueAtTime(520, now);
    ringGain.gain.setValueAtTime(0.0001, now);
    ringGain.gain.exponentialRampToValueAtTime(0.04, now + 0.002);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    ring.connect(ringGain).connect(c.destination);
    ring.start(now);
    ring.stop(now + 0.04);

    if (clickNoise) {
      const noise = c.createBufferSource();
      noise.buffer = clickNoise;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1900;
      bp.Q.value = 1.3;
      const noiseGain = c.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.13, now + 0.0008);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
      noise.connect(bp).connect(noiseGain).connect(c.destination);
      noise.start(now);
      noise.stop(now + 0.03);
    }
  } catch {
    /* audio is non-critical */
  }
}

// Rushing-through-space whoosh for the castle-entry zoom. An airy noise
// band that opens up and speeds up, plus a rising sub-thrust, building to
// a peak at the end (the moment you "hit" the castle / the screen blacks
// out) then fading. `durationMs` should match the zoom motion length.
export function playWhoosh(durationMs: number): void {
  const c = getCtx();
  if (!c || !whooshNoise) return;
  try {
    const now = c.currentTime;
    const dur = durationMs / 1000;
    const tail = 0.5; // fade out during the fade-to-black

    // Deep, muffled rush: looped noise kept dark (lowpass only opens to
    // a low-mid, not bright) with a gentle speed-up. No bright hiss, so
    // it reads as a cavernous space rush rather than a leafblower.
    const src = c.createBufferSource();
    src.buffer = whooshNoise;
    src.loop = true;
    src.playbackRate.setValueAtTime(0.6, now);
    src.playbackRate.linearRampToValueAtTime(1.1, now + dur);

    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 60; // just trims subsonic rumble, lets lows through

    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(220, now);
    lp.frequency.exponentialRampToValueAtTime(2600, now + dur);
    lp.Q.value = 0.5;

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04, now + dur * 0.45);
    gain.gain.exponentialRampToValueAtTime(0.14, now + dur); // peak at climax
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + tail);

    src.connect(hp).connect(lp).connect(gain).connect(c.destination);
    src.start(now);
    src.stop(now + dur + tail + 0.1);

    // Smooth deep sub — the "soul rushing through the void" body. Sine
    // (not sawtooth) keeps it round and boomy rather than buzzy, and it
    // stays low so the whole thing sits in space, not a engine.
    const sub = c.createOscillator();
    const subLp = c.createBiquadFilter();
    const subGain = c.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(32, now);
    sub.frequency.exponentialRampToValueAtTime(110, now + dur);
    subLp.type = "lowpass";
    subLp.frequency.value = 240;
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.exponentialRampToValueAtTime(0.13, now + dur);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + dur + tail);
    sub.connect(subLp).connect(subGain).connect(c.destination);
    sub.start(now);
    sub.stop(now + dur + tail + 0.1);
  } catch {
    /* audio is non-critical */
  }
}

// Heavy prison doors shutting: a low slam thud + an inharmonic metallic
// clang + a crash transient, followed by a latch/lock clunk.
export function playPrisonDoor(): void {
  const c = getCtx();
  if (!c) return;
  try {
    const now = c.currentTime;
    const master = c.createGain();
    master.gain.value = 0.6;
    master.connect(c.destination);

    // Low slam thud (the gate hitting the frame).
    const thud = c.createOscillator();
    const thudG = c.createGain();
    thud.type = "sine";
    thud.frequency.setValueAtTime(90, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.18);
    thudG.gain.setValueAtTime(0.0001, now);
    thudG.gain.exponentialRampToValueAtTime(0.32, now + 0.01);
    thudG.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    thud.connect(thudG).connect(master);
    thud.start(now);
    thud.stop(now + 0.42);

    // Inharmonic metallic clang (iron bars ringing), fast decay.
    const partials = [523, 770, 1170, 1730, 2550];
    partials.forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "square";
      o.frequency.value = f;
      const peak = 0.05 / (i * 0.5 + 1);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35 - i * 0.04);
      o.connect(g).connect(master);
      o.start(now);
      o.stop(now + 0.4);
    });

    // Metal-on-stone crash transient (short band-passed noise).
    if (clickNoise) {
      const noise = c.createBufferSource();
      noise.buffer = clickNoise;
      noise.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2800;
      bp.Q.value = 0.7;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(0.12, now + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      noise.connect(bp).connect(ng).connect(master);
      noise.start(now);
      noise.stop(now + 0.14);
    }

    // Latch / lock clunk a moment after the slam.
    const t1 = now + 0.28;
    const latch = c.createOscillator();
    const latchG = c.createGain();
    latch.type = "square";
    latch.frequency.setValueAtTime(300, t1);
    latch.frequency.exponentialRampToValueAtTime(160, t1 + 0.05);
    latchG.gain.setValueAtTime(0.0001, t1);
    latchG.gain.exponentialRampToValueAtTime(0.14, t1 + 0.004);
    latchG.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.12);
    latch.connect(latchG).connect(master);
    latch.start(t1);
    latch.stop(t1 + 0.14);
  } catch {
    /* audio is non-critical */
  }
}

// A short victory SONG played on the win screens.
//   Virtue = a regal, happy royal march (brass theme over I–IV–V–I, with
//            timpani + a cheering crowd).
//   Vice   = a medieval defeat dirge inspired by the Brawl Stars lose
//            jingle: a descending brass line ending in a sad-trombone
//            downward bend, over a low minor drone + slow funeral drum.
export function playVictoryMusic(camp: "vice" | "virtue"): void {
  const c = getCtx();
  if (!c) return;
  try {
    const now = c.currentTime;
    const master = c.createGain();
    master.gain.value = 0.5;
    master.connect(c.destination);

    const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

    // Brass / trumpet voice. Optional `bendToMidi` glides the pitch down
    // over the note (the sad-trombone effect).
    const brass = (
      midi: number,
      start: number,
      dur: number,
      peak: number,
      bendToMidi?: number
    ) => {
      const t0 = now + start;
      const f = hz(midi);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3000;
      lp.Q.value = 3;
      const g = c.createGain();
      const sustain = Math.max(0.0001, peak * 0.78);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(sustain, t0 + 0.14);
      g.gain.setValueAtTime(sustain, t0 + Math.max(0.15, dur - 0.12));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      lp.connect(g).connect(master);
      for (const detune of [-6, 6]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.detune.value = detune;
        o.frequency.setValueAtTime(f * 0.99, t0);
        o.frequency.exponentialRampToValueAtTime(f, t0 + 0.04);
        if (bendToMidi !== undefined) {
          o.frequency.exponentialRampToValueAtTime(hz(bendToMidi), t0 + dur);
        }
        o.connect(lp);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
      }
    };

    // Sustained chord pad (strings/choir-ish): detuned saws, slow attack.
    const pad = (midis: number[], start: number, dur: number, peak: number) => {
      const t0 = now + start;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1800;
      lp.Q.value = 0.4;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.2);
      g.gain.setValueAtTime(peak, t0 + Math.max(0.25, dur - 0.5));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      lp.connect(g).connect(master);
      for (const m of midis) {
        for (const detune of [-5, 5]) {
          const o = c.createOscillator();
          o.type = "sawtooth";
          o.detune.value = detune;
          o.frequency.value = hz(m);
          o.connect(lp);
          o.start(t0);
          o.stop(t0 + dur + 0.05);
        }
      }
    };

    const bassNote = (midi: number, start: number, dur: number, peak: number) => {
      const t0 = now + start;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "triangle";
      o.frequency.value = hz(midi);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    };

    // A drum / timpani thump.
    const drum = (start: number, peak: number) => {
      const t0 = now + start;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(130, t0);
      o.frequency.exponentialRampToValueAtTime(48, t0 + 0.16);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + 0.35);
    };

    // Crowd: band-passed noise that swells with a tremolo (many voices).
    const crowd = (start: number, dur: number, peak: number) => {
      if (!whooshNoise) return;
      const t0 = now + start;
      const src = c.createBufferSource();
      src.buffer = whooshNoise;
      src.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 500;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1600;
      bp.Q.value = 0.5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.6);
      g.gain.setValueAtTime(peak, t0 + Math.max(0.7, dur - 1.0));
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 6;
      const lfoGain = c.createGain();
      lfoGain.gain.value = peak * 0.3;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(hp).connect(bp).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.1);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.1);
    };

    if (camp === "virtue") {
      // Royal march in C major: cheering crowd, timpani, bass roots, a
      // string pad on I–IV–V–I, and a regal brass theme that resolves
      // up to a triumphant high C.
      crowd(0, 9.5, 0.07);
      pad([60, 64, 67], 0.0, 2.0, 0.04); // C
      pad([65, 69, 72], 2.0, 2.0, 0.04); // F
      pad([67, 71, 74], 4.0, 2.0, 0.04); // G
      pad([60, 64, 67, 72], 6.0, 3.3, 0.045); // C (final)
      bassNote(36, 0.0, 2.0, 0.09); // C2
      bassNote(41, 2.0, 2.0, 0.09); // F2
      bassNote(43, 4.0, 2.0, 0.09); // G2
      bassNote(36, 6.0, 3.3, 0.09); // C2
      drum(0.0, 0.16);
      drum(2.0, 0.14);
      drum(4.0, 0.14);
      drum(6.0, 0.16);
      drum(7.6, 0.16);
      // Heralding fanfare.
      brass(67, 0.0, 0.3, 0.09); // G4
      brass(72, 0.3, 0.3, 0.09); // C5
      brass(76, 0.6, 0.3, 0.09); // E5
      brass(79, 0.9, 0.6, 0.1); // G5
      // Royal theme.
      brass(76, 1.6, 0.4, 0.09); // E5
      brass(77, 2.0, 0.4, 0.09); // F5
      brass(76, 2.4, 0.4, 0.09); // E5
      brass(74, 2.8, 0.4, 0.09); // D5
      brass(72, 3.2, 0.7, 0.1); // C5
      brass(74, 4.0, 0.4, 0.09); // D5
      brass(76, 4.4, 0.4, 0.09); // E5
      brass(74, 4.8, 0.4, 0.09); // D5
      brass(71, 5.2, 0.7, 0.09); // B4
      // Resolve + triumphant arrival.
      brass(72, 6.0, 0.5, 0.1); // C5
      brass(76, 6.5, 0.5, 0.1); // E5
      brass(79, 7.0, 0.6, 0.1); // G5
      brass(84, 7.6, 1.6, 0.11); // C6 (held)
      pad([72, 76, 79], 7.6, 1.7, 0.04); // chord under the high C
    } else {
      // Defeat dirge in A minor: low drone, slow funeral drum, a
      // descending brass line, then the Brawl-Stars-style sad-trombone
      // bend, resolving to a low minor chord.
      pad([45, 48, 52], 0.0, 6.2, 0.05); // A minor drone (A2 C3 E3)
      bassNote(33, 0.0, 3.0, 0.08); // A1
      bassNote(33, 3.0, 3.2, 0.08);
      drum(0.0, 0.15);
      drum(1.5, 0.13);
      drum(3.0, 0.13);
      drum(4.5, 0.13);
      // Descending dirge.
      brass(69, 0.0, 0.5, 0.085); // A4
      brass(69, 0.6, 0.4, 0.085); // A4
      brass(67, 1.0, 0.5, 0.085); // G4
      brass(65, 1.6, 0.6, 0.085); // F4
      brass(64, 2.4, 0.8, 0.085); // E4
      brass(62, 3.4, 1.0, 0.085); // D4
      // Sad-trombone "womp womp womp" + the deflating downward bend.
      brass(65, 4.6, 0.4, 0.09); // F4
      brass(64, 5.05, 0.4, 0.09); // E4
      brass(62, 5.5, 0.4, 0.09); // D4
      brass(62, 6.0, 1.9, 0.1, 55); // D4 → G3 (bend)
      // Final low minor chord, fading out.
      pad([45, 48, 52], 6.2, 3.4, 0.06);
      bassNote(33, 6.2, 3.4, 0.08);
    }
  } catch {
    /* audio is non-critical */
  }
}
