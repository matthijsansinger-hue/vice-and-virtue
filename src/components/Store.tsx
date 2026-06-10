"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setReady, endStore, buyPotion, STORE_SECONDS } from "@/lib/game";
import { CONTINUE_SECONDS, setContinueDeadline } from "@/lib/useMajorityAdvance";
import { displayedName } from "@/lib/swaps";
import { DeadChat } from "./DeadChat";
import { PhaseTip } from "./PhaseTip";
import type { Player, Room } from "@/lib/types";

// The store sits between outreach and the consultation group action. Each
// active player privately spends Soul Energy on single-use, day-long potions.
//
// Batch 2a wires the two potions that don't touch the role-action engine:
//   * Camp reveal (200 SE) — instant: reveals one player's camp.
//   * Minigame x2  ( 60 SE) — doubles the Soul Energy you earn next minigame.
// The combat potions (kill/hospitalise/protection) and the vote-reveal potion
// are shown as "Soon" until later batches wire their effects.

type PotionId =
  | "kill"
  | "hospitalise"
  | "protect"
  | "camp_reveal"
  | "minigame_mult"
  | "vote_reveal";

type PotionDef = {
  id: PotionId;
  name: string;
  cost: number;
  blurb: string;
  timing: string;
  // false until the effect is wired in a later batch.
  active: boolean;
  needsTarget?: boolean;
};

const POTIONS: PotionDef[] = [
  {
    id: "kill",
    name: "Kill potion",
    cost: 300,
    blurb: "Kill a chosen player.",
    timing: "Next reflection · protection can block it",
    active: false,
    needsTarget: true,
  },
  {
    id: "hospitalise",
    name: "Hospitalise potion",
    cost: 200,
    blurb: "Send a player to hospital for a day.",
    timing: "Next reflection · protection can block it",
    active: false,
    needsTarget: true,
  },
  {
    id: "protect",
    name: "Protection potion",
    cost: 200,
    blurb: "Shield yourself for the next day.",
    timing: "Blocks kills + hospitalise next reflection",
    active: false,
  },
  {
    id: "camp_reveal",
    name: "Camp reveal potion",
    cost: 200,
    blurb: "Reveal one player's camp — Vice or Virtue.",
    timing: "Instant",
    active: true,
    needsTarget: true,
  },
  {
    id: "minigame_mult",
    name: "Minigame multiplier (x2)",
    cost: 60,
    blurb: "Double the Soul Energy you earn.",
    timing: "Your next minigame",
    active: true,
  },
  {
    id: "vote_reveal",
    name: "Vote reveal potion",
    cost: 100,
    blurb: "See who will vote for you in the imprisonment phase.",
    timing: "This consultation",
    active: false,
  },
];

const CAMP_REVEAL = POTIONS.find((p) => p.id === "camp_reveal")!;

type Armed = {
  minigame_mult: boolean;
  protect: boolean;
  kill: boolean;
  hospitalise: boolean;
  vote_reveal: boolean;
};
const NO_ARMED: Armed = {
  minigame_mult: false,
  protect: false,
  kill: false,
  hospitalise: false,
  vote_reveal: false,
};

export function Store({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [resetSeen, setResetSeen] = useState(false);
  const advancedRef = useRef(false);

  const [armed, setArmed] = useState<Armed>(NO_ARMED);
  const [busy, setBusy] = useState<PotionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Camp-reveal: the open target picker + the camps revealed so far.
  const [picking, setPicking] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; camp: string }[]>(
    []
  );

  const isHost = myPlayer?.is_host ?? false;
  const isActive =
    !!myPlayer && !myPlayer.dead && !myPlayer.in_prison && !myPlayer.in_hospital;
  const eligible = players.filter(
    (p) => !p.dead && !p.in_prison && !p.in_hospital
  );

  // Ticking clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const endsAt = room.phase_ends_at
    ? new Date(room.phase_ends_at).getTime()
    : null;
  const remainingSec = endsAt
    ? Math.max(0, Math.ceil((endsAt - now) / 1000))
    : STORE_SECONDS;
  const expired = endsAt !== null && now >= endsAt;

  // Load my armed potions (so "bought" state survives a refresh mid-store).
  useEffect(() => {
    if (!myPlayer) return;
    let cancelled = false;
    supabase.rpc("my_potions", { p_player_id: myPlayer.id }).then(({ data }) => {
      if (cancelled || !data) return;
      const d = data as Partial<Armed>;
      setArmed({
        minigame_mult: d.minigame_mult ?? false,
        protect: d.protect ?? false,
        kill: d.kill ?? false,
        hospitalise: d.hospitalise ?? false,
        vote_reveal: d.vote_reveal ?? false,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [myPlayer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset-seen guard (same pattern as outreach / group action).
  useEffect(() => {
    if (eligible.length > 0 && eligible.every((p) => !p.ready)) {
      setResetSeen(true);
    }
  }, [players]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-mark ready when the timer runs out.
  useEffect(() => {
    if (expired && isActive && myPlayer && !myPlayer.ready) {
      setReady(myPlayer.id, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired]);

  // Majority pressed Done → shorten the timer to a visible 10s countdown.
  const readyCount = eligible.filter((p) => p.ready).length;
  const majority =
    resetSeen && eligible.length > 0 && readyCount * 2 > eligible.length;
  useEffect(() => {
    if (!isHost || !majority) return;
    if (endsAt !== null && endsAt - Date.now() <= (CONTINUE_SECONDS + 0.5) * 1000) {
      return;
    }
    void setContinueDeadline(room.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, majority, endsAt, room.id]);

  // Host advances to the group action when the (possibly shortened) timer
  // elapses, plus a short grace so stragglers' auto-ready writes land first.
  useEffect(() => {
    if (!isHost || advancedRef.current) return;
    if (endsAt !== null && now >= endsAt + 1500) {
      advancedRef.current = true;
      endStore(room.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, now, endsAt, room.id]);

  async function done() {
    if (!myPlayer || myPlayer.ready) return;
    await setReady(myPlayer.id, true);
  }

  async function buy(potion: PotionDef, targetId?: string) {
    if (!myPlayer || busy) return;
    setBusy(potion.id);
    setError(null);
    try {
      const res = await buyPotion(myPlayer.id, potion.id, targetId);
      if (!res.ok) {
        setError(buyError(res.error));
        return;
      }
      if (potion.id === "camp_reveal" && res.camp && targetId) {
        const t = players.find((p) => p.id === targetId);
        setRevealed((prev) => [
          ...prev,
          {
            name: t ? displayedName(t, room, players, myPlayer?.id) : "?",
            camp: res.camp as string,
          },
        ]);
        setPicking(false);
      } else if (potion.id === "minigame_mult") {
        setArmed((a) => ({ ...a, minigame_mult: true }));
      }
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <div className="text-center">
      <p className="text-xs uppercase tracking-widest text-outreach-outline/70">
        Day {room.day} &mdash; store
      </p>
      <p className="mt-1 text-4xl font-semibold tabular-nums">
        {remainingSec}
        <span className="text-xl text-outreach-outline/60">s</span>
      </p>
    </div>
  );

  // Passive screen for dead / prison / hospital.
  if (myPlayer && !isActive) {
    const label = myPlayer.dead
      ? "You're dead"
      : myPlayer.in_hospital
        ? "You're in hospital"
        : "You're in prison";
    return (
      <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-6 pb-12 pt-16 text-outreach-outline">
        <div className="w-full max-w-sm text-center">
          {header}
          <p className="mt-4 text-2xl font-semibold">{label}</p>
          <p className="mt-2 text-outreach-outline/70">
            You can&rsquo;t visit the store this round.
          </p>
        </div>
        {myPlayer.dead && (
          <div className="mt-6 w-full max-w-sm">
            <DeadChat room={room} players={players} myPlayer={myPlayer} />
          </div>
        )}
      </main>
    );
  }

  const se = myPlayer?.soul_energy ?? 0;

  return (
    <main className="flex min-h-screen flex-col items-center outreach-castle-bg px-4 pb-10 pt-16 text-outreach-outline">
      <div className="w-full max-w-3xl">
        {header}

        <PhaseTip
          id="store"
          text="Before the vote, spend your Soul Energy on single-use potions that last one day. Each is bought privately — no one sees what you buy."
        />

        {/* Soul Energy on hand. */}
        <p className="mt-3 text-center text-sm text-outreach-outline/80">
          Your Soul Energy:{" "}
          <span className="font-semibold text-gold">{se}</span>
        </p>

        {error && (
          <p className="mt-2 text-center text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        {/* Potion grid. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {POTIONS.map((potion) => {
            const isArmed =
              (potion.id === "minigame_mult" && armed.minigame_mult) ||
              (potion.id === "protect" && armed.protect) ||
              (potion.id === "kill" && armed.kill) ||
              (potion.id === "hospitalise" && armed.hospitalise) ||
              (potion.id === "vote_reveal" && armed.vote_reveal);
            const canAfford = se >= potion.cost;
            const isBusy = busy === potion.id;

            return (
              <div
                key={potion.id}
                className={
                  "flex flex-col rounded-xl border bg-cream/90 p-4 text-outreach-outline " +
                  (potion.active
                    ? "border-outreach-outline/30"
                    : "border-outreach-outline/15 opacity-70")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{potion.name}</h3>
                  <span className="shrink-0 rounded bg-gold/20 px-2 py-0.5 text-xs font-semibold text-outreach-outline">
                    {potion.cost} SE
                  </span>
                </div>
                <p className="mt-1 text-sm text-outreach-outline/80">
                  {potion.blurb}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-outreach-outline/55">
                  {potion.timing}
                </p>

                <div className="mt-3 flex-1" />

                {!potion.active ? (
                  <span className="mt-1 inline-block rounded-lg border border-outreach-outline/20 px-3 py-2 text-center text-xs font-semibold text-outreach-outline/50">
                    Soon
                  </span>
                ) : isArmed ? (
                  <span className="mt-1 inline-block rounded-lg border-2 border-outreach-outline/50 bg-outreach-outline/10 px-3 py-2 text-center text-sm font-semibold">
                    Bought &mdash; active
                  </span>
                ) : potion.id === "camp_reveal" ? (
                  <button
                    onClick={() => {
                      setError(null);
                      setPicking((v) => !v);
                    }}
                    disabled={!canAfford || isBusy}
                    className="mt-1 w-full rounded-lg bg-outreach-outline py-2 text-sm font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {picking ? "Choose below…" : `Reveal a camp (${potion.cost} SE)`}
                  </button>
                ) : (
                  <button
                    onClick={() => buy(potion)}
                    disabled={!canAfford || isBusy}
                    className="mt-1 w-full rounded-lg bg-outreach-outline py-2 text-sm font-semibold text-cream transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {isBusy ? "Buying…" : `Buy (${potion.cost} SE)`}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Camp-reveal target picker. */}
        {picking && (
          <div className="mt-4 rounded-xl border border-outreach-outline/30 bg-cream/90 p-4">
            <p className="text-sm font-semibold">
              Whose camp do you want revealed? (200 SE)
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {players
                .filter((p) => p.id !== myPlayer?.id)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => buy(CAMP_REVEAL, p.id)}
                      disabled={busy === "camp_reveal" || se < 200}
                      className="w-full rounded-lg border border-outreach-outline/40 bg-cream px-3 py-2 text-left text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                    >
                      {displayedName(p, room, players, myPlayer?.id)}
                    </button>
                  </li>
                ))}
            </ul>
            <button
              onClick={() => setPicking(false)}
              className="mt-3 text-xs font-semibold text-outreach-outline/70 underline"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Revealed camps so far. */}
        {revealed.length > 0 && (
          <div className="mt-4 rounded-xl border border-gold/40 bg-cream/90 p-4">
            <p className="text-xs uppercase tracking-widest text-outreach-outline/60">
              Camps revealed
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {revealed.map((r, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold">{r.name}</span> is a{" "}
                  <span
                    className={
                      "font-semibold " +
                      (r.camp === "vice"
                        ? "text-consultation-bg"
                        : "text-consultation-fg")
                    }
                  >
                    {r.camp === "vice" ? "Vice" : "Virtue"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Done / waiting. */}
        <div className="mx-auto mt-6 max-w-sm">
          {myPlayer?.ready ? (
            <div className="w-full rounded-lg border-2 border-outreach-outline/60 bg-outreach-outline/15 py-3 text-center font-semibold text-outreach-outline">
              Done &mdash; waiting for the others
              <p className="mt-1 text-xs font-normal text-outreach-outline/70">
                You can keep shopping until the phase ends.
              </p>
            </div>
          ) : (
            <button
              onClick={done}
              className="w-full rounded-lg bg-outreach-outline py-3 font-semibold text-cream transition-opacity hover:opacity-90"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function buyError(code: string | undefined): string {
  switch (code) {
    case "insufficient_se":
      return "Not enough Soul Energy.";
    case "already_bought":
      return "You already have that potion.";
    case "bad_target":
      return "Pick a valid player.";
    case "inactive":
      return "You can't shop this round.";
    case "not_store":
      return "The store is closed.";
    default:
      return "Couldn't buy that. Try again.";
  }
}
