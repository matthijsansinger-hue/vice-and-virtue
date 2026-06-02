"use client";

import { useEffect } from "react";

// Plays a short, soft "wooden knock" on every button / link /
// role=button press, app-wide, via a single document-level listener. The
// sound is synthesized with the Web Audio API so there's no audio file to
// ship, and the AudioContext is created/resumed inside the click handler
// so it satisfies browser autoplay rules (a click is a user gesture).
//
// The knock = a crisp filtered-noise transient (the contact) layered with
// a low, hollow, fast-decaying body resonance (the wood). No pitch sweep,
// so it reads as a medieval tock rather than an electronic blip.
export function ClickSound() {
  useEffect(() => {
    type WindowWithWebkit = Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtx =
      window.AudioContext ?? (window as WindowWithWebkit).webkitAudioContext;
    if (!AudioCtx) return; // unsupported browser — silently skip

    let ctx: AudioContext | null = null;
    let noiseBuffer: AudioBuffer | null = null;

    function makeNoiseBuffer(c: AudioContext): AudioBuffer {
      const len = Math.floor(c.sampleRate * 0.05);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }

    function playClick() {
      try {
        if (!ctx) {
          ctx = new AudioCtx!();
          noiseBuffer = makeNoiseBuffer(ctx);
        }
        if (ctx.state === "suspended") void ctx.resume();

        const now = ctx.currentTime;

        // Wood body — short and warm, just enough to give the click a
        // woody/fantasy thump under the snappy transient.
        const body = ctx.createOscillator();
        const bodyGain = ctx.createGain();
        body.type = "sine";
        body.frequency.setValueAtTime(300, now);
        body.frequency.exponentialRampToValueAtTime(250, now + 0.03);
        bodyGain.gain.setValueAtTime(0.0001, now);
        bodyGain.gain.exponentialRampToValueAtTime(0.1, now + 0.003);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
        body.connect(bodyGain).connect(ctx.destination);
        body.start(now);
        body.stop(now + 0.05);

        // A higher inharmonic partial for "woodiness".
        const ring = ctx.createOscillator();
        const ringGain = ctx.createGain();
        ring.type = "triangle";
        ring.frequency.setValueAtTime(520, now);
        ringGain.gain.setValueAtTime(0.0001, now);
        ringGain.gain.exponentialRampToValueAtTime(0.04, now + 0.002);
        ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        ring.connect(ringGain).connect(ctx.destination);
        ring.start(now);
        ring.stop(now + 0.04);

        // Dry, click-forward contact transient (the Minecraft-ish "tick"):
        // prominent, focused, and very short so the whole thing snaps.
        if (noiseBuffer) {
          const noise = ctx.createBufferSource();
          noise.buffer = noiseBuffer;
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.value = 1900;
          bp.Q.value = 1.3;
          const noiseGain = ctx.createGain();
          noiseGain.gain.setValueAtTime(0.0001, now);
          noiseGain.gain.exponentialRampToValueAtTime(0.13, now + 0.0008);
          noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
          noise.connect(bp).connect(noiseGain).connect(ctx.destination);
          noise.start(now);
          noise.stop(now + 0.03);
        }
      } catch {
        // Audio is non-critical; never let it break a click.
      }
    }

    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const clickable = target?.closest(
        'button, a, [role="button"], summary'
      );
      if (clickable) playClick();
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
