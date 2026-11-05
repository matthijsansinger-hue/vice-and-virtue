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
} from "@/lib/court";
import { ExhibitCard } from "./ExhibitCard";
import { ExhibitComposer } from "./ExhibitComposer";
import type { Player } from "@/lib/types";

// The banner shared by the trial, the verdict and the settlement.
export function TrialBanner({ state, nameOf }: { state: CourtState; nameOf: (id: string) => string }) {
  const def = state.defendant_id;
  const charges = triedCharges(state);
  const pros = prosecution(state);
  if (!def || charges.length === 0) return null;
  const [main, ...rest] = charges;
  return (
    <div className="rounded-xl border-2 border-gold bg-home-bg/90 p-3 text-cream">
      <p className="flex items-baseline justify-between gap-2 font-semibold uppercase tracking-wide">
        <span>
          {nameOf(def)} is on trial — {CHARGE_LABEL[main.kind]}
          {main.victim_id ? ` of ${nameOf(main.victim_id)}` : ""}
        </span>
        <span className="shrink-0 text-gold">pot {potOf(state)}</span>
      </p>
      {rest.length > 0 && (
        <p className="text-xs text-cream/70">
          also:{" "}
          {rest
            .map((c) => `${CHARGE_LABEL[c.kind]}${c.victim_id ? ` of ${nameOf(c.victim_id)}` : ""} (${chargeTotal(c)})`)
            .join(", ")}
        </p>
      )}
      <p className="mt-1 text-xs text-cream/70">
        Prosecution: {[...pros].map(([id, n]) => `${nameOf(id)} ${n}`).join(" · ")}
      </p>
    </div>
  );
}

// Step 2 — the trial: the case against, then the defence.
export function CourtTrial({
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
  const mayObject = (side: "P" | "D") =>
    side === "P" ? iAmDefendant || iAmWitness : iAmProsecutor;

  // Who the defendant may call: anyone alive with no stake in the case.
  const callable = players.filter((p) => !p.dead && p.id !== def && !pros.has(p.id));
  const callLeft = witness?.status === "called"
    ? Math.max(0, WITNESS_WINDOW_S - Math.floor((now - Date.parse(witness.called_at)) / 1000))
    : 0;

  return (
    <div className="space-y-3">
      <TrialBanner state={state} nameOf={nameOf} />
      <p className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-gold">
        {half === "against" ? "The prosecution has the floor" : "The defence has the floor"}
      </p>

      <div className="space-y-2">
        {[...state.exhibits]
          .sort((x, y) => (x.side === y.side ? x.number - y.number : x.side === "P" ? -1 : 1))
          .map((e) => (
            <ExhibitCard
              key={e.id}
              exhibit={e}
              nameOf={nameOf}
              filerRole={e.side === "D" ? (e.filer_id === def ? "defendant" : "witness") : undefined}
              objection={objected.get(e.id)}
              canObject={
                e.status === "standing" && !objected.has(e.id) && e.filer_id !== me && mayObject(e.side)
              }
              busy={busy}
              onObject={() => run("object_exhibit", { p_player_id: me, p_exhibit_id: e.id })}
            />
          ))}
        {state.exhibits.length === 0 && (
          <p className="text-center text-sm text-cream/60">No proof filed yet.</p>
        )}
      </div>

      {/* The witness */}
      <div className="rounded-xl border border-[#7678ed]/40 bg-[#190f2e]/70 p-3 text-sm text-cream">
        {!witness ? (
          iAmDefendant ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Call a witness:</span>
              <select
                value={callee}
                onChange={(e) => setCallee(e.target.value)}
                className="rounded-lg border border-[#7678ed]/40 bg-home-bg px-2 py-1.5"
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
            <span className="text-cream/60">No witness called yet.</span>
          )
        ) : witness.status === "called" ? (
          witness.witness_id === me ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {nameOf(def ?? "")} calls you as a witness — {callLeft}s
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
            <span>
              {nameOf(def ?? "")} calls {nameOf(witness.witness_id)} as a witness… ({callLeft}s)
            </span>
          )
        ) : witness.status === "accepted" ? (
          <span>{nameOf(witness.witness_id)} accepted and testifies for the defence.</span>
        ) : (
          <span>{nameOf(witness.witness_id)} refused to testify.</span>
        )}
      </div>

      {composing && myPlayer ? (
        <ExhibitComposer
          myPlayer={myPlayer}
          players={players}
          nameOf={nameOf}
          title={canFileExhibit ? "File an exhibit" : "File counterproof"}
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
      ) : (
        (canFileExhibit || canFileCounter) && (
          <button
            onClick={() => setComposing(true)}
            className="w-full rounded-xl bg-gold py-3 font-semibold text-home-bg"
          >
            {canFileExhibit ? `File an exhibit — ${EXHIBIT_COST} SE` : `File counterproof — ${EXHIBIT_COST} SE`}
          </button>
        )
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
      {!iAmProsecutor && !iAmDefendant && !iAmWitness && canAct(myPlayer) && (
        <p className="text-center text-xs text-cream/60">
          You&rsquo;re on the jury: listen, ask questions out loud, and vote in the verdict.
        </p>
      )}
    </div>
  );
}
