// The Trial — the consultation as a court (migrations 136–144). Everything the
// court screens read comes from court_state (one snapshot) and the exhibit
// composer's court_my_material; every action is an RPC that answers
// {ok, reason}. The server decides everything — these are thin wrappers.

import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Player } from "./types";

export type CourtStep = "docket" | "against" | "defence" | "verdict" | "settlement";
export type ChargeKind = "vice" | "murder" | "false_witness";
export type ExhibitKind = "quiz_peek" | "quiz_hint" | "msg_received" | "msg_sent" | "chat";

export type Stake = { player_id: string; amount: number; at: string };
export type Charge = {
  id: string;
  defendant_id: string;
  kind: ChargeKind;
  victim_id: string | null;
  pressed_by: string;
  status: "open" | "tried" | "refunded";
  created_at: string;
  stakes: Stake[];
};
export type ChatLine =
  | { from: string; s: string; about?: string; role?: string }
  | { from: string; text: string };
export type Exhibit = {
  id: string;
  number: number;
  side: "P" | "D";
  filer_id: string;
  kind: ExhibitKind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  cost: number;
  status: "standing" | "upheld" | "forged";
  created_at: string;
  // Only for its filer, the dead and a Diligence who paid today.
  genuine: boolean | null;
};
export type Trial = {
  defendant_id: string | null;
  outcome: "adjourned" | "imprisoned" | "spared" | "warded" | null;
  guilty: number | null;
  not_guilty: number | null;
  guilty_jurors: number | null;
  extend_s: number;
  by_justice?: boolean;
};
export type Witness = {
  witness_id: string;
  status: "called" | "accepted" | "refused";
  called_at: string;
  answered_at: string | null;
};
export type LedgerLine = { player_id: string; amount: number; reason: string; ref_id: string | null; at: string };
export type CourtState = {
  day: number;
  sworn: boolean;
  step: CourtStep | null;
  defendant_id: string | null;
  trial: Trial | null;
  charges: Charge[];
  exhibits: Exhibit[];
  witness: Witness | null;
  objections: { exhibit_id: string; objector_id: string; ruling: "forged" | "upheld"; at: string }[];
  ledger: LedgerLine[];
  reputation: Record<string, Record<string, number>>;
  victims: string[];
  record: {
    quiz: { day: number; player_id: string; kind: "points" | "hint" | "peek" }[];
    dms: { day: number; from: string; to: string }[];
  };
  history: {
    day: number;
    defendant_id: string | null;
    outcome: Trial["outcome"];
    guilty: number | null;
    not_guilty: number | null;
    charges: { kind: ChargeKind; victim_id: string | null; total: number }[];
  }[];
};

// The composer's pre-fill: my own Quiz results and messages, every day.
export type Material = {
  quiz: {
    day: number;
    kind: "points" | "hint" | "peek";
    target_id: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: any;
  }[];
  sent: { id: string; day: number; to: string; payload: { s: string; about?: string; role?: string } | null; text: string; at: string }[];
  received: { id: string; day: number; from: string; payload: { s: string; about?: string; role?: string } | null; text: string; at: string }[];
};

export const STAKE_STEP = 10;
export const STAKE_CAP = 100;
export const EXHIBIT_COST = 50;
export const OBJECTION_COST = 50;
export const WITNESS_WINDOW_S = 15;

// court_state, refetched whenever `refresh` changes (the room page refetches
// players on every room nudge — the court tables nudge too) and every 2.5 s.
export function useCourtState(roomId: string, viewerId: string | null, refresh: unknown) {
  const [state, setState] = useState<CourtState | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 2500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!viewerId) return;
    let cancelled = false;
    supabase
      .rpc("court_state", { p_room_id: roomId, p_viewer_id: viewerId })
      .then(({ data }) => {
        if (!cancelled && data) setState(data as CourtState);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, viewerId, refresh, tick]);
  return state;
}

export type CourtResult = { ok: boolean; reason?: string; [k: string]: unknown };

export async function courtCall(fn: string, args: Record<string, unknown>): Promise<CourtResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, reason: "error" };
  return (data as CourtResult | null) ?? { ok: false, reason: "error" };
}

export const COURT_REASONS: Record<string, string> = {
  wrong_step: "That isn't possible at this point of the trial.",
  cannot_act: "You can't do that right now.",
  cant_afford: "Not enough Soul Energy.",
  bad_stake: "Stakes go in steps of 10, up to 100.",
  bad_defendant: "That player can't be charged.",
  bad_victim: "Pick someone who died today.",
  no_message: "They didn't message you today.",
  already_pressed: "You already pressed a charge today.",
  cap: "That's the most you can put on one charge (100).",
  own_charge: "You can't back a charge against yourself.",
  not_prosecutor: "Only prosecutors file exhibits.",
  already_filed: "You already filed yours.",
  implausible: "The court record makes that impossible.",
  sworn: "The court is sworn to truth today — forged proof is refused.",
  not_defence: "Only the defendant and their witness may do that.",
  not_witness: "Only the accepted witness may do that.",
  already_called: "A witness has already been called.",
  has_stake: "That player has a stake in the case.",
  bad_witness: "That player can't be a witness.",
  too_late: "Too late — that counts as refusing.",
  already_objected: "Someone already objected to that.",
  own_exhibit: "You can't object to your own proof.",
  not_allowed: "You can't object to that.",
  bad_message: "Something in that chat isn't valid.",
  bad_target: "Pick a valid player.",
  error: "That didn't go through — check your connection.",
};
export const reasonText = (r?: string) => COURT_REASONS[r ?? ""] ?? "That didn't work.";

export const canAct = (p: Player | null | undefined) =>
  !!p && !p.dead && !p.in_prison && !p.in_hospital;

export const CHARGE_LABEL: Record<ChargeKind, string> = {
  vice: "being a Vice",
  murder: "murder",
  false_witness: "false witness",
};

export const chargeTotal = (c: Charge) => c.stakes.reduce((n, s) => n + s.amount, 0);

// Everyone who pressed or backed a tried charge, with what they put in
// (backing + their exhibit while it stands) — the prosecution.
export function prosecution(state: CourtState): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of state.charges)
    if (c.status === "tried")
      for (const s of c.stakes) out.set(s.player_id, (out.get(s.player_id) ?? 0) + s.amount);
  for (const e of state.exhibits)
    if (e.side === "P" && e.status !== "forged") out.set(e.filer_id, (out.get(e.filer_id) ?? 0) + e.cost);
  return out;
}

export const potOf = (state: CourtState) =>
  [...prosecution(state).values()].reduce((n, v) => n + v, 0);

// The tried charges, largest first (tie: vice > murder > false witness).
export function triedCharges(state: CourtState): Charge[] {
  const order: Record<ChargeKind, number> = { vice: 0, murder: 1, false_witness: 2 };
  return state.charges
    .filter((c) => c.status === "tried")
    .sort((a, b) => chargeTotal(b) - chargeTotal(a) || order[a.kind] - order[b.kind]);
}

export function acceptedWitness(state: CourtState): string | null {
  return state.witness?.status === "accepted" ? state.witness.witness_id : null;
}
