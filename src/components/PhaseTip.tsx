"use client";

import { useState } from "react";
import { hasSeenTip, markTipSeen } from "@/lib/tips";

// A small, dismissible "first-time tip" banner shown once per phase
// (remembered in localStorage). Non-blocking — it sits at the top of the
// phase content and never gates the timer or any action.
export function PhaseTip({ id, text }: { id: string; text: string }) {
  const [hidden, setHidden] = useState(() => hasSeenTip(id));
  if (hidden) return null;

  return (
    <div className="mb-4 w-full rounded-lg border border-gold/60 bg-home-bg/90 p-3 text-left text-cream shadow-lg backdrop-blur">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gold">
        First-time tip
      </p>
      <p className="mt-1 text-xs leading-relaxed text-cream/90">{text}</p>
      <button
        onClick={() => {
          markTipSeen(id);
          setHidden(true);
        }}
        className="mt-2 rounded-lg bg-gold px-3 py-1 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90"
      >
        Got it
      </button>
    </div>
  );
}
