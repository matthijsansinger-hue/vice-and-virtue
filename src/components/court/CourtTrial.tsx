"use client";

import { useEffect, useState } from "react";
import {
  CHARGE_LABEL,
  EXHIBIT_COST,
  WITNESS_WINDOW_S,
  acceptedWitness,
  canAct,
  chargeTotal,
  courtCall,
  potOf,
  prosecution,
  reasonText,
  triedCharges,
  type CourtState,
  type Exhibit,
} from "@/lib/court";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { heading, SoulFlame } from "@/components/ui/royal";
import { usePlayerCharacters } from "@/lib/usePlayerCharacters";
import { ExhibitCard } from "./ExhibitCard";
import { ExhibitComposer } from "./ExhibitComposer";
import { BlankSheet, DeskRow, DeskSurface } from "./Desk";
import { WarrantSheet } from "./BountyBoard";
import { Name, useCourtNames } from "./names";
import type { Player } from "@/lib/types";

// Who's on trial, for what, and the pot — above the desk in both halves.
export function TrialBanner({ state, players }: { state: CourtState; players: Player[] }) {
  const characters = usePlayerCharacters(players);
  const { nameOf } = useCourtNames();
  const def = state.defendant_id;
  const charges = triedCharges(state);
  const pros = prosecution(state);
  if (!def || charges.length === 0) return null;
  const [main, ...rest] = charges;
  const defPlayer = players.find((p) => p.id === def);
  return (
    <div className="rounded-xl border-2 border-gold bg-home-bg p-4 text-cream shadow-[0_6px_18px_rgba(0,0,0,.3)]">
      <div className="flex items-center gap-3">
        <span className="block h-14 w-14 shrink-0 rounded-full shadow-[0_0_0_2px_#e3b510]">
          <CharacterAvatar
            character={characters[defPlayer?.shown_as ?? def] ?? null}
            initials={nameOf(def).charAt(0).toUpperCase()}
            className="h-full w-full"
            textClass="text-base"
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`flex flex-wrap items-center gap-2 text-lg font-bold ${heading}`}>
              <Name id={def} />
              <span>is on trial</span>
            </p>
            <span className="flex items-center gap-1 rounded-lg bg-gold px-3 py-1 text-sm font-black text-home-bg">
              Pot {potOf(state)}
              <SoulFlame size={13} />
            </span>
          </div>
          <p className="mt-1 text-sm">
            Charged with <strong>{CHARGE_LABEL[main.kind]}</strong>
            {main.victim_id ? <> of <Name id={main.victim_id} small /></> : null}
            {rest.length > 0 && (
              <span className="text-cream/75">
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
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-cream/60">Prosecution:</span>
        {[...pros].map(([id, n]) => (
          <span key={id} className="inline-flex items-center gap-1 font-semibold">
            <Name id={id} small />
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

// Step 2 — the trial: the case against, then the defence, on a desk seen
// from above. Each side's proof lies there as sheets of paper next to each
// other; an empty dashed sheet at the end of your side's row files yours.
export function CourtTrial({
  state,
  players,
  myPlayer,
}: {
  state: CourtState;
  players: Player[];
  myPlayer: Player | null;
}) {
  const { nameOf } = useCourtNames();
  const me = myPlayer?.id ?? null;
  const def = state.defendant_id;
  const half = state.step === "against" ? "against" : "defence";
  const pros = prosecution(state);
  const witness = state.witness;
  const accepted = acceptedWitness(state);
  const iAmDefendant = !!me && me === def && !myPlayer?.dead;
  const iAmWitness = !!me && me === accepted && !myPlayer?.dead;
  const iAmProsecutor = !!me && pros.has(me) && canAct(myPlayer);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callee, setCallee] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await courtCall(fn, args);
      if (!res.ok) setError(reasonText(res.reason));
      return res;
    } finally {
      setBusy(false);
    }
  }

  const myExhibit = state.exhibits.some((e) => e.side === "P" && e.filer_id === me);
  const myCounter = state.exhibits.some((e) => e.side === "D" && e.filer_id === me);
  const canFileExhibit = half === "against" && iAmProsecutor && !myExhibit;
  const canFileCounter = half === "defence" && (iAmDefendant || iAmWitness) && !myCounter;
  const objected = new Map(state.objections.map((o) => [o.exhibit_id, o]));
  const mayObject = (side: "P" | "D") => (side === "P" ? iAmDefendant || iAmWitness : iAmProsecutor);

  // Who the defendant may call: anyone alive with no stake in the case.
  const callable = players.filter((p) => !p.dead && p.id !== def && !pros.has(p.id));
  const callLeft =
    witness?.status === "called"
      ? Math.max(0, WITNESS_WINDOW_S - Math.floor((now - Date.parse(witness.called_at)) / 1000))
      : 0;
  const prosSheets = state.exhibits.filter((e) => e.side === "P").sort((x, y) => x.number - y.number);
  const defSheets = state.exhibits.filter((e) => e.side === "D").sort((x, y) => x.number - y.number);
  const sheet = (e: Exhibit) => (
    <ExhibitCard
      key={e.id}
      exhibit={e}
      filerRole={e.side === "D" ? (e.filer_id === def ? "defendant" : "witness") : undefined}
      objection={objected.get(e.id)}
      canObject={e.status === "standing" && !objected.has(e.id) && e.filer_id !== me && mayObject(e.side)}
      busy={busy}
      onObject={() => run("object_exhibit", { p_player_id: me, p_exhibit_id: e.id })}
    />
  );

  return (
    <div className="space-y-3">
      <TrialBanner state={state} players={players} />
      <p
        className={
          "rounded-lg py-1.5 text-center text-xs font-black uppercase tracking-[0.3em] text-cream " +
          (half === "against" ? "bg-[#8a6a1c]" : "bg-[#3a3d8f]")
        }
      >
        {half === "against" ? "The prosecution has the floor" : "The defence has the floor"}
      </p>

      <DeskSurface>
        <DeskRow
          side="P"
          empty={half === "against" ? "No proof on the desk yet." : "The prosecution filed no proof."}
        >
          {/* Your blank sheet comes first, so on a phone it's never off-screen. */}
          {canFileExhibit && (
            <BlankSheet side="P" label="File proof" cost={EXHIBIT_COST} onClick={() => setComposing(true)} />
          )}
          {prosSheets.map(sheet)}
        </DeskRow>
        {(half === "defence" || defSheets.length > 0) && (
          <DeskRow side="D" empty="No counterproof yet.">
            {canFileCounter && (
              <BlankSheet side="D" label="File counterproof" cost={EXHIBIT_COST} onClick={() => setComposing(true)} />
            )}
            {defSheets.map(sheet)}
          </DeskRow>
        )}
      </DeskSurface>

      {/* The witness */}
      <div className="rounded-xl border-2 border-[#3a3d8f] bg-[#1d1640] p-3 text-sm text-cream">
        <p className="text-[11px] font-bold uppercase tracking-widest text-[#c9caf6]">Witness</p>
        <div className="mt-1">
          {!witness ? (
            iAmDefendant ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>Call a witness:</span>
                <select
                  value={callee}
                  onChange={(e) => setCallee(e.target.value)}
                  className="rounded-lg border border-[#7678ed]/50 bg-[#2a2160] px-2 py-1.5 text-cream"
                >
                  <option value="">Who?</option>
                  {callable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {nameOf(p.id)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => run("call_witness", { p_player_id: me, p_witness_id: callee })}
                  disabled={busy || !callee}
                  className="rounded-lg bg-[#7678ed] px-3 py-1.5 font-semibold disabled:opacity-50"
                >
                  Call
                </button>
              </div>
            ) : (
              <span className="text-cream/70">No witness called yet.</span>
            )
          ) : witness.status === "called" ? (
            witness.witness_id === me ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 font-semibold">
                  <Name id={def} small /> calls you as a witness — {callLeft}s
                </span>
                <button
                  onClick={() => run("answer_witness", { p_player_id: me, p_accept: true })}
                  disabled={busy}
                  className="rounded-lg bg-green-700 px-3 py-1.5 font-semibold"
                >
                  Accept
                </button>
                <button
                  onClick={() => run("answer_witness", { p_player_id: me, p_accept: false })}
                  disabled={busy}
                  className="rounded-lg bg-red-800 px-3 py-1.5 font-semibold"
                >
                  Refuse
                </button>
              </div>
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                <Name id={def} small /> calls <Name id={witness.witness_id} small /> as a witness… ({callLeft}s)
              </span>
            )
          ) : witness.status === "accepted" ? (
            <span className="flex flex-wrap items-center gap-1">
              <Name id={witness.witness_id} small /> accepted and testifies for the defence.
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              <Name id={witness.witness_id} small /> refused to testify.
            </span>
          )}
        </div>
      </div>

      {composing && myPlayer && (canFileExhibit || canFileCounter) && (
        <WarrantSheet titleId="court-composer" onClose={() => setComposing(false)}>
          <ExhibitComposer
            titleId="court-composer"
            myPlayer={myPlayer}
            players={players}
            nameOf={nameOf}
            title={canFileExhibit ? "File proof" : "File counterproof"}
            cost={EXHIBIT_COST}
            onCancel={() => setComposing(false)}
            onFile={async (kind, payload) => {
              const res = await run(canFileExhibit ? "file_exhibit" : "file_counterproof", {
                p_player_id: me,
                p_kind: kind,
                p_payload: payload,
              });
              if (res.ok) {
                setComposing(false);
                return null;
              }
              return reasonText(res.reason);
            }}
          />
        </WarrantSheet>
      )}
      {error && <p className="text-sm font-semibold text-[#b3141b]">{error}</p>}
      {!iAmProsecutor && !iAmDefendant && !iAmWitness && canAct(myPlayer) && (
        <p className="text-center text-xs text-home-bg/75">
          You&rsquo;re on the jury: listen, ask questions out loud, and vote in the verdict.
        </p>
      )}
    </div>
  );
}
