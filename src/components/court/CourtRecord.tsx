"use client";

import { useState } from "react";
import { CHARGE_LABEL, type CourtState } from "@/lib/court";
import type { Player } from "@/lib/types";

// The court record: free, public evidence that can't be faked — every
// player's Quiz decision and who messaged whom, per day (never targets,
// results or text), past trials and reputations.
export function CourtRecord({
  state,
  players,
  nameOf,
}: {
  state: CourtState;
  players: Player[];
  nameOf: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const days = [...new Set([...state.record.quiz.map((q) => q.day), ...state.record.dms.map((d) => d.day)])].sort(
    (a, b) => b - a
  );
  const QUIZ: Record<string, string> = { points: "points", hint: "hint", peek: "peek" };

  return (
    <div className="rounded-xl border border-gold/30 bg-home-bg/60 text-cream">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold"
      >
        <span>The court record</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 px-3 pb-3 text-xs">
          {days.map((d) => (
            <div key={d}>
              <p className="font-semibold text-gold">Day {d}</p>
              <ul className="mt-0.5 space-y-0.5">
                {players.map((p) => {
                  const q = state.record.quiz.find((x) => x.day === d && x.player_id === p.id);
                  const to = state.record.dms.filter((x) => x.day === d && x.from === p.id).map((x) => x.to);
                  if (!q && to.length === 0) return null;
                  return (
                    <li key={p.id}>
                      {nameOf(p.id)}
                      {p.dead ? " †" : ""}: {q ? QUIZ[q.kind] : "—"}
                      {to.length > 0 && ` · messaged ${to.map(nameOf).join(", ")}`}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {state.history.length > 0 && (
            <div>
              <p className="font-semibold text-gold">Past trials</p>
              <ul className="mt-0.5 space-y-0.5">
                {state.history.map((h) => (
                  <li key={h.day}>
                    Day {h.day}:{" "}
                    {h.defendant_id
                      ? `${nameOf(h.defendant_id)} (${h.charges.map((c) => CHARGE_LABEL[c.kind]).join(", ")}) — ${h.outcome}${h.guilty !== null ? ` ${h.guilty}–${h.not_guilty}` : ""}`
                      : "adjourned"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(state.reputation).length > 0 && (
            <div>
              <p className="font-semibold text-gold">Reputations</p>
              <ul className="mt-0.5 space-y-0.5">
                {Object.entries(state.reputation).map(([id, c]) => (
                  <li key={id}>
                    {nameOf(id)} — exhibits {c.exhibits ?? 0} (✓{c.exhibits_upheld ?? 0} ✗{c.exhibits_forged ?? 0}) ·
                    objections won {c.objections_won ?? 0}, lost {c.objections_lost ?? 0} · backed:{" "}
                    {c.backed_imprisoned ?? 0} imprisoned, {c.backed_spared ?? 0} spared
                    {(c.witness_refused ?? 0) > 0 ? ` · refused to testify ${c.witness_refused}×` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
