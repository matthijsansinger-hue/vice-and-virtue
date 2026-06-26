"use client";

// Plays a single canvas clip full-screen, then calls onDone. This is the
// React replacement for the handoff's per-file page chrome: it runs the same
// `draw(ctx, t, AB, assets, params)` functions on a 1920×1080 canvas, scaled to
// fill the viewport. Used by AnimationProvider (ability clips + phase stingers).
//
// Behaviour:
//  - delta-time requestAnimationFrame loop from t=0 to clip.duration (mirrors
//    the usePhaseClock pattern in SoulFragmentReveal.tsx), cancelled on unmount;
//  - loads clip.images first, passes them to draw() as `assets`;
//  - object-fit: cover so the (centered) action fills a portrait phone;
//  - tap anywhere to skip; honours prefers-reduced-motion by painting the
//    poster frame then finishing.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AB,
  FW,
  FH,
  type ClipAssets,
  type ClipConfig,
  type ClipParams,
} from "@/lib/animations/engine";

export function CanvasClip({
  clip,
  params,
  onDone,
  fit = "cover",
  skippable = true,
}: {
  clip: ClipConfig;
  params?: ClipParams;
  onDone: () => void;
  fit?: "cover" | "contain";
  skippable?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const doneRef = useRef(false);
  const [assets, setAssets] = useState<ClipAssets | null>(null);
  const [fontReady, setFontReady] = useState(false);

  // Resolve onDone exactly once (timer end OR tap-to-skip).
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    cancelAnimationFrame(rafRef.current);
    onDone();
  }, [onDone]);

  // The clips render text in literal 'Cinzel' (the brand display face). The app
  // self-hosts Cinzel under a hashed family name, so AnimationProvider also
  // links the CDN "Cinzel" family; wait for it here (with a hard cap) so the
  // first text frame isn't a serif flash.
  useEffect(() => {
    let settled = false;
    const ready = () => {
      if (!settled) {
        settled = true;
        setFontReady(true);
      }
    };
    try {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (fonts?.load) fonts.load("700 40px Cinzel").then(ready, ready);
      else ready();
    } catch {
      ready();
    }
    const id = window.setTimeout(ready, 800);
    return () => window.clearTimeout(id);
  }, []);

  // Preload any image assets the clip references (static + per-play dynamic);
  // start with {} when none.
  useEffect(() => {
    const entries = Object.entries({
      ...(clip.images ?? {}),
      ...(clip.imagesFor?.(params ?? {}) ?? {}),
    });
    if (entries.length === 0) {
      setAssets({});
      return;
    }
    let cancelled = false;
    let left = entries.length;
    const acc: ClipAssets = {};
    entries.forEach(([key, src]) => {
      const img = new Image();
      img.onload = img.onerror = () => {
        acc[key] = img;
        if (--left <= 0 && !cancelled) setAssets({ ...acc });
      };
      img.src = src;
    });
    return () => {
      cancelled = true;
    };
  }, [clip, params]);

  // Run the draw loop once the canvas + assets + font are ready.
  useEffect(() => {
    if (!assets || !fontReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const paint = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.clearRect(0, 0, FW, FH);
      if (clip.bg) {
        ctx.fillStyle = clip.bg;
        ctx.fillRect(0, 0, FW, FH);
      }
      clip.draw(ctx, t, AB, assets, params ?? {});
      // Universal open-from-black for shared-engine clips (the handoff's engine
      // added this in its own drawFrame; self-contained clips do their own).
      if (clip.fadeFromBlack) {
        const fadeIn = AB.interp([0, 0.1], [1, 0], AB.E.easeOutQuad)(
          t / clip.duration,
        );
        if (fadeIn > 0.001) {
          ctx.save();
          ctx.globalAlpha = fadeIn;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, FW, FH);
          ctx.restore();
        }
      }
    };

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      paint(clip.poster ?? clip.duration * 0.75);
      const id = window.setTimeout(finish, 400);
      return () => window.clearTimeout(id);
    }

    let start: number | null = null;
    const step = (ts: number) => {
      if (start == null) start = ts;
      const t = (ts - start) / 1000;
      paint(Math.min(t, clip.duration));
      if (t >= clip.duration) {
        finish();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [assets, fontReady, clip, params, finish]);

  return (
    <div
      onClick={skippable ? finish : undefined}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 140,
        background: "#050403",
        cursor: skippable ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        width={FW}
        height={FH}
        style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}
      />
      {skippable && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
            right: 18,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(255,239,197,0.55)",
            pointerEvents: "none",
            fontFamily: "var(--font-cinzel), Georgia, serif",
          }}
        >
          Tap to skip
        </span>
      )}
    </div>
  );
}
