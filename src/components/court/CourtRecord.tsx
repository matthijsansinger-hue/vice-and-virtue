"use client";

import { CHARGE_LABEL, type CourtState } from "@/lib/court";
import { Name, PAPER } from "./names";
import type { Player } from "@/lib/types";

const QUIZ_LABEL: Record<string, string> = { points: "took points", hint: "took a hint", peek: "peeked" };
const OUTCOME_LABEL: Record<string, string> = {
  imprisoned: "imprisoned",
  spared: "spared",
  warded: "couldn't be imprisoned",
  adjourned: "adjourned",
};

// The court handbook: a beige sheet that stays in the top left for the whole
// consultation. Free public evidence that can't be faked — every player's
// Quiz decision and who they messaged, per day (never targets, results or
// text) — plus past trials and reputations. Every name is a banner in that
// player's colour for this game.
export function CourtRecord({ state, players }: { state: CourtState; players: Player[] }) {
  const days = [
    ...new Set([...state.record.quiz.map((q) => q.day), ...state.record.dms.map((d) => d.day)]),
  ].sort((a, b) => b - a);

  return (
    <div
      className="relative rounded-xl border-2 border-[#b08a2e]/70 p-4 text-home-bg shadow-[0_6px_18px_rgba(0,0,0,.25)]"
      style={{ background: PAPER }}
    >
      <p className="text-center text-xs font-bold uppercase tracking-[0.3em] text-home-bg/70">Court handbook</p>
      <p className="mt-0.5 text-center text-[11px] text-home-bg/60">
        What the record shows — it can&rsquo;t be faked
      </p>

      {days.length === 0 && <p className="mt-3 text-center text-xs italic text-home-bg/60">Nothing on record yet.</p>}
      {days.map((d) => (
        <div key={d} className="mt-3">
          <p className="border-b border-home-bg/20 pb-0.5 text-xs font-bold uppercase tracking-widest text-[#8a6a1c]">
            Day {d}
            {d === state.day ? " · today" : ""}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {players.map((p) => {
              const q = state.record.quiz.find((x) => x.day === d && x.player_id === p.id);
              const to = state.record.dms.filter((x) => x.day === d && x.from === p.id).map((x) => x.to);
              if (!q && to.length === 0) return null;
              return (
                <li key={p.id} className="text-xs leading-5">
                  <Name id={p.id} small suffix={p.dead ? <span>†</span> : null} />{" "}
                  <span className="text-home-bg/80">{q ? QUIZ_LABEL[q.kind] : "no Quiz choice"}</span>
                  {to.length > 0 && (
                    <span className="text-home-bg/80">
                      {" · messaged "}
                      {to.map((id) => (
                        <span key={id} className="mr-1 inline-block">
                          <Name id={id} small />
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {state.history.length > 0 && (
        <div className="mt-4">
          <p className="border-b border-home-bg/20 pb-0.5 text-xs font-bold uppercase tracking-widest text-[#8a6a1c]">
            Past trials
          </p>
          <ul className="mt-1.5 space-y-1.5 text-xs leading-5">
            {state.history.map((h) => (
              <li key={h.day}>
                <span className="font-semibold">Day {h.day}:</span>{" "}
                {h.defendant_id ? (
                  <>
                    <Name id={h.defendant_id} small />{" "}
                    <span className="text-home-bg/80">
                      ({h.charges.map((c) => CHARGE_LABEL[c.kind]).join(", ")}) —{" "}
                      {OUTCOME_LABEL[h.outcome ?? ""] ?? h.outcome}
                      {h.guilty !== null ? ` ${h.guilty}–${h.not_guilty}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-home-bg/80">no trial — adjourned</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Object.keys(state.reputation).length > 0 && (
        <div className="mt-4">
          <p className="border-b border-home-bg/20 pb-0.5 text-xs font-bold uppercase tracking-widest text-[#8a6a1c]">
            Reputations
          </p>
          <ul className="mt-1.5 space-y-1.5 text-xs leading-5">
            {Object.entries(state.reputation).map(([id, c]) => {
              const parts = [
                (c.exhibits ?? 0) > 0 &&
                  `proof filed ${c.exhibits} (${c.exhibits_upheld ?? 0} upheld, ${c.exhibits_forged ?? 0} forged)`,
                ((c.objections_won ?? 0) > 0 || (c.objections_lost ?? 0) > 0) &&
                  `objections ${c.objections_won ?? 0} won / ${c.objections_lost ?? 0} lost`,
                ((c.backed_imprisoned ?? 0) > 0 || (c.backed_spared ?? 0) > 0) &&
                  `backed ${c.backed_imprisoned ?? 0} imprisoned, ${c.backed_spared ?? 0} spared`,
                (c.witness_refused ?? 0) > 0 && `refused to testify ${c.witness_refused}×`,
              ].filter(Boolean);
              if (parts.length === 0) return null;
              return (
                <li key={id}>
                  <Name id={id} small /> <span className="text-home-bg/80">{parts.join(" · ")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
