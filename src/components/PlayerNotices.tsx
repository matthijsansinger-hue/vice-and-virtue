"use client";

import { useEffect, useState } from "react";

// Private per-player notices (e.g. "Alex revealed themselves: Vice Worshipper").
// Shown as dismissible banners at the top of the screen. Dismissals are
// remembered per-device so a notice doesn't reappear on every state refresh.
const KEY = "vv_notices_dismissed";

function loadDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function PlayerNotices({
  notices,
}: {
  notices: { id: string; text: string }[];
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  const visible = notices.filter((n) => !dismissed.includes(n.id));
  if (visible.length === 0) return null;

  return (
    <div className="fixed inset-x-0 top-3 z-[120] flex flex-col items-center gap-2 px-3">
      {visible.map((n) => (
        <div
          key={n.id}
          className="flex w-full max-w-md items-start gap-3 rounded-xl border border-gold/60 bg-home-bg/95 p-3 text-cream shadow-xl"
        >
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold/50 bg-gold/15 text-xs font-bold text-gold">
            !
          </span>
          <p className="min-w-0 flex-1 text-sm leading-snug">{n.text}</p>
          <button
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-lg leading-none text-cream/60 transition-colors hover:bg-cream/10 hover:text-cream"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
