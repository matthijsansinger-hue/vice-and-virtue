"use client";

import { useState } from "react";
import { submitSoulEscape, buySoulWard } from "@/lib/game";
import type { Player } from "@/lib/types";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import { AbilityPanel } from "./ui";

type Guess = "vice" | "virtue";

// The Wandering Soul's Role-action panel. Two independent things, both here (his
// ward is NOT a market potion):
//  - Ward (100 SE): one cycle safe from prison, killing + hospitalisation.
//  - Escape: name the camp of every active player; all correct ⇒ he wins
//    (resolved after role_action via resolve_soul_escape). Wrong/partial = retry.
export function WanderingSoulAction({
  myPlayer,
  players,
}: {
  myPlayer: Player;
  players: Player[];
}) {
  const targets = players.filter(
    (p) => p.id !== myPlayer.id && !p.dead && !p.in_prison
  );
  const [guesses, setGuesses] = useState<Record<string, Guess>>({});
  const { play } = useAbilityAnimation();
  const [busy, setBusy] = useState(false);
  const [wardBought, setWardBought] = useState(false);
  const [wardBusy, setWardBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitted = myPlayer.acted_this_day;
  const allGuessed = targets.length > 0 && targets.every((p) => guesses[p.id]);
  const canAffordWard = myPlayer.soul_energy >= 100;

  async function attempt() {
    if (busy || submitted || !allGuessed) return;
    setBusy(true);
    setError(null);
    try {
      await submitSoulEscape(myPlayer.id, guesses);
      // Escape animation is played by AbilityOutcomeWatcher only on a successful
      // escape (the game ends as a Soul win), not on tap.
    } finally {
      setBusy(false);
    }
  }

  async function ward() {
    if (wardBusy || wardBought || !canAffordWard) return;
    setWardBusy(true);
    setError(null);
    try {
      const res = await buySoulWard(myPlayer.id);
      await play(clipForAbility("wandering_soul"));
      if (res.ok) setWardBought(true);
      else setError(res.error === "insufficient_se" ? "Not enough Soul Energy." : "Couldn't ward yourself.");
    } finally {
      setWardBusy(false);
    }
  }

  return (
    <AbilityPanel title="The Wandering Soul">
      {/* Ward — his role ability. */}
      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-soul/40 bg-[#0d1c20]/60 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-soul">Soul Ward</p>
          <p className="text-xs text-cream/70">
            100 SE &mdash; one cycle safe from prison, killing + hospital.
          </p>
        </div>
        {wardBought ? (
          <span className="shrink-0 rounded-md border border-soul/70 bg-soul/15 px-3 py-1.5 text-xs font-semibold text-soul">
            Warded
          </span>
        ) : (
          <button
            type="button"
            onClick={ward}
            disabled={wardBusy || !canAffordWard}
            className="shrink-0 rounded-md bg-soul px-3.5 py-1.5 text-xs font-semibold text-[#06363f] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {wardBusy ? "…" : "Ward (100)"}
          </button>
        )}
      </div>

      {/* Escape — his win condition. */}
      {submitted ? (
        <p className="mt-4 text-sm text-cream/80">
          Your reckoning is cast. If you named every living soul&rsquo;s camp, the
          gates open when the reflection ends and you escape &mdash; the game is yours.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-cream/80">
            Name the camp of every player still in play. Get them{" "}
            <span className="font-semibold text-gold">all</span> right and you escape
            the castle, ending the game as the winner. Guess wrong and you stay
            trapped &mdash; try again tomorrow.
          </p>

          <ul className="mt-3 flex flex-col gap-2">
            {targets.map((p) => {
              const g = guesses[p.id];
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gold/25 bg-black/20 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-cream">{p.name}</span>
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setGuesses((s) => ({ ...s, [p.id]: "vice" }))}
                      className={
                        "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " +
                        (g === "vice"
                          ? "bg-red-800 text-cream ring-1 ring-cream/40"
                          : "border border-red-700/60 text-red-300 hover:bg-red-800/25")
                      }
                    >
                      Vice
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuesses((s) => ({ ...s, [p.id]: "virtue" }))}
                      className={
                        "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " +
                        (g === "virtue"
                          ? "bg-blue-800 text-cream ring-1 ring-cream/40"
                          : "border border-blue-700/60 text-blue-300 hover:bg-blue-800/25")
                      }
                    >
                      Virtue
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={attempt}
            disabled={!allGuessed || busy}
            className="mt-4 w-full rounded-lg bg-gold py-2.5 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "…" : "Attempt escape"}
          </button>
          {!allGuessed && (
            <p className="mt-2 text-center text-xs text-cream/50">
              Guess every player to attempt your escape.
            </p>
          )}
        </>
      )}

      {error && <p className="mt-2 text-center text-xs text-red-300">{error}</p>}
    </AbilityPanel>
  );
}
