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
    text: "You take on a secret role with its own power, and start with 100 Soul Energy to spend on it. Every day then flows through three phases: Reflection, Action, and Consultation.",
  },
  {
    img: "/reflection-bg.png",
    title: "1 · Reflection — Role action",
    text: "The day begins in Reflection. First, use your secret role's power — your Role action. It costs Soul Energy, the resource you spend on abilities and Market items, so spend it where it counts.",
  },
  {
    img: "/minigame-bg.png",
    title: "1 · Reflection — The Quiz",
    text: "Then everyone plays the Quiz at once: tag every other player Vice, Virtue, or “?”. A correct Vice/Virtue tag scores well and a “?” scores a little — but a single wrong tag zeroes your whole round, so only commit when you're sure. Players are then ranked by points (ties share a place), and the higher you place, the more Soul Energy you win.",
  },
  {
    img: "/outreach-bg.png",
    title: "2 · Action — Outreach",
    text: "The Action phase opens with Outreach: private one-on-one chats with anyone you like — gather information, forge alliances, or spread convincing lies.",
  },
  {
    img: "/outreach-bg.png",
    title: "2 · Action — The Market",
    text: "Then the Market: spend Soul Energy on single-use potions — a kill, a hospitalisation, self-protection, a camp reveal, a Quiz point-doubler, a peek at your voters — or the Revealing Eye to count who's left, and chip in to free someone from prison. Everyone gains +50 Soul Energy when the Market opens.",
  },
  {
    img: "/consultation-bg.png",
    title: "3 · Consultation",
    text: "The council convenes. Debate as a group, then vote. The most-voted player is sent to prison, out of the game. Then the day loops back to Reflection.",
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
