"use client";

// Renders a player's customizable character from the layered art in
// public/characters (see src/lib/character.ts). The art is a FULL-BODY portrait
// (1:2). Two framings come from the same layers:
//   - variant="badge" (default): a round icon that crops the art's top to frame
//     the head + shoulders — used on banners, lobby rows, leaderboard, etc.
//     (object-cover + a top crop; sits on a dark backdrop).
//   - variant="full": the whole figure head-to-toe, fit inside the box with
//     object-contain so nothing is cropped at any box size — used by the profile
//     "Edit character" widget. It has NO backdrop of its own, so the caller's
//     translucent panel (e.g. bg-cream/5) shows through, matching the other
//     profile widgets.
// Hair + eyes are grayscale art tinted at runtime (multiply-through-mask). A
// procedural SVG silhouette sits behind the layers so the avatar is visible —
// and reacts to every customization — before the real art exists; each PNG that
// fails to load is dropped, revealing the placeholder beneath it.
//
// Sizing + ring/border/background come from the caller via `className`.
// `character == null` falls back to the player's initials.

import { useEffect, useState, type CSSProperties } from "react";
import {
  characterLayers,
  skinHex,
  hairHex,
  eyeHex,
  outfitHex,
  type CharacterConfig,
} from "@/lib/character";

// The badge crops the full-body art to its top to frame head + shoulders:
// "show the top 30% of a 1:2 portrait, horizontally centered".
const BADGE_CROP: CSSProperties = {
  position: "absolute",
  width: "166.7%",
  height: "333.4%",
  left: "-33.35%",
  top: "0",
};

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
  variant?: "badge" | "full"; // round head-and-shoulders icon, or full-body portrait
}) {
  const round = variant === "badge";
  const shape = round ? "rounded-full" : "rounded-2xl";
  const fit = round ? "cover" : "contain";
  const imgFit = round ? "object-cover" : "object-contain";
  const layers = character ? characterLayers(character) : [];
  const srcKey = layers.map((l) => l.src).join("|");
  const [failed, setFailed] = useState<Set<string>>(new Set());

  // Forget which layers errored whenever the character (its layer srcs) changes,
  // so a fresh pick re-attempts its art.
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
      <Placeholder character={character} par={round ? "xMidYMid slice" : "xMidYMid meet"} />
      {layers.map((l) =>
        failed.has(l.key) ? null : l.tint ? (
          <TintedLayer key={l.key} src={l.src} tint={l.tint} fit={fit} onError={() => hide(l.key)} />
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
    <span
      className={`relative block shrink-0 overflow-hidden ${shape} ${round ? "bg-[#2a2336]" : ""} ${className}`}
    >
      {round ? <span style={BADGE_CROP}>{art}</span> : art}
    </span>
  );
}

// A grayscale PNG recolored to `tint`: the image provides shape + shading; an
// overlay of the tint colour is multiplied through the same image used as a
// mask, so the colour only lands where the art is and keeps its shading.
// `isolation:isolate` confines the multiply to this layer (it must not darken
// the layers below). `fit` matches the layer's object-fit so the mask aligns.
function TintedLayer({
  src,
  tint,
  fit,
  onError,
}: {
  src: string;
  tint: string;
  fit: "cover" | "contain";
  onError: () => void;
}) {
  const mask: CSSProperties = {
    WebkitMaskImage: `url("${src}")`,
    maskImage: `url("${src}")`,
    WebkitMaskSize: fit,
    maskSize: fit,
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
  return (
    <span className="absolute inset-0" style={{ isolation: "isolate" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className={`absolute inset-0 h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
        onError={onError}
      />
      <span
        className="absolute inset-0"
        style={{ backgroundColor: tint, mixBlendMode: "multiply", ...mask }}
      />
    </span>
  );
}

// A simple full-body silhouette (1:2) painted from the catalog hexes. Stands in
// for missing art and always reflects the current picks. Head + shoulders sit in
// the top ~30% so the badge crop frames them like a portrait. `par` is the SVG
// preserveAspectRatio (slice for the badge crop, meet for the full portrait).
function Placeholder({ character, par }: { character: CharacterConfig; par: string }) {
  const skin = skinHex(character.skin);
  const outfit = outfitHex(character.outfit);
  const eye = eyeHex(character.eyeColor);
  const hair = hairHex(character.hairColor);
  const hasHair = character.hair !== "none";
  return (
    <svg
      viewBox="0 0 100 200"
      preserveAspectRatio={par}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {/* legs + feet */}
      <rect x="38" y="106" width="10" height="74" rx="4" fill={outfit} />
      <rect x="52" y="106" width="10" height="74" rx="4" fill={outfit} />
      <ellipse cx="43" cy="183" rx="7.5" ry="5" fill="#3a2c20" />
      <ellipse cx="59" cy="183" rx="7.5" ry="5" fill="#3a2c20" />
      {/* torso + arms + hands */}
      <rect x="32" y="50" width="36" height="60" rx="12" fill={outfit} />
      <rect x="23" y="54" width="9" height="42" rx="4.5" fill={outfit} />
      <rect x="68" y="54" width="9" height="42" rx="4.5" fill={outfit} />
      <circle cx="27.5" cy="98" r="5" fill={skin} />
      <circle cx="72.5" cy="98" r="5" fill={skin} />
      <ellipse cx="50" cy="54" rx="23" ry="11" fill={outfit} />
      {/* neck + head */}
      <rect x="45" y="39" width="10" height="12" rx="4" fill={skin} />
      <ellipse cx="50" cy="26" rx="13" ry="16" fill={skin} />
      {hasHair && (
        <path d="M36 28 Q35 8 50 7 Q65 8 64 28 Q58 17 50 17 Q42 17 36 28 Z" fill={hair} />
      )}
      {/* eye whites behind the iris so eyes stay visible on dark skin */}
      <ellipse cx="45" cy="27" rx="3.4" ry="4" fill="#f4f1ea" />
      <ellipse cx="55" cy="27" rx="3.4" ry="4" fill="#f4f1ea" />
      <ellipse cx="45" cy="27.4" rx="2" ry="2.5" fill={eye} />
      <ellipse cx="55" cy="27.4" rx="2" ry="2.5" fill={eye} />
    </svg>
  );
}
