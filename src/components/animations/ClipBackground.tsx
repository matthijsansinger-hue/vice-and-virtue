"use client";

// Plays a canvas clip as a plain background — no scrim, quote, skip prompt, or
// fixed full-screen overlay (that's CanvasClip). Fills its parent; other UI
// (e.g. the imprisonment name + Continue button) layers on top. Plays once and
// holds the final frame; honours prefers-reduced-motion by painting one frame.

import { useEffect, useRef, useState } from "react";
import {
  AB,
  FW,
  FH,
  type ClipAssets,
  type ClipConfig,
} from "@/lib/animations/engine";

export function ClipBackground({
  clip,
  className,
  loop = false,
}: {
  clip: ClipConfig;
  className?: string;
  loop?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const [assets, setAssets] = useState<ClipAssets | null>(null);

  // Preload the clip's images before drawing.
  useEffect(() => {
    const entries = Object.entries(clip.images ?? {});
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
  }, [clip]);

  useEffect(() => {
    if (!assets) return;
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
      clip.draw(ctx, t, AB, assets, {});
    };

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      paint(clip.poster ?? clip.duration * 0.5);
      return;
    }

    let start: number | null = null;
    const step = (ts: number) => {
      if (start == null) start = ts;
      let t = (ts - start) / 1000;
      if (loop && t >= clip.duration) {
        start = ts; // seamless restart (the abyss ends + opens on black)
        t = 0;
      }
      paint(Math.min(t, clip.duration));
      if (loop || t < clip.duration) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [assets, clip, loop]);

  return (
    <canvas
      ref={canvasRef}
      width={FW}
      height={FH}
      className={className}
      style={{ display: "block" }}
      aria-hidden
    />
  );
}
