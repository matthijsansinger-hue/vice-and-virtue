"use client";

import { useEffect, useState } from "react";
import { setVote, myVoters } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import { canAct, type CourtState } from "@/lib/court";
import { TrialBanner } from "./CourtTrial";
import { ExhibitCard } from "./ExhibitCard";
import type { Player } from "@/lib/types";

// Step 3 — the verdict. Guilty = a vote for the defendant, Not guilty =
// 'skip' (submit_vote, so Iron Will, Empathy, Truthfulness, Vengeance and the
// vote-reveal potion keep working). Ends when everyone has voted or on the
// clock; an unsubmitted vote is blank.
export function CourtVerdict({
  state,
  players,
  myPlayer,
  nameOf,
}: {
  state: CourtState;
  players: Player[];
  myPlayer: Player | null;
  nameOf: (id: string) => string;
}) {
  const def = state.defendant_id;
  const me = myPlayer?.id ?? null;
  const [choice, setChoice] = useState<"guilty" | "not_guilty" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [guiltyIds, setGuiltyIds] = useState<string[]>([]);

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

  async function submit() {
    if (!me || !def || !choice) return;
    setBusy(true);
    setError(null);
    try {
      await setVote(me, choice === "guilty" ? def : "skip");
    } catch {
      setError("Your vote didn't go through — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const objected = new Map(state.objections.map((o) => [o.exhibit_id, o]));
  return (
    <div className="space-y-3">
      <TrialBanner state={state} nameOf={nameOf} />
      <p className="text-center text-sm text-cream/80">
        {voted} of {voters.length} have voted
      </p>

      {mayVote && !myPlayer?.has_voted && (
        <div className="rounded-xl border-2 border-gold/60 bg-home-bg/80 p-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setChoice("guilty")}
              className={
                "rounded-lg py-3 font-semibold " +
                (choice === "guilty" ? "bg-red-700 text-cream" : "border border-red-400/60 text-red-200")
              }
            >
              Guilty
            </button>
            <button
              onClick={() => setChoice("not_guilty")}
              className={
                "rounded-lg py-3 font-semibold " +
                (choice === "not_guilty" ? "bg-green-700 text-cream" : "border border-green-400/60 text-green-200")
              }
            >
              Not guilty
            </button>
          </div>
          <button
            onClick={submit}
            disabled={!choice || busy}
            className="mt-2 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg disabled:opacity-50"
          >
            Submit
          </button>
          <p className="mt-1 text-center text-xs text-cream/60">
            Guilty sends {nameOf(def ?? "")} to prison. If you don&rsquo;t submit, your vote is blank.
          </p>
        </div>
      )}
      {mayVote && myPlayer?.has_voted && (
        <p className="text-center text-sm text-cream/80">Your vote is in.</p>
      )}
      {me === def && <p className="text-center text-sm text-cream/80">You can&rsquo;t vote on your own case.</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {armed && (
        <div className="rounded-xl border-2 border-[#b3445c]/70 bg-[#3a0b17]/80 px-3 py-2 text-sm text-cream">
          <p className="text-[10px] uppercase tracking-widest text-[#e6889a]">Vote reveal — voting Guilty</p>
          <p>{guiltyIds.length ? guiltyIds.map(nameOf).join(", ") : "Nobody yet."}</p>
        </div>
      )}

      <div className="space-y-2">
        {state.exhibits.map((e) => (
          <ExhibitCard
            key={e.id}
            exhibit={e}
            nameOf={nameOf}
            filerRole={e.side === "D" ? (e.filer_id === def ? "defendant" : "witness") : undefined}
            objection={objected.get(e.id)}
            canObject={false}
            onObject={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
