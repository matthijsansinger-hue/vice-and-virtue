"use client";

import { useState } from "react";
import { sendCampMessage } from "@/lib/messages";
import type { Player } from "@/lib/types";

// Soul Energy cost per character (Y * 1.0, Y = 100). Messages are
// expensive on purpose — short signals are realistic, full sentences
// take real saving.
const COST_PER_CHARACTER = 100;
const MAX_LENGTH = 100;

// Shared composer for Vice Worshipper and Virtue Seeker. The camp is
// derived from the role id.
export function WorshipperSeekerAction({
  myPlayer,
  roomId,
}: {
  myPlayer: Player;
  roomId: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const camp: "vice" | "virtue" =
    myPlayer.role === "vice_worshipper" ? "vice" : "virtue";
  const campLabel = camp === "vice" ? "Vices" : "Virtues";
  const roleLabel =
    myPlayer.role === "vice_worshipper" ? "Vice Worshipper" : "Virtue Seeker";

  const trimmed = text.trim();
  const length = trimmed.length;
  const cost = length * COST_PER_CHARACTER;
  const canAfford = myPlayer.soul_energy >= cost;
  const alreadyActed = myPlayer.acted_this_day;
  const affordableChars = Math.floor(myPlayer.soul_energy / COST_PER_CHARACTER);

  async function send() {
    if (alreadyActed || busy || length === 0 || !canAfford) return;
    setBusy(true);
    try {
      await sendCampMessage(
        roomId,
        camp,
        myPlayer.id,
        trimmed,
        cost,
        myPlayer.soul_energy
      );
      setText("");
    } finally {
      setBusy(false);
    }
  }

  if (alreadyActed) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">
          {roleLabel}
        </p>
        <p className="mt-2 text-sm text-cream/60 italic">
          You already sent your message today.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">{roleLabel}</p>
      <p className="mt-2 text-sm text-cream/80">
        Send a secret message to all {campLabel}. Senders are not shown to the
        recipients.
      </p>
      <p className="mt-2 text-xs text-cream/60">
        Soul Energy:{" "}
        <span className="font-semibold">{myPlayer.soul_energy}</span> &middot;{" "}
        {COST_PER_CHARACTER} SE per character &middot; you can afford{" "}
        <span className="font-semibold">{affordableChars}</span>{" "}
        character{affordableChars === 1 ? "" : "s"}.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
        placeholder="Type your message…"
        rows={2}
        className="mt-3 w-full resize-none rounded-lg border border-gold bg-cream px-3 py-2 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
      />
      <div className="mt-2 flex items-center justify-between text-xs text-cream/60">
        <span>
          {length} char{length === 1 ? "" : "s"} &middot; cost {cost} SE
        </span>
        {length > 0 && !canAfford && (
          <span className="text-red-300">Not enough Soul Energy.</span>
        )}
      </div>

      <button
        onClick={send}
        disabled={length === 0 || !canAfford || busy}
        className="mt-3 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Sending…" : `Send to ${campLabel}`}
      </button>
    </div>
  );
}
