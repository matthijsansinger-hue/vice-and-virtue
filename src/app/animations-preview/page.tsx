"use client";

// Dev-only QA gallery (unlinked) — renders every ability + phase-transition
// clip inline on a looping canvas so they can be eyeballed at a glance without
// playing a full game. Visit /animations-preview while running `npm run dev`.

import { useEffect, useRef, useState } from "react";
import { AB, type ClipAssets, type ClipParams } from "@/lib/animations/engine";
import { CLIP_NAMES, getClip } from "@/lib/animations/registry";
import { CanvasClip } from "@/components/animations/CanvasClip";

// Sample params so data-driven clips (Certainty's card-flip) have something to
// render in the gallery.
function sampleParams(name: string): ClipParams {
  if (name === "certainty") {
    return { role: "murder", roleName: "Murder", targetName: "Aldric" };
  }
  return {};
}

function ClipPreview({ name }: { name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clip = getClip(name);

  useEffect(() => {
    const canvas = ref.current;
    if (!clip || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const params = sampleParams(name);
    const imgMap = {
      ...(clip.images ?? {}),
      ...(clip.imagesFor?.(params) ?? {}),
    };
    const assets: ClipAssets = {};
    let raf = 0;
    let start: number | null = null;
    let cancelled = false;

    const paint = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.clearRect(0, 0, 1920, 1080);
      if (clip.bg) {
        ctx.fillStyle = clip.bg;
        ctx.fillRect(0, 0, 1920, 1080);
      }
      const drawT = clip.sourceDuration
        ? t * (clip.sourceDuration / clip.duration)
        : t;
      clip.draw(ctx, drawT, AB, assets, params);
      if (clip.fadeFromBlack) {
        const f = AB.interp([0, 0.1], [1, 0], AB.E.easeOutQuad)(t / clip.duration);
        if (f > 0.001) {
          ctx.save();
          ctx.globalAlpha = f;
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, 1920, 1080);
          ctx.restore();
        }
      }
    };

    const step = (ts: number) => {
      if (cancelled) return;
      if (start == null) start = ts;
      let t = (ts - start) / 1000;
      if (t >= clip.duration) {
        start = ts; // loop
        t = 0;
      }
      paint(t);
      raf = requestAnimationFrame(step);
    };

    const begin = () => {
      // Paint one frame synchronously first, so the tile isn't blank before the
      // rAF loop's first tick (and so it still renders in a backgrounded tab,
      // where rAF is throttled).
      paint(clip.poster ?? clip.duration * 0.6);
      raf = requestAnimationFrame(step);
    };

    const entries = Object.entries(imgMap);
    if (entries.length === 0) {
      begin();
    } else {
      let left = entries.length;
      entries.forEach(([key, src]) => {
        const img = new Image();
        img.onload = img.onerror = () => {
          assets[key] = img;
          if (--left <= 0 && !cancelled) begin();
        };
        img.src = src;
      });
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [clip, name]);

  return (
    <div style={{ border: "1px solid #333", borderRadius: 10, overflow: "hidden", background: "#000" }}>
      <canvas
        ref={ref}
        width={1920}
        height={1080}
        style={{ width: "100%", aspectRatio: "16 / 9", display: "block", background: "#000" }}
      />
      <div style={{ padding: "8px 12px", color: "#e7eef6", fontFamily: "Cinzel, Georgia, serif", fontSize: 13, display: "flex", justifyContent: "space-between" }}>
        <span>{name}</span>
        <span style={{ color: "#9a8" }}>{clip?.duration}s</span>
      </div>
    </div>
  );
}

export default function AnimationsPreviewPage() {
  // ?play=<clip> mounts a real CanvasClip (with its quote + click-to-continue)
  // for QA of the in-app overlay; without it the looping gallery shows.
  const [playName, setPlayName] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPlayName(new URLSearchParams(window.location.search).get("play"));
    } catch {
      /* ignore */
    }
  }, []);
  const playClip = playName ? getClip(playName) : undefined;

  // Link the literal "Cinzel" face so canvas text matches the real app.
  useEffect(() => {
    if (document.querySelector("link[data-vv-cinzel]")) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&display=swap";
    link.setAttribute("data-vv-cinzel", "");
    document.head.appendChild(link);
  }, []);

  // Focused single-clip QA view (lightweight — no gallery behind it).
  if (playClip) {
    return (
      <CanvasClip clip={playClip} holdForClick onDone={() => setPlayName(null)} />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#161616", padding: 20 }}>
      <h1 style={{ color: "#e3b510", fontFamily: "Cinzel, Georgia, serif", marginBottom: 16 }}>
        Animation preview — {CLIP_NAMES.length} clips
      </h1>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: 16,
        }}
      >
        {CLIP_NAMES.map((n) => (
          <ClipPreview key={n} name={n} />
        ))}
      </div>
    </div>
  );
}
