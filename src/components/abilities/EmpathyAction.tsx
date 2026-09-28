"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { empathyReadMessages, type EmpathyMessage } from "@/lib/game";
import { useAbilityAnimation } from "@/components/animations/AnimationProvider";
import { clipForAbility } from "@/lib/animations/abilityClips";
import type { Player } from "@/lib/types";
import {
  AbilityPanel,
  ParchmentCard,
  CostLine,
  TargetList,
  AbilityOption,
  BackButton,
} from "./ui";
import { SoulEnergyText } from "@/components/ui/royal";

const VOTERS_COST = 150;
const MESSAGES_COST = 150;

const MESSAGES_ERROR: Record<string, string> = {
  too_early: "There's no conversation to read before day 2.",
  already_acted: "You already used Empathy today.",
  not_enough: "Not enough Soul Energy.",
  bad_target: "Pick two other players.",
  wrong_phase: "The role phase has ended.",
};

// Empathy has two abilities (one use per day, both from day 2):
//   * Reveal who voted for each player in the last consultation (150 SE).
//   * Read the private Outreach messages between two players from last night
//     (150 SE) — migration 123, replaced the old camp reveal.
export function EmpathyAction({
  myPlayer,
  players,
  day,
}: {
  myPlayer: Player;
  players: Player[];
  day: number;
}) {
  const [mode, setMode] = useState<"voters" | "messages" | null>(null);
  const { play } = useAbilityAnimation();
  const [revealedData, setRevealedData] = useState<
    { target_id: string; voter_ids: string[] }[] | null
  >(null);
  // Messages mode: the two picked players, then the conversation.
  const [pickA, setPickA] = useState<Player | null>(null);
  const [pickB, setPickB] = useState<Player | null>(null);
  const [transcript, setTranscript] = useState<{
    a: Player;
    b: Player;
    messages: EmpathyMessage[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      await play(clipForAbility("empathy"));
      setRevealedData(
        (data as { target_id: string; voter_ids: string[] }[]) ?? []
      );
    } finally {
      setBusy(false);
    }
  }

  async function readMessages() {
    if (busy || !pickA || !pickB) return;
    setBusy(true);
    setError(null);
    try {
      const res = await empathyReadMessages(myPlayer.id, pickA.id, pickB.id);
      if (!res.ok) {
        setError(MESSAGES_ERROR[res.reason ?? ""] ?? "That didn't go through — try again.");
        return;
      }
      await play(clipForAbility("empathy"));
      setTranscript({ a: pickA, b: pickB, messages: res.messages ?? [] });
    } finally {
      setBusy(false);
    }
  }

  // Tap to pick the first player, then the second; tap a picked one to unpick.
  function togglePick(p: Player) {
    setError(null);
    if (pickA?.id === p.id) {
      setPickA(pickB);
      setPickB(null);
    } else if (pickB?.id === p.id) {
      setPickB(null);
    } else if (!pickA) {
      setPickA(p);
    } else {
      setPickB(p);
    }
  }

  // Result: vote map.
  if (revealedData) {
    return (
      <ParchmentCard kicker="Empathy — last consultation">
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
      </ParchmentCard>
    );
  }

  // Result: last night's conversation between the two picked players.
  if (transcript) {
    return (
      <ParchmentCard kicker={`Empathy — ${transcript.a.name} & ${transcript.b.name}`}>
        <p className="mt-1 text-xs text-home-bg/60">Their private messages from last night.</p>
        {transcript.messages.length === 0 ? (
          <p className="mt-3 text-sm text-home-bg/60 italic">
            They didn&rsquo;t say a word to each other.
          </p>
        ) : (
          <ul className="mt-3 flex max-h-80 flex-col gap-2 overflow-y-auto">
            {transcript.messages.map((m, i) => (
              <li
                key={i}
                className="rounded-lg border border-home-bg/10 bg-home-bg/5 px-3 py-2"
              >
                <p className="text-xs font-semibold text-home-bg/70">
                  {m.sender_id === transcript.a.id ? transcript.a.name : transcript.b.name}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{m.text}</p>
              </li>
            ))}
          </ul>
        )}
      </ParchmentCard>
    );
  }

  if (alreadyUsed) {
    return (
      <AbilityPanel title="Empathy">
        <p className="mt-4 text-sm text-cream/60 italic">
          You already used Empathy today.
        </p>
      </AbilityPanel>
    );
  }

  // Mode chooser.
  if (mode === null) {
    return (
      <AbilityPanel title="Empathy">
        <p className="mt-2 text-sm text-cream/80">
          Choose your ability for today.
        </p>
        <CostLine have={myPlayer.soul_energy} />
        <div className="mt-4 flex flex-col gap-2">
          <AbilityOption
            onClick={() => setMode("voters")}
            disabled={day === 1 || myPlayer.soul_energy < VOTERS_COST}
            cost={VOTERS_COST}
          >
            Reveal who voted for each player last consultation
          </AbilityOption>
          <AbilityOption
            onClick={() => setMode("messages")}
            disabled={day === 1 || myPlayer.soul_energy < MESSAGES_COST}
            cost={MESSAGES_COST}
          >
            Read two players&rsquo; messages from last night
          </AbilityOption>
        </div>
        {day === 1 && (
          <p className="mt-2 text-xs text-cream/60 italic">
            Both abilities unlock on day 2 &mdash; there&rsquo;s no vote or
            conversation to look back on yet.
          </p>
        )}
      </AbilityPanel>
    );
  }

  if (mode === "voters") {
    return (
      <AbilityPanel title="Empathy">
        <p className="mt-2 text-sm text-cream/80">
          Reveal, for every player, who voted to imprison them last
          consultation.
        </p>
        <div className="mt-4">
          <AbilityOption
            onClick={revealVoters}
            disabled={busy || myPlayer.soul_energy < VOTERS_COST}
            cost={VOTERS_COST}
          >
            <span className="font-semibold">
              {busy ? "Revealing…" : "Reveal votes"}
            </span>
          </AbilityOption>
        </div>
        <BackButton onClick={() => setMode(null)} disabled={busy} />
      </AbilityPanel>
    );
  }

  // mode === "messages": pick two players, then read.
  const targets = players.filter((p) => p.id !== myPlayer.id);
  return (
    <AbilityPanel title="Empathy">
      <p className="mt-2 text-sm text-cream/80">
        <SoulEnergyText>
          Pick two players to read what they said to each other last night (150 SE).
        </SoulEnergyText>
      </p>
      <TargetList
        targets={targets}
        onPick={togglePick}
        disabled={busy}
        tag={(p) =>
          p.id === pickA?.id || p.id === pickB?.id ? (
            <span className="text-xs font-semibold text-gold">&#10003; picked</span>
          ) : null
        }
      />
      <div className="mt-4">
        <AbilityOption
          onClick={readMessages}
          disabled={busy || !pickA || !pickB || myPlayer.soul_energy < MESSAGES_COST}
          cost={MESSAGES_COST}
        >
          <span className="font-semibold">
            {busy
              ? "Reading…"
              : pickA && pickB
                ? `Read ${pickA.name} & ${pickB.name}`
                : "Pick two players"}
          </span>
        </AbilityOption>
      </div>
      {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
      <BackButton
        onClick={() => {
          setMode(null);
          setPickA(null);
          setPickB(null);
          setError(null);
        }}
        disabled={busy}
      />
    </AbilityPanel>
  );
}
