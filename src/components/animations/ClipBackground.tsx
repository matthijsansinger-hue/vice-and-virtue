"use client";

// Plays a canvas clip as a plain background — no scrim, quote, skip prompt, or
// fixed full-screen overlay (that's CanvasClip). Fills its parent; other UI
// (e.g. the imprisonment name + Continue button) layers on top. Plays once and
// holds the final frame; honours prefers-reduced-motion by painting one frame.
//
// Like CanvasClip, a clip that ships a recording (clip.video) plays that in a
// <video> instead of the live canvas draw, falling back to the canvas if the
// file can't load/decode or prefers-reduced-motion is on.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AB,
  FW,
  FH,
  type ClipAssets,
  type ClipConfig,
} from "@/lib/animations/engine";

function canPlayClipVideo(src: string): boolean {
  if (typeof document === "undefined") return false;
  const type = src.endsWith(".webm") ? "video/webm" : "video/mp4";
  try {
    return document.createElement("video").canPlayType(type) !== "";
  } catch {
    return false;
  }
}

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef(0);
  const [assets, setAssets] = useState<ClipAssets | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [reduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const videoPlayable = useMemo(
    () => (clip.video ? canPlayClipVideo(clip.video) : false),
    [clip.video],
  );
  const videoMode =
    !!clip.video && videoPlayable && !videoFailed && !reduceMotion;

  // Recorded-video driver: start playback, fall back to the canvas if no frame
  // arrives within the watchdog window.
  useEffect(() => {
    if (!videoMode) return;
    const v = videoRef.current;
    if (!v) return;
    let gotData = false;
    const onData = () => {
      gotData = true;
    };
    v.addEventListener("loadeddata", onData);
    const watchdog = window.setTimeout(() => {
      if (!gotData) setVideoFailed(true);
    }, 5000);
    v.play().catch(() => setVideoFailed(true));
    return () => {
      v.removeEventListener("loadeddata", onData);
      window.clearTimeout(watchdog);
    };
  }, [videoMode]);

  // Preload the clip's images before drawing (canvas path only).
  useEffect(() => {
    if (videoMode) return;
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
  }, [clip, videoMode]);

  useEffect(() => {
    if (videoMode) return;
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
  }, [assets, clip, loop, videoMode]);

  if (videoMode) {
    return (
      <video
        ref={videoRef}
        src={clip.video}
        muted
        playsInline
        autoPlay
        preload="auto"
        loop={loop}
        className={className}
        style={{ display: "block", objectFit: "cover" }}
        onError={() => setVideoFailed(true)}
        aria-hidden
      />
    );
  }

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
