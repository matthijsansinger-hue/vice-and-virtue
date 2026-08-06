"use client";

// Plays a single canvas clip full-screen. Two end behaviours:
//  - holdForClick (ability animations): plays once, then HOLDS the final frame
//    and waits — the viewer clicks (any time, even mid-clip) to continue.
//  - auto (phase stingers, lore intro): finishes at clip.duration on its own.
//
// Other behaviour:
//  - clips with a `video` recording (public/animations/*) play that in a
//    <video> instead of the live canvas — weak devices get a smooth clip — and
//    fall back to the canvas draw if the file can't load/play (or the browser
//    can't decode it, or prefers-reduced-motion is on);
//  - delta-time requestAnimationFrame loop, cancelled on unmount;
//  - `clip.sourceDuration` (when shorter than duration) slows the clip to fill it;
//  - a CSS opacity envelope fades the overlay in on appear and out on
//    end/dismiss (set fadeOut={false} to hold the final frame, e.g. the lore
//    intro which ends on black);
//  - a per-clip quote (QUOTE_BY_CLIP) is shown over the ability animations;
//  - loads clip.images first; object-fit: cover; honours prefers-reduced-motion.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AB,
  FW,
  FH,
  type ClipAssets,
  type ClipConfig,
  type ClipParams,
} from "@/lib/animations/engine";
import { QUOTE_BY_CLIP } from "@/lib/animations/quotes";

const FADE_MS = 350;
const FADE_S = FADE_MS / 1000;

// Can this browser decode the recording at all? (e.g. old Safari has no WebM.)
function canPlayClipVideo(src: string): boolean {
  if (typeof document === "undefined") return false;
  const type = src.endsWith(".webm") ? "video/webm" : "video/mp4";
  try {
    return document.createElement("video").canPlayType(type) !== "";
  } catch {
    return false;
  }
}

export function CanvasClip({
  clip,
  params,
  onDone,
  fit = "cover",
  skippable = true,
  fadeOut = true,
  fadeIn = true,
  holdForClick = false,
}: {
  clip: ClipConfig;
  params?: ClipParams;
  onDone: () => void;
  fit?: "cover" | "contain";
  skippable?: boolean;
  fadeOut?: boolean;
  fadeIn?: boolean;
  holdForClick?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef(0);
  const doneRef = useRef(false);
  const dismissingRef = useRef(false);
  const fadeInRef = useRef(false);
  const fadeOutRef = useRef(false);
  const [assets, setAssets] = useState<ClipAssets | null>(null);
  const [fontReady, setFontReady] = useState(false);
  // fadeIn={false} starts fully opaque so the clip covers whatever's behind it
  // immediately (used by the lore intro so the old castle never shows through).
  const [opacity, setOpacity] = useState(fadeIn ? 0 : 1);
  const [chromeIn, setChromeIn] = useState(false);

  // Recorded-video path: preferred when the clip ships a recording, dropped
  // for the live canvas draw on decode failure / missing file / reduced motion.
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

  const quote = QUOTE_BY_CLIP[clip.name];
  const clickable = holdForClick || skippable;

  // Keep the latest onDone in a ref so the draw-loop effect doesn't depend on
  // its identity. Callers routinely pass an inline arrow (onDone={() => …}),
  // which is a new function every render; if the effect depended on it, every
  // parent re-render (e.g. realtime room updates) would tear down and restart
  // the loop from t=0 — the "animation replays over and over / looks choppy" bug.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // Resolve onDone exactly once. Stable identity (reads the ref).
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    cancelAnimationFrame(rafRef.current);
    onDoneRef.current();
  }, []);

  // Click → fade the overlay out, then continue (works any time).
  const dismiss = useCallback(() => {
    if (doneRef.current || dismissingRef.current) return;
    dismissingRef.current = true;
    setOpacity(0);
    window.setTimeout(finish, FADE_MS);
  }, [finish]);

  // Wait (capped) for the brand "Cinzel" face the clips + quote use.
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

  // Fade the quote + prompt in shortly after the clip opens.
  useEffect(() => {
    const id = window.setTimeout(() => setChromeIn(true), 700);
    return () => window.clearTimeout(id);
  }, []);

  // Preload image assets (static + per-play dynamic). Skipped while the
  // recording plays; runs if the video path drops out so the canvas can start.
  useEffect(() => {
    if (videoMode) return;
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
  }, [clip, params, videoMode]);

  // Recorded-video driver: kick playback, and fall back to the canvas draw if
  // the file hasn't produced a frame within the watchdog window.
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

  // Run the draw loop once canvas + assets + font are ready (canvas path only).
  useEffect(() => {
    if (videoMode) return;
    if (!assets || !fontReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const timeScale = clip.sourceDuration
      ? clip.sourceDuration / clip.duration
      : 1;

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
      clip.draw(ctx, t * timeScale, AB, assets, params ?? {});
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
      setOpacity(1);
      if (holdForClick) {
        paint(clip.duration); // final frame; wait for a click
        return;
      }
      paint(clip.poster ?? clip.duration * 0.75);
      const id = window.setTimeout(finish, 400);
      return () => window.clearTimeout(id);
    }

    let start: number | null = null;
    const step = (ts: number) => {
      if (start == null) start = ts;
      const t = (ts - start) / 1000;
      paint(Math.min(t, clip.duration));
      if (!fadeInRef.current) {
        fadeInRef.current = true;
        setOpacity(1);
      }
      // Auto clips fade out over the last beat; held clips don't (they wait).
      if (
        !holdForClick &&
        fadeOut &&
        !fadeOutRef.current &&
        t >= clip.duration - FADE_S
      ) {
        fadeOutRef.current = true;
        setOpacity(0);
      }
      if (t >= clip.duration) {
        if (holdForClick) return; // hold final frame; a click continues
        finish();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [assets, fontReady, clip, params, finish, fadeOut, holdForClick, videoMode]);

  return (
    <div
      onClick={clickable ? dismiss : undefined}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 140,
        background: "#050403",
        cursor: clickable ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {videoMode ? (
        <video
          ref={videoRef}
          src={clip.video}
          muted
          playsInline
          autoPlay
          preload="auto"
          style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}
          onPlaying={() => {
            if (!fadeInRef.current) {
              fadeInRef.current = true;
              setOpacity(1);
            }
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (
              !holdForClick &&
              fadeOut &&
              !fadeOutRef.current &&
              v.duration > 0 &&
              v.duration - v.currentTime <= FADE_S
            ) {
              fadeOutRef.current = true;
              setOpacity(0);
            }
          }}
          onEnded={() => {
            // holdForClick clips park on the recording's final frame and wait.
            if (!holdForClick) finish();
          }}
          onError={() => setVideoFailed(true)}
        />
      ) : (
        <canvas
          ref={canvasRef}
          width={FW}
          height={FH}
          style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}
        />
      )}

      {quote && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "0 28px",
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 78px)",
            background:
              "linear-gradient(to top, rgba(5,4,3,0.92) 0%, rgba(5,4,3,0.6) 38%, rgba(5,4,3,0) 72%)",
            opacity: chromeIn ? 1 : 0,
            transition: "opacity 700ms ease",
            pointerEvents: "none",
          }}
        >
          <p
            style={{
              maxWidth: 780,
              margin: 0,
              textAlign: "center",
              color: "#ffefc5",
              fontFamily: "Cinzel, Georgia, serif",
              fontStyle: "italic",
              fontSize: "clamp(15px, 2.3vw, 23px)",
              lineHeight: 1.55,
              textShadow: "0 2px 14px rgba(0,0,0,0.95)",
            }}
          >
            &ldquo;{quote}&rdquo;
          </p>
        </div>
      )}

      {clickable && (
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)",
            fontSize: 12,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "rgba(255,239,197,0.72)",
            pointerEvents: "none",
            fontFamily: "Cinzel, Georgia, serif",
            opacity: chromeIn ? 1 : 0,
            transition: "opacity 500ms ease",
          }}
        >
          {holdForClick ? "Click to continue" : "Tap to skip"}
        </span>
      )}
    </div>
  );
}
