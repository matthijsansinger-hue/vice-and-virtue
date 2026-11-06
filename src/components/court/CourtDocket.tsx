"use client";

import { useState } from "react";
import {
  CHARGE_LABEL,
  STAKE_CAP,
  STAKE_STEP,
  canAct,
  chargeTotal,
  courtCall,
  reasonText,
  type ChargeKind,
  type CourtState,
} from "@/lib/court";
import { Name, PAPER, useCourtNames } from "./names";
import type { Player } from "@/lib/types";

const select =
  "rounded-lg border border-home-bg/30 bg-white/70 px-2 py-1.5 text-sm text-home-bg focus:outline-none focus:ring-2 focus:ring-[#b08a2e]";

// Step 1 — the docket. Press one charge a day (10–100 in steps of 10) and back
// charges (+10, at most 100 per charge). Whoever has the most Soul Energy
// backed against them in total is today's only defendant.
export function CourtDocket({
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
  const mayAct = canAct(myPlayer);
  const [defendant, setDefendant] = useState("");
  const [kind, setKind] = useState<ChargeKind>("vice");
  const [victim, setVictim] = useState("");
  const [stake, setStake] = useState(STAKE_STEP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = state.charges.filter((c) => c.status === "open");
  const pressedToday = open.some((c) => c.pressed_by === me);
  // Per defendant: total backed, distinct backers, earliest press (the ranking).
  const ranked = [...new Set(open.map((c) => c.defendant_id))]
    .map((id) => {
      const cs = open.filter((c) => c.defendant_id === id);
      return {
        id,
        charges: cs,
        total: cs.reduce((n, c) => n + chargeTotal(c), 0),
        backers: new Set(cs.flatMap((c) => c.stakes.map((s) => s.player_id))).size,
        first: Math.min(...cs.map((c) => Date.parse(c.created_at))),
      };
    })
    .sort((x, y) => y.total - x.total || y.backers - x.backers || x.first - y.first);

  const chargeable = players.filter((p) => !p.dead && !p.in_prison && p.id !== me);
  const messagedMe = (id: string) =>
    state.record.dms.some((d) => d.day === state.day && d.from === id && d.to === me);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await courtCall(fn, args);
      if (!res.ok) setError(reasonText(res.reason));
    } finally {
      setBusy(false);
    }
  }

  // The feed: every press and every top-up, newest first.
  const feed = state.charges
    .flatMap((c) =>
      c.stakes.map((s, i) => ({
        at: s.at,
        who: s.player_id,
        press: i === 0 && s.player_id === c.pressed_by,
        charge: c,
        amount: s.amount,
      }))
    )
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {ranked.length === 0 ? (
        <p
          className="rounded-xl border-2 border-[#b08a2e]/60 p-4 text-center text-sm text-home-bg"
          style={{ background: PAPER }}
        >
          No charges yet. Without a charge, nobody goes to prison today.
        </p>
      ) : (
        <ol className="grid gap-3 xl:grid-cols-2">
          {ranked.map((d, i) => (
            <li
              key={d.id}
              className={
                "rounded-xl border-2 p-3 text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.18)] " +
                (i === 0 ? "border-[#b3141b]" : "border-[#b08a2e]/60")
              }
              style={{ background: PAPER }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-bold text-home-bg/60">{i + 1}.</span>
                  <Name id={d.id} />
                </span>
                <span className="shrink-0 text-lg font-black">{d.total} SE</span>
              </div>
              {i === 0 && (
                <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-[#b3141b]">
                  On trial if the docket closed now
                </p>
              )}
              <ul className="mt-2 space-y-2">
                {d.charges.map((c) => {
                  const mine = c.stakes.filter((s) => s.player_id === me).reduce((n, s) => n + s.amount, 0);
                  const canBack =
                    mayAct &&
                    c.defendant_id !== me &&
                    mine + STAKE_STEP <= STAKE_CAP &&
                    (myPlayer?.soul_energy ?? 0) >= STAKE_STEP;
                  const by = new Map<string, number>();
                  for (const s of c.stakes) by.set(s.player_id, (by.get(s.player_id) ?? 0) + s.amount);
                  return (
                    <li key={c.id} className="rounded-lg bg-white/45 p-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-semibold">
                          {CHARGE_LABEL[c.kind]}
                          {c.victim_id ? <> of <Name id={c.victim_id} small /></> : null}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-bold">{chargeTotal(c)}</span>
                          {canBack && (
                            <button
                              onClick={() => run("back_charge", { p_player_id: me, p_charge_id: c.id })}
                              disabled={busy}
                              className="rounded-lg bg-home-bg px-2.5 py-1 text-xs font-bold text-cream hover:opacity-90 disabled:opacity-50"
                            >
                              +{STAKE_STEP}
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {[...by].map(([id, n]) => (
                          <span key={id} className="inline-flex items-center gap-1 text-xs font-semibold">
                            <Name id={id} small />
                            <span>{n}</span>
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {mayAct && !pressedToday && (
        <div
          className="rounded-xl border-2 border-[#b08a2e] p-3 text-sm text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.18)]"
          style={{ background: PAPER }}
        >
          <p className="font-bold uppercase tracking-widest text-[#8a6a1c]">Press a charge</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={defendant} onChange={(e) => setDefendant(e.target.value)} className={select}>
              <option value="">Who?</option>
              {chargeable.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameOf(p.id)}
                </option>
              ))}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as ChargeKind)} className={select}>
              <option value="vice">is a Vice</option>
              {state.victims.length > 0 && <option value="murder">committed murder</option>}
              {defendant && messagedMe(defendant) && <option value="false_witness">told me something false</option>}
            </select>
            {kind === "murder" && (
              <select value={victim} onChange={(e) => setVictim(e.target.value)} className={select}>
                <option value="">of whom?</option>
                {state.victims.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {Array.from({ length: STAKE_CAP / STAKE_STEP }, (_, i) => (i + 1) * STAKE_STEP).map((v) => (
              <button
                key={v}
                onClick={() => setStake(v)}
                disabled={(myPlayer?.soul_energy ?? 0) < v}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-bold disabled:opacity-30 " +
                  (stake === v ? "bg-home-bg text-cream" : "border border-home-bg/40 bg-white/50 text-home-bg")
                }
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() =>
              run("press_charge", {
                p_player_id: me,
                p_defendant: defendant,
                p_kind: kind,
                p_victim: kind === "murder" ? victim || null : null,
                p_stake: stake,
              })
            }
            disabled={busy || !defendant || (kind === "murder" && !victim)}
            className="mt-3 w-full rounded-lg bg-home-bg py-2 font-bold text-cream hover:opacity-90 disabled:opacity-50"
          >
            Press the charge — {stake} SE
          </button>
          <p className="mt-1 text-xs text-home-bg/65">
            Once a day. Pressing a charge that already exists backs it instead. No withdrawals.
          </p>
        </div>
      )}
      {error && <p className="text-sm font-semibold text-[#b3141b]">{error}</p>}

      {feed.length > 0 && (
        <ul className="space-y-1 text-xs text-home-bg">
          {feed.map((f, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1">
              <Name id={f.who} small />
              <span>{f.press ? "pressed" : "backed"}</span>
              <Name id={f.charge.defendant_id} small />
              <span>
                — {CHARGE_LABEL[f.charge.kind]} — <strong>{f.amount}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
