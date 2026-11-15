"use client";

import { useEffect, useState } from "react";
import { setVote, myVoters } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { heading, SoulFlame } from "@/components/ui/royal";
import { CHARGE_LABEL, canAct, chargeTotal, potOf, triedCharges, type CourtState } from "@/lib/court";
import { usePlayerCharacters } from "@/lib/usePlayerCharacters";
import { ExhibitCard } from "./ExhibitCard";
import { DeskRow, DeskSurface } from "./Desk";
import { Name, useCourtNames } from "./names";
import type { Player } from "@/lib/types";

// Step 3 — the verdict. The defendant stands in the dock; everyone who may
// vote presses Guilty or Not guilty, and can change it until the verdict
// closes. Guilty = a vote for the defendant, Not guilty = 'skip'
// (submit_vote, so Iron Will, Empathy, Truthfulness, Vengeance and the
// vote-reveal potion keep working). Ends when everyone has voted or on the
// clock; no vote is blank. The proof stays on the desk below.

type Choice = "guilty" | "not_guilty";

export function CourtVerdict({
  state,
  players,
  myPlayer,
}: {
  state: CourtState;
  players: Player[];
  myPlayer: Player | null;
}) {
  const { nameOf } = useCourtNames();
  const characters = usePlayerCharacters(players);
  const def = state.defendant_id;
  const defPlayer = players.find((p) => p.id === def) ?? null;
  const me = myPlayer?.id ?? null;
  const [mine, setMine] = useState<Choice | null>(null);
  const [busy, setBusy] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [guiltyIds, setGuiltyIds] = useState<string[]>([]);
  // The dead see all: everyone's vote, live (spectator_secrets is dead-gated).
  const [deadVotes, setDeadVotes] = useState<Map<string, string | null> | null>(null);

  const voters = players.filter((p) => canAct(p) && p.id !== def);
  const voted = voters.filter((p) => p.has_voted).length;
  const mayVote = canAct(myPlayer) && me !== def;

  // The vote-reveal potion: the defendant sees, live, who votes Guilty.
  useEffect(() => {
    if (!me || me !== def) return;
    let cancelled = false;
    supabase.rpc("my_potions", { p_player_id: me }).then(({ data }) => {
      if (!cancelled && data) setArmed(!!(data as { vote_reveal?: boolean }).vote_reveal);
    });
    return () => {
      cancelled = true;
    };
  }, [me, def]);
  useEffect(() => {
    if (!armed || !me) return;
    let cancelled = false;
    const poll = async () => {
      const ids = await myVoters(me);
      if (!cancelled) setGuiltyIds(ids);
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [armed, me]);

  const iAmDead = !!myPlayer?.dead;
  useEffect(() => {
    if (!iAmDead || !me) return;
    let cancelled = false;
    const poll = async () => {
      const { data } = await supabase.rpc("spectator_secrets", { p_player_id: me });
      const d = data as { ok?: boolean; players?: { player_id: string; vote: string | null }[] } | null;
      if (!cancelled && d?.ok && Array.isArray(d.players)) {
        setDeadVotes(new Map(d.players.map((x) => [x.player_id, x.vote])));
      }
    };
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [iAmDead, me]);

  // One press casts (or changes) your vote.
  async function vote(choice: Choice) {
    if (!me || !def || busy) return;
    setBusy(choice);
    setError(null);
    try {
      await setVote(me, choice === "guilty" ? def : "skip");
      setMine(choice);
    } catch {
      setError("Your vote didn't go through. Check your connection and press again.");
    } finally {
      setBusy(null);
    }
  }

  const charges = triedCharges(state);
  const [main, ...rest] = charges;
  const objected = new Map(state.objections.map((o) => [o.exhibit_id, o]));
  const sheets = (side: "P" | "D") =>
    state.exhibits
      .filter((e) => e.side === side)
      .sort((x, y) => x.number - y.number)
      .map((e) => (
        <ExhibitCard
          key={e.id}
          exhibit={e}
          filerRole={e.side === "D" ? (e.filer_id === def ? "defendant" : "witness") : undefined}
          objection={objected.get(e.id)}
          canObject={false}
          onObject={() => {}}
        />
      ));
  const pros = sheets("P");
  const defence = sheets("D");
  const voteNote = !myPlayer
    ? null
    : me === def
      ? "You can't vote on your own case."
      : myPlayer.dead
        ? "The dead don't vote."
        : myPlayer.in_prison
          ? "You can't vote from the dungeon."
          : myPlayer.in_hospital
            ? "You can't vote from the infirmary."
            : null;

  return (
    <div className="space-y-4">
      {/* The dock */}
      {def && (
        <div className="mx-auto w-full max-w-sm">
          <div
            className="relative overflow-hidden rounded-t-xl border-x-4 border-t-4 border-[#2b1a0e] pt-5"
            style={{
              background:
                "radial-gradient(ellipse 55% 60% at 50% 30%, rgba(255,207,122,.32), transparent 72%), repeating-linear-gradient(90deg, #2e1d10 0 44px, #26180d 44px 46px)",
            }}
          >
            <div className="flex justify-center">
              <CharacterAvatar
                character={characters[defPlayer?.shown_as ?? def] ?? null}
                initials={nameOf(def).charAt(0).toUpperCase()}
                variant="full"
                className="h-40 w-40 sm:h-48 sm:w-48"
                textClass="text-3xl"
              />
            </div>
          </div>
          {/* The dock's rail, with their name on it. */}
          <div
            className="relative -mt-6 rounded-b-xl border-4 border-[#2b1a0e] px-4 pb-3 pt-3 text-center shadow-[0_10px_22px_rgba(0,0,0,.4)]"
            style={{ background: "linear-gradient(180deg, #8a5c34 0 7px, #6b4526 7px)" }}
          >
            <Name id={def} />
            {main && (
              <p className="mt-1.5 text-sm text-[#fbefd5]">
                Charged with {CHARGE_LABEL[main.kind]}
                {main.victim_id && <> of {nameOf(main.victim_id)}</>}
                {rest.length > 0 && (
                  <span className="text-[#fbefd5]/75">
                    , and also{" "}
                    {rest.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 ? ", " : ""}
                        {CHARGE_LABEL[c.kind]} ({chargeTotal(c)})
                      </span>
                    ))}
                  </span>
                )}
              </p>
            )}
            <p className="mt-1 flex items-center justify-center gap-1 text-xs text-[#fbefd5]/80">
              Pot {potOf(state)} <SoulFlame size={12} />
            </p>
          </div>
        </div>
      )}

      <p className="text-center text-base font-bold text-home-bg" aria-live="polite">
        {voted} of {voters.length} have voted
      </p>

      {mayVote ? (
        <div className="mx-auto max-w-md">
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["guilty", "Guilty", "#8e1418"],
                ["not_guilty", "Not guilty", "#1d5a2c"],
              ] as const
            ).map(([id, label, bg]) => {
              const chosen = mine === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => vote(id)}
                  disabled={!!busy}
                  aria-pressed={chosen}
                  className={
                    `rounded-xl py-4 text-lg font-bold text-[#fff4e4] shadow-[0_4px_12px_rgba(0,0,0,.3)] transition-[opacity,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-xl ${heading} ` +
                    (chosen ? "ring-4 ring-gold " : "") +
                    (mine && !chosen ? "opacity-55 hover:opacity-80 " : "hover:opacity-90 ")
                  }
                  style={{ background: bg }}
                >
                  {busy === id ? "…" : label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-xs text-home-bg/75">
            {mine
              ? `You voted ${mine === "guilty" ? "Guilty" : "Not guilty"}. You can change it until the verdict closes.`
              : myPlayer?.has_voted
                ? "Your vote is in. You can change it until the verdict closes."
                : "Guilty sends them to prison. If you don't vote, your vote is blank."}
          </p>
        </div>
      ) : (
        voteNote && <p className="text-center text-sm font-semibold text-home-bg">{voteNote}</p>
      )}
      {error && (
        <p role="alert" className="text-center text-sm font-semibold text-[#b3141b]">
          {error}
        </p>
      )}

      {iAmDead && deadVotes && (
        <div className="mx-auto max-w-md rounded-xl border-2 border-[#5b4a7a] bg-[#1d1630] px-3 py-2.5 text-sm text-cream">
          <p className="text-xs font-semibold text-[#c9b8f0]">How everyone is voting (only the dead see this)</p>
          {(
            [
              ["Guilty", voters.filter((p) => deadVotes.get(p.id) === def)],
              ["Not guilty", voters.filter((p) => deadVotes.get(p.id) === "skip")],
              ["Not voted yet", voters.filter((p) => !deadVotes.get(p.id))],
            ] as const
          ).map(([label, list]) => (
            <p key={label} className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-cream/70">{label}:</span>
              {list.length ? list.map((p) => <Name key={p.id} id={p.id} small />) : <span className="text-xs text-cream/45">nobody</span>}
            </p>
          ))}
        </div>
      )}

      {armed && (
        <div className="mx-auto max-w-md rounded-xl border-2 border-[#b3445c] bg-[#3a0b17] px-3 py-2 text-sm text-cream">
          <p className="text-xs font-semibold text-[#e6889a]">Your vote reveal: voting Guilty right now</p>
          <p className="mt-1 flex flex-wrap gap-1">
            {guiltyIds.length ? guiltyIds.map((id) => <Name key={id} id={id} small />) : "Nobody yet."}
          </p>
        </div>
      )}

      {(pros.length > 0 || defence.length > 0) && (
        <DeskSurface>
          {pros.length > 0 && <DeskRow side="P">{pros}</DeskRow>}
          {defence.length > 0 && <DeskRow side="D">{defence}</DeskRow>}
        </DeskSurface>
      )}
    </div>
  );
}
