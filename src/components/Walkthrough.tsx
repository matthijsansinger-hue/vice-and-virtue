"use client";

import { useState } from "react";
import { SoulEnergyText } from "@/components/ui/royal";

// A swipeable, illustrated walkthrough of one full day cycle, shown at
// the top of the "How to play" guide. Uses art we already ship.
type Slide = { img: string; title: string; text: string };

const SLIDES: Slide[] = [
  {
    img: "/logo.png?v=3",
    title: "Welcome",
    text: "Vice and Virtue is a hidden-role party game. Everyone secretly belongs to one of two camps — Vice or Virtue. Outlast the other camp to win.",
  },
  {
    img: "/cards/murder.png",
    title: "Your secret role",
    text: "You're dealt a secret role with its own power. You start with 100 Soul Energy to spend on it.",
  },
  {
    img: "/minigame-bg.png",
    title: "1 · Reflection",
    text: "Each day starts here: use your role's power (it costs Soul Energy), then a quick minigame — tag each player Vice or Virtue. A wrong guess scores 0, so leave anyone you're unsure about as “?”. Doing well earns more Soul Energy.",
  },
  {
    img: "/outreach-bg.png",
    title: "2 · Outreach",
    text: "Privately message anyone you like — gather information, form alliances, or spread convincing lies.",
  },
  {
    img: "/eye-emblem.png",
    title: "Camp powers",
    text: "Just before the vote, each camp may use one power, once per game: the Vices open the Revealing Eye (shows how many of each camp remain), and the Virtues can free a prisoner.",
  },
  {
    img: "/imprisoned-emblem.png",
    title: "3 · Consultation",
    text: "Debate as a group, then vote. The most-voted player is sent to prison and out of the game. Then the day loops back to Reflection.",
  },
  {
    img: "/virtues-win-text.png",
    title: "Winning",
    text: "When every player of the other camp is imprisoned or dead, your camp wins. Deceive, persuade, survive — and shape the new world.",
  },
];

export function Walkthrough({
  endNote = "Full details below ↓",
}: {
  // Shown on the last slide in place of the Next button. Defaults to the
  // "How to play" wording; the pre-game overview passes its own.
  endNote?: string;
}) {
  const [i, setI] = useState(0);
  const slide = SLIDES[i];
  const isFirst = i === 0;
  const isLast = i === SLIDES.length - 1;

  return (
    <section className="rounded-xl border border-gold/40 bg-cream/5 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-gold">
        Quick walkthrough
      </h2>

      <div className="mt-3 flex h-44 items-center justify-center overflow-hidden rounded-lg bg-home-bg/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slide.img}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      </div>

      <p className="mt-3 text-base font-semibold text-gold">{slide.title}</p>
      <p className="mt-1 min-h-[5.5rem] text-sm leading-relaxed text-cream/85">
        <SoulEnergyText>{slide.text}</SoulEnergyText>
      </p>

      {/* Dots */}
      <div className="mt-2 flex justify-center gap-1.5">
        {SLIDES.map((_, idx) => (
          <span
            key={idx}
            className={
              "h-1.5 w-1.5 rounded-full " +
              (idx === i ? "bg-gold" : "bg-gold/30")
            }
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          onClick={() => setI((n) => Math.max(0, n - 1))}
          disabled={isFirst}
          className="rounded-lg border border-gold/40 px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10 disabled:opacity-30"
        >
          Back
        </button>
        {isLast ? (
          <span className="text-xs text-cream/50">{endNote}</span>
        ) : (
          <button
            onClick={() => setI((n) => Math.min(SLIDES.length - 1, n + 1))}
            className="rounded-lg bg-gold px-5 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Next
          </button>
        )}
      </div>
    </section>
  );
}
