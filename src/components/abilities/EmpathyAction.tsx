"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { revealCamp } from "@/lib/game";
import type { Player } from "@/lib/types";

const VOTERS_COST = 150;
const CAMP_COST = 100;

// Empathy has two abilities (one use per day):
//   * Reveal who voted for each player in the last consultation (150 SE).
//   * Reveal a single player's camp — Vice or Virtue (100 SE).
export function EmpathyAction({
  myPlayer,
  players,
  day,
}: {
  myPlayer: Player;
  players: Player[];
  day: number;
}) {
  const [mode, setMode] = useState<"voters" | "camp" | null>(null);
  const [revealedData, setRevealedData] = useState<
    { target_id: string; voter_ids: string[] }[] | null
  >(null);
  const [campResult, setCampResult] = useState<{
    name: string;
    camp: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const alreadyUsed = myPlayer.acted_this_day;
  const nameOf = (id: string) =>
    players.find((p) => p.id === id)?.name ?? "?";

  async function revealVoters() {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.rpc("reveal_votes_empathy", {
        p_player_id: myPlayer.id,
      });
      setRevealedData(
        (data as { target_id: string; voter_ids: string[] }[]) ?? []
      );
    } finally {
      setBusy(false);
    }
  }

  async function revealOneCamp(target: Player) {
    if (busy) return;
    setBusy(true);
    try {
      const camp = await revealCamp(myPlayer.id, target.id);
      if (camp) setCampResult({ name: target.name, camp });
    } finally {
      setBusy(false);
    }
  }

  // Result: vote map.
  if (revealedData) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Empathy &mdash; last consultation
        </p>
        {revealedData.length === 0 ? (
          <p className="mt-3 text-sm text-home-bg/60 italic">
            No one received any votes in the last consultation.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {revealedData.map(({ target_id, voter_ids }) => (
              <li
                key={target_id}
                className="rounded-lg border border-home-bg/10 bg-home-bg/5 px-3 py-2"
              >
                <p className="text-sm font-semibold">
                  Voters for {nameOf(target_id)}
                </p>
                <p className="mt-1 text-sm text-home-bg/80">
                  {voter_ids.map(nameOf).join(", ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Result: one player's camp.
  if (campResult) {
    return (
      <div className="rounded-xl border border-gold/40 bg-cream p-5 text-home-bg">
        <p className="text-sm uppercase tracking-widest text-home-bg/60">
          Empathy &mdash; {campResult.name}
        </p>
        <p className="mt-3 text-2xl font-semibold">
          {campResult.camp === "vice" ? "Vice" : "Virtue"}
        </p>
        <p className="mt-1 text-xs text-home-bg/60">Their camp.</p>
      </div>
    );
  }

  if (alreadyUsed) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Empathy</p>
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Empathy today.
        </p>
      </div>
    );
  }

  // Mode chooser.
  if (mode === null) {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Empathy</p>
        <p className="mt-2 text-sm text-cream/80">
          Choose your ability for today.
        </p>
        <p className="mt-2 text-xs text-cream/60">
          Soul Energy:{" "}
          <span className="font-semibold">{myPlayer.soul_energy}</span>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={() => setMode("voters")}
            disabled={day === 1 || myPlayer.soul_energy < VOTERS_COST}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Reveal who voted for each player last consultation (150 SE)
          </button>
          <button
            onClick={() => setMode("camp")}
            disabled={myPlayer.soul_energy < CAMP_COST}
            className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Reveal one player&rsquo;s camp (100 SE)
          </button>
        </div>
        {day === 1 && (
          <p className="mt-2 text-xs text-cream/60 italic">
            Vote reveal is available from day 2.
          </p>
        )}
      </div>
    );
  }

  if (mode === "voters") {
    return (
      <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
        <p className="text-sm uppercase tracking-widest text-gold">Empathy</p>
        <p className="mt-2 text-sm text-cream/80">
          Reveal, for every player, who voted to imprison them last
          consultation.
        </p>
        <button
          onClick={revealVoters}
          disabled={busy || myPlayer.soul_energy < VOTERS_COST}
          className="mt-4 w-full rounded-lg border border-gold bg-cream px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Revealing…" : `Reveal votes (${VOTERS_COST} SE)`}
        </button>
        <button
          onClick={() => setMode(null)}
          disabled={busy}
          className="mt-2 w-full rounded-lg border border-gold/50 px-4 py-2 text-sm text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
        >
          Back
        </button>
      </div>
    );
  }

  // mode === "camp": pick a target.
  const targets = players.filter((p) => p.id !== myPlayer.id);
  return (
    <div className="rounded-xl border border-gold/40 bg-reflection-fg/30 p-5 text-cream">
      <p className="text-sm uppercase tracking-widest text-gold">Empathy</p>
      <p className="mt-2 text-sm text-cream/80">
        Pick a player to reveal their camp (100 SE).
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {targets.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => revealOneCamp(p)}
              disabled={busy}
              className="w-full rounded-lg border border-gold bg-cream px-4 py-2 text-left text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => setMode(null)}
        disabled={busy}
        className="mt-2 w-full rounded-lg border border-gold/50 px-4 py-2 text-sm text-cream transition-colors hover:bg-cream/10 disabled:opacity-50"
      >
        Back
      </button>
    </div>
  );
}
