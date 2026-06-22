"use client";

// Renders a player's customizable character from the layered art in
// public/characters (see src/lib/character.ts): a body-only base tinted to the
// skin tone → attire (bottom/shoes/top) → hair tinted to the hair colour.
// Two framings:
//   - variant="badge" (default): a round head-and-shoulders crop (banners,
//     lobby rows, leaderboard, …), on a dark backdrop.
//   - variant="full": the whole figure (the profile "Edit character" widget),
//     object-contain so nothing is cropped; no backdrop (the caller's panel
//     shows through).
// Tinting (white-fill / black-line art → colour) is a <canvas> MULTIPLY — done
// once per src+colour and cached — which is reliable across browsers (the old
// CSS mask + mix-blend approach didn't render). A procedural SVG silhouette
// shows only if the base art fails to load.

import { useEffect, useState, type CSSProperties } from "react";
import { characterLayers, skinHex, hairHex, eyeHex, type CharacterConfig } from "@/lib/character";

// The badge crops the full-body art to its top to frame head + shoulders.
const BADGE_CROP: CSSProperties = {
  position: "absolute",
  width: "166.7%",
  height: "333.4%",
  left: "-33.35%",
  top: "0",
};

// Tinted-image cache (data URLs), shared across every avatar instance, keyed by
// `${src}|${tint}` so a lobby of players doesn't recompute the same tint.
const tintCache = new Map<string, string>();

export function CharacterAvatar({
  character,
  initials,
  className = "",
  textClass = "text-xs",
  variant = "badge",
}: {
  character: CharacterConfig | null;
  initials: string;
  className?: string; // box size + ring/border/background, from the caller
  textClass?: string; // initials font size for the no-character fallback
  variant?: "badge" | "full";
}) {
  const round = variant === "badge";
  const shape = round ? "rounded-full" : "rounded-2xl";
  const imgFit = round ? "object-cover" : "object-contain";
  const layers = character ? characterLayers(character) : [];
  const srcKey = layers.map((l) => `${l.src}:${l.tint ?? ""}`).join("|");
  const [failed, setFailed] = useState<Set<string>>(new Set());

  // Re-attempt every layer whenever the character changes.
  useEffect(() => setFailed(new Set()), [srcKey]);

  function hide(key: string) {
    setFailed((prev) => new Set(prev).add(key));
  }

  // No character yet → initials chip (matches the old no-photo fallback).
  if (!character) {
    return (
      <span
        className={`flex items-center justify-center ${shape} ${round ? "bg-[#372155]" : ""} font-semibold text-cream ${textClass} ${className}`}
      >
        {initials}
      </span>
    );
  }

  const art = (
    <>
      {/* Placeholder ONLY if the real body art failed to load — never behind it. */}
      {failed.has("base") && (
        <Placeholder character={character} par={round ? "xMidYMid slice" : "xMidYMid meet"} />
      )}
      {layers.map((l) =>
        failed.has(l.key) ? null : l.tint ? (
          <TintedLayer key={l.key} src={l.src} tint={l.tint} imgFit={imgFit} onError={() => hide(l.key)} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={l.key}
            src={l.src}
            alt=""
            className={`absolute inset-0 h-full w-full ${imgFit}`}
            onError={() => hide(l.key)}
          />
        )
      )}
    </>
  );

  return (
    <span className={`relative block shrink-0 overflow-hidden ${shape} ${round ? "bg-[#2a2336]" : ""} ${className}`}>
      {round ? <span style={BADGE_CROP}>{art}</span> : art}
    </span>
  );
}

// Recolour white-fill / black-line art to `tint` on a <canvas> (multiply: white
// → tint, black lines stay dark; the transparent background is preserved by
// re-applying the source alpha). Deterministic and cached by src+tint.
function TintedLayer({
  src,
  tint,
  imgFit,
  onError,
}: {
  src: string;
  tint: string;
  imgFit: string;
  onError: () => void;
}) {
  const key = `${src}|${tint}`;
  const [url, setUrl] = useState<string | null>(() => tintCache.get(key) ?? null);

  useEffect(() => {
    const cached = tintCache.get(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    let active = true;
    const img = new window.Image();
    img.onload = () => {
      if (!active) return;
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 1;
        c.height = img.naturalHeight || 1;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.globalCompositeOperation = "destination-in"; // clip back to the art's alpha
        ctx.drawImage(img, 0, 0);
        const out = c.toDataURL("image/png");
        tintCache.set(key, out);
        if (active) setUrl(out);
      } catch {
        /* canvas unavailable — render nothing rather than an untinted flash */
      }
    };
    img.onerror = () => {
      if (active) onError();
    };
    img.src = src;
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className={`absolute inset-0 h-full w-full ${imgFit}`} /> : null;
}

// A skin-toned full-body silhouette — only shown if the base art fails to load.
function Placeholder({ character, par }: { character: CharacterConfig; par: string }) {
  const skin = skinHex(character.skin);
  const eye = eyeHex(character.eyeColor);
  const hair = hairHex(character.hairColor);
  const hasHair = character.hair !== "none";
  return (
    <svg viewBox="0 0 100 200" preserveAspectRatio={par} className="absolute inset-0 h-full w-full" aria-hidden="true">
      <rect x="38" y="106" width="10" height="74" rx="4" fill={skin} />
      <rect x="52" y="106" width="10" height="74" rx="4" fill={skin} />
      <ellipse cx="43" cy="183" rx="7.5" ry="5" fill="#3a2c20" />
      <ellipse cx="59" cy="183" rx="7.5" ry="5" fill="#3a2c20" />
      <rect x="32" y="50" width="36" height="60" rx="12" fill={skin} />
      <rect x="23" y="54" width="9" height="42" rx="4.5" fill={skin} />
      <rect x="68" y="54" width="9" height="42" rx="4.5" fill={skin} />
      <ellipse cx="50" cy="54" rx="23" ry="11" fill={skin} />
      <rect x="45" y="39" width="10" height="12" rx="4" fill={skin} />
      <ellipse cx="50" cy="26" rx="13" ry="16" fill={skin} />
      {hasHair && <path d="M36 28 Q35 8 50 7 Q65 8 64 28 Q58 17 50 17 Q42 17 36 28 Z" fill={hair} />}
      <ellipse cx="45" cy="27" rx="3.4" ry="4" fill="#f4f1ea" />
      <ellipse cx="55" cy="27" rx="3.4" ry="4" fill="#f4f1ea" />
      <ellipse cx="45" cy="27.4" rx="2" ry="2.5" fill={eye} />
      <ellipse cx="55" cy="27.4" rx="2" ry="2.5" fill={eye} />
    </svg>
  );
}
