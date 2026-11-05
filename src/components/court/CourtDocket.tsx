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
import type { Player } from "@/lib/types";

// Step 1 — the docket. Press one charge a day (10–100 in steps of 10) and back
// charges (+10, at most 100 per charge). Whoever has the most Soul Energy
// backed against them in total is today's only defendant.
export function CourtDocket({
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

  // The feed: every press and every top-up, in order.
  const feed = state.charges
    .flatMap((c) =>
      c.stakes.map((s, i) => ({
        at: s.at,
        text:
          i === 0 && s.player_id === c.pressed_by
            ? `${nameOf(s.player_id)} pressed a charge: ${nameOf(c.defendant_id)} — ${CHARGE_LABEL[c.kind]}${c.victim_id ? ` of ${nameOf(c.victim_id)}` : ""} — ${s.amount}`
            : `${nameOf(s.player_id)} backed ${nameOf(c.defendant_id)} — ${CHARGE_LABEL[c.kind]} — ${s.amount}`,
      }))
    )
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {ranked.length === 0 ? (
        <p className="rounded-xl border border-gold/30 bg-home-bg/60 p-4 text-center text-sm text-cream/80">
          No charges yet. Without a charge, nobody goes to prison today.
        </p>
      ) : (
        <ol className="space-y-2">
          {ranked.map((d, i) => (
            <li key={d.id} className="rounded-xl border border-gold/40 bg-home-bg/70 p-3">
              <p className="flex items-baseline justify-between font-semibold text-cream">
                <span>
                  {i + 1}. {nameOf(d.id)}
                </span>
                <span className="text-gold">{d.total} SE</span>
              </p>
              <ul className="mt-1 space-y-1">
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
                    <li key={c.id} className="flex items-center gap-2 text-sm text-cream/85">
                      <span className="flex-1">
                        {CHARGE_LABEL[c.kind]}
                        {c.victim_id ? ` of ${nameOf(c.victim_id)}` : ""} · {chargeTotal(c)} ·{" "}
                        <span className="text-cream/60">
                          {[...by].map(([id, n]) => `${nameOf(id)} ${n}`).join(" · ")}
                        </span>
                      </span>
                      {canBack && (
                        <button
                          onClick={() => run("back_charge", { p_player_id: me, p_charge_id: c.id })}
                          disabled={busy}
                          className="rounded-lg bg-gold px-2 py-1 text-xs font-semibold text-home-bg disabled:opacity-50"
                        >
                          +{STAKE_STEP}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {mayAct && !pressedToday && (
        <div className="rounded-xl border-2 border-gold/50 bg-home-bg/80 p-3 text-sm text-cream">
          <p className="font-semibold text-gold">Press a charge</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={defendant}
              onChange={(e) => setDefendant(e.target.value)}
              className="rounded-lg border border-gold/40 bg-home-bg px-2 py-1.5"
            >
              <option value="">Who?</option>
              {chargeable.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameOf(p.id)}
                </option>
              ))}
            </select>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ChargeKind)}
              className="rounded-lg border border-gold/40 bg-home-bg px-2 py-1.5"
            >
              <option value="vice">is a Vice</option>
              {state.victims.length > 0 && <option value="murder">committed murder</option>}
              {defendant && messagedMe(defendant) && <option value="false_witness">told me something false</option>}
            </select>
            {kind === "murder" && (
              <select
                value={victim}
                onChange={(e) => setVictim(e.target.value)}
                className="rounded-lg border border-gold/40 bg-home-bg px-2 py-1.5"
              >
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
                  "rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-30 " +
                  (stake === v ? "bg-gold text-home-bg" : "border border-gold/40 text-cream")
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
            className="mt-3 w-full rounded-lg bg-gold py-2 font-semibold text-home-bg disabled:opacity-50"
          >
            Press the charge — {stake} SE
          </button>
          <p className="mt-1 text-xs text-cream/60">
            Once a day. Pressing a charge that already exists backs it instead. No withdrawals.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}

      {feed.length > 0 && (
        <ul className="space-y-0.5 text-xs text-cream/70">
          {feed.map((f, i) => (
            <li key={i}>{f.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
