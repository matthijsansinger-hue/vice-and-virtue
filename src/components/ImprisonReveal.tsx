"use client";

import { useState } from "react";
import { heading } from "@/components/ui/royal";
import { setReady } from "@/lib/game";
import { displayedName } from "@/lib/swaps";
import { getClip } from "@/lib/animations/registry";
import { ClipBackground } from "./animations/ClipBackground";
import { TruthfulnessAction } from "./abilities/TruthfulnessAction";
import type { Player, Room } from "@/lib/types";

// Full-screen imprisonment reveal: plays the live-canvas imprisonment cutscene
// (the gate-slam → "IMPRISONED" seal → logo `imprison_gate` clip, rendered on a
// canvas so there's no heavy video file) behind the jailed player's name + a
// Continue button. Shown to everyone (until they press Continue) when the
// consultation vote jails someone. The day-advance is the consultation's
// existing majority gate — >50% Continue starts a 10s countdown, everyone-ready
// advances instantly — which this drives via setReady and mirrors in its status
// line. (Continuing marks you ready, which also hides this overlay for you,
// revealing the result screen + any Truthfulness reveal underneath.)
export function ImprisonReveal({
  room,
  players,
  myPlayer,
  imprisoned,
  continueReady,
  continueTotal,
  continueSec,
  canRevealVotes,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
  imprisoned: Player;
  continueReady: number;
  continueTotal: number;
  continueSec: number | null;
  canRevealVotes: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const name = displayedName(imprisoned, room, players, myPlayer?.id);
  const gate = getClip("imprison_gate");

  async function cont() {
    if (!myPlayer || busy) return;
    setBusy(true);
    try {
      await setReady(myPlayer.id, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex flex-col items-center justify-end overflow-hidden bg-[#050403]">
      {gate && (
        <ClipBackground
          clip={gate}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* Bottom scrim so the name + controls stay legible over the cutscene. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(5,4,3,0.92) 0%, rgba(5,4,3,0.5) 40%, rgba(5,4,3,0) 72%)",
        }}
        aria-hidden
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center px-6 pb-[calc(env(safe-area-inset-bottom,0px)+40px)] text-center text-cream">
        <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
          Day {room.day} &mdash; the verdict
        </p>
        <h2
          className={`mt-2 text-4xl font-bold ${heading}`}
          style={{ textShadow: "0 2px 18px rgba(0,0,0,0.95)" }}
        >
          {name}
        </h2>
        <p
          className="mt-1 text-lg text-cream/90"
          style={{ textShadow: "0 2px 12px rgba(0,0,0,0.95)" }}
        >
          has been imprisoned
        </p>

        {/* Truthfulness can still reveal the voters from here (before the day
            advances). After revealing, the voters list shows on the result
            screen once you continue. */}
        {canRevealVotes && myPlayer && (
          <div className="mt-5 w-full text-left">
            <TruthfulnessAction
              myPlayer={myPlayer}
              room={room}
              imprisoned={imprisoned}
            />
          </div>
        )}

        <button
          onClick={cont}
          disabled={busy}
          className={`mt-6 w-full rounded-xl bg-gold py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 ${heading}`}
        >
          {busy ? "Continuing…" : `Continue (${continueReady}/${continueTotal})`}
        </button>
        {continueSec !== null && (
          <p className={`mt-2 text-xs font-semibold text-cream/85 ${heading}`}>
            Most are ready &mdash; continuing in {continueSec}s
          </p>
        )}
      </div>
    </div>
  );
}
