"use client";

// TEMP dev-only gallery to eyeball the avatar rendering — not linked anywhere.
// Delete freely.

import { CharacterAvatar } from "@/components/CharacterAvatar";
import { HAIRSTYLES, FACE_SHAPES, SKIN_TONES, FACIAL_HAIR, DEFAULT_CHARACTER, type CharacterConfig } from "@/lib/character";

const base: CharacterConfig = { ...DEFAULT_CHARACTER };

function Cell({ c, label }: { c: CharacterConfig; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <CharacterAvatar character={c} initials="" variant="badge" className="h-36 w-36" />
      <span style={{ fontSize: 11, color: "#ddd" }}>{label}</span>
    </div>
  );
}

export default function AvatarsDev() {
  return (
    <div style={{ background: "#191016", minHeight: "100vh", padding: 24, display: "flex", flexDirection: "column", gap: 28 }}>
      <h2 style={{ color: "#fff" }}>Hairstyles — male</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {HAIRSTYLES.map((h) => (
          <Cell key={h.id} c={{ ...base, gender: "male", hair: h.id }} label={h.label} />
        ))}
      </div>
      <h2 style={{ color: "#fff" }}>Hairstyles — female</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {HAIRSTYLES.map((h) => (
          <Cell key={h.id} c={{ ...base, gender: "female", hair: h.id, hairColor: "auburn" }} label={h.label} />
        ))}
      </div>
      <h2 style={{ color: "#fff" }}>Face shapes</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {FACE_SHAPES.map((f) => (
          <Cell key={`m-${f.id}`} c={{ ...base, gender: "male", hair: "none", faceShape: f.id }} label={`M ${f.label}`} />
        ))}
        {FACE_SHAPES.map((f) => (
          <Cell key={`f-${f.id}`} c={{ ...base, gender: "female", hair: "none", faceShape: f.id, skin: "brown" }} label={`F ${f.label}`} />
        ))}
      </div>
      <h2 style={{ color: "#fff" }}>Facial hair — styles (male oval)</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {FACIAL_HAIR.map((f) => (
          <Cell key={f.id} c={{ ...base, gender: "male", hair: "short", facialHair: f.id }} label={f.label} />
        ))}
      </div>
      <h2 style={{ color: "#fff" }}>Facial hair — fit across faces (beard)</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {FACE_SHAPES.map((f) => (
          <Cell key={`bm-${f.id}`} c={{ ...base, gender: "male", hair: "short", faceShape: f.id, facialHair: "both" }} label={`M ${f.label}`} />
        ))}
        {FACE_SHAPES.map((f) => (
          <Cell key={`bf-${f.id}`} c={{ ...base, gender: "female", hair: "bun", faceShape: f.id, facialHair: "both", skin: "tan" }} label={`F ${f.label}`} />
        ))}
      </div>
      <h2 style={{ color: "#fff" }}>Facial hair — fit across faces (long / chops / stubble)</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {FACE_SHAPES.map((f) => (
          <Cell key={`lm-${f.id}`} c={{ ...base, gender: "male", hair: "short", faceShape: f.id, facialHair: "long", hairColor: "silver", facialHairColor: "silver" }} label={`Long ${f.label}`} />
        ))}
        {FACE_SHAPES.map((f) => (
          <Cell key={`cm-${f.id}`} c={{ ...base, gender: "male", hair: "short", faceShape: f.id, facialHair: "chops", hairColor: "auburn", facialHairColor: "auburn" }} label={`Chops ${f.label}`} />
        ))}
        {FACE_SHAPES.map((f) => (
          <Cell key={`sm-${f.id}`} c={{ ...base, gender: "male", hair: "short", faceShape: f.id, facialHair: "stubble", skin: "brown", facialHairColor: "black" }} label={`Stubble ${f.label}`} />
        ))}
      </div>
      <h2 style={{ color: "#fff" }}>Detail check — big</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Cell c={{ ...base, gender: "female", hair: "curtain-bangs", hairColor: "blonde", eyeColor: "green", expression: "happy" }} label="F curtain blonde" />
        <Cell c={{ ...base, gender: "male", hair: "dreads", hairColor: "black", skin: "deep", eyeColor: "brown" }} label="M dreads deep" />
        <Cell c={{ ...base, gender: "male", hair: "mohawk", hairColor: "red", faceShape: "angular", expression: "angry" }} label="M mohawk angular" />
        <Cell c={{ ...base, gender: "female", hair: "curls-long", hairColor: "black", skin: "ebony", faceShape: "round" }} label="F curls-long ebony" />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {SKIN_TONES.map((s) => (
          <Cell key={s.id} c={{ ...base, gender: "female", hair: "sidepart-long", skin: s.id }} label={s.label} />
        ))}
      </div>
    </div>
  );
}
