"use client";

import { useState } from "react";
import { SENTENCE_GROUPS, type SentenceKey } from "@/lib/sentences";

// The premade-sentence picker in an Outreach thread (migration 129). Tap a
// sentence to send it; sentences about a player ("… is a Vice") first ask which
// player. With a bot this is the only way to talk.
export function SentencePicker({
  players,
  disabled,
  onSend,
}: {
  // Who a sentence can be about: the living players other than me.
  players: { id: string; label: string }[];
  disabled?: boolean;
  onSend: (key: SentenceKey, aboutId?: string) => void;
}) {
  const [pending, setPending] = useState<SentenceKey | null>(null);
  const pendingDef = SENTENCE_GROUPS.flatMap((g) => g.items).find((d) => d.key === pending);

  if (pending && pendingDef) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-outreach-outline/80">
          &ldquo;{pendingDef.label}&rdquo; &mdash; about who?
        </p>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {players.map((p) => (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => {
                onSend(pending, p.id);
                setPending(null);
              }}
              className="rounded-full border border-outreach-outline/40 bg-cream px-3 py-1 text-xs font-semibold text-outreach-outline transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setPending(null)}
          className="self-start text-xs text-outreach-outline/70 underline"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
      {SENTENCE_GROUPS.map((g) => (
        <div key={g.title}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-outreach-outline/60">
            {g.title}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {g.items.map((d) => (
              <button
                key={d.key}
                disabled={disabled}
                onClick={() => (d.needsPlayer ? setPending(d.key) : onSend(d.key))}
                className="rounded-full border border-outreach-outline/40 bg-cream px-3 py-1 text-xs font-semibold text-outreach-outline transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
