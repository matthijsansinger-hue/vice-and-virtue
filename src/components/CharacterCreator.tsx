"use client";

// The character editor — a live shoulder-up preview over segmented pickers for
// skin tone, hairstyle, hair colour, eye colour, and outfit colour. Every change
// bubbles up via onChange; the parent persists it (saveCharacter). All options
// come from the catalog in src/lib/character.ts (the avatar is pure SVG).

import { useState } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import {
  GENDERS,
  FACE_SHAPES,
  EXPRESSIONS,
  SKIN_TONES,
  HAIRSTYLES,
  HAIR_COLORS,
  FACIAL_HAIR,
  EYE_COLORS,
  OUTFIT_COLORS,
  DEFAULT_CHARACTER,
  normalizeCharacter,
  type CharacterConfig,
  type ColorOption,
} from "@/lib/character";

export function CharacterCreator({
  character,
  onChange,
}: {
  character: CharacterConfig | null;
  onChange: (c: CharacterConfig) => void;
}) {
  const [cfg, setCfg] = useState<CharacterConfig>(() =>
    normalizeCharacter(character ?? DEFAULT_CHARACTER)
  );

  function update(patch: Partial<CharacterConfig>) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-gold">Your character</h2>
        <p className="text-xs text-cream/50">
          Build your look — it shows on your badge and profile.
        </p>
      </div>

      {/* Live shoulder-up preview */}
      <div className="flex justify-center rounded-xl border border-gold/20 bg-black/20 p-3">
        <CharacterAvatar character={cfg} initials="" variant="full" className="h-52 w-52" />
      </div>

      <Section title="Body">
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <Chip key={g.id} selected={cfg.gender === g.id} onClick={() => update({ gender: g.id })}>
              {g.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Face shape">
        <div className="flex flex-wrap gap-2">
          {FACE_SHAPES.map((f) => (
            <Chip key={f.id} selected={cfg.faceShape === f.id} onClick={() => update({ faceShape: f.id })}>
              {f.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Skin tone">
        <Swatches options={SKIN_TONES} selected={cfg.skin} onPick={(id) => update({ skin: id })} />
      </Section>

      <Section title="Hairstyle">
        <div className="flex flex-wrap gap-2">
          {HAIRSTYLES.map((h) => (
            <Chip key={h.id} selected={cfg.hair === h.id} onClick={() => update({ hair: h.id })}>
              {h.label}
            </Chip>
          ))}
        </div>
      </Section>

      {cfg.hair !== "none" && (
        <Section title="Hair color">
          <Swatches
            options={HAIR_COLORS}
            selected={cfg.hairColor}
            onPick={(id) => update({ hairColor: id })}
          />
        </Section>
      )}

      <Section title="Facial hair">
        <div className="flex flex-wrap gap-2">
          {FACIAL_HAIR.map((f) => (
            <Chip key={f.id} selected={cfg.facialHair === f.id} onClick={() => update({ facialHair: f.id })}>
              {f.label}
            </Chip>
          ))}
        </div>
      </Section>

      {cfg.facialHair !== "none" && (
        <Section title="Facial hair color">
          <Swatches
            options={HAIR_COLORS}
            selected={cfg.facialHairColor}
            onPick={(id) => update({ facialHairColor: id })}
          />
        </Section>
      )}

      <Section title="Eye color">
        <Swatches options={EYE_COLORS} selected={cfg.eyeColor} onPick={(id) => update({ eyeColor: id })} />
      </Section>

      <Section title="Expression">
        <div className="flex flex-wrap gap-2">
          {EXPRESSIONS.map((e) => (
            <Chip key={e.id} selected={cfg.expression === e.id} onClick={() => update({ expression: e.id })}>
              {e.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Outfit color">
        <Swatches options={OUTFIT_COLORS} selected={cfg.outfit} onPick={(id) => update({ outfit: id })} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-cream/70">{title}</span>
      {children}
    </div>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-lg border-2 px-3 py-1.5 text-sm transition-colors " +
        (selected
          ? "border-gold bg-gold/10 text-cream"
          : "border-cream/15 text-cream/80 hover:border-cream/30")
      }
    >
      {children}
    </button>
  );
}

function Swatches({
  options,
  selected,
  onPick,
}: {
  options: ColorOption[];
  selected: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onPick(o.id)}
          title={o.label}
          aria-label={o.label}
          className={
            "h-9 w-9 rounded-full border-2 transition-transform hover:scale-105 " +
            (selected === o.id ? "border-gold ring-2 ring-gold/40" : "border-cream/20")
          }
          style={{ background: o.hex }}
        />
      ))}
    </div>
  );
}
