"use client";

// The character editor — replaces the old "upload a photo" control in the
// Profile "Customize" modal. A live preview over segmented pickers for gender,
// skin tone, hairstyle, hair color, eye color, and outfit. Every change bubbles
// up via onChange; the parent persists it (saveCharacter). All options come from
// the catalog in src/lib/character.ts.

import { useState } from "react";
import { CharacterAvatar } from "./CharacterAvatar";
import {
  GENDERS,
  SKIN_TONES,
  HAIRSTYLES,
  HAIR_COLORS,
  EYE_COLORS,
  TOPS,
  BOTTOMS,
  SHOES,
  DEFAULT_CHARACTER,
  normalizeCharacter,
  type CharacterConfig,
  type ColorOption,
  type Option,
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

  // Eye colour stays hidden until an iris-overlay layer exists (see
  // public/characters/README.md). Everything else has art now.
  const SHOW = { eyes: false };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-gold">Your character</h2>
        <p className="text-xs text-cream/50">
          Build your look — it shows on your badge and profile.
        </p>
      </div>

      {/* Live full-body preview */}
      <div className="flex justify-center rounded-xl border border-gold/20 bg-black/20 p-3">
        <CharacterAvatar character={cfg} initials="" variant="full" className="h-64 w-44" />
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

      {SHOW.eyes && (
        <Section title="Eye color">
          <Swatches options={EYE_COLORS} selected={cfg.eyeColor} onPick={(id) => update({ eyeColor: id })} />
        </Section>
      )}

      <AttireSection title="Top" options={TOPS} selected={cfg.top} onPick={(id) => update({ top: id })} />
      <AttireSection title="Bottom" options={BOTTOMS} selected={cfg.bottom} onPick={(id) => update({ bottom: id })} />
      <AttireSection title="Shoes" options={SHOES} selected={cfg.shoes} onPick={(id) => update({ shoes: id })} />
    </div>
  );
}

function AttireSection({
  title,
  options,
  selected,
  onPick,
}: {
  title: string;
  options: Option[];
  selected: string;
  onPick: (id: string) => void;
}) {
  return (
    <Section title={title}>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o.id} selected={selected === o.id} onClick={() => onPick(o.id)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </Section>
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
