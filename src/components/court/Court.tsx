"use client";

import { useEffect, useState } from "react";
import { heading, PhaseTimer } from "@/components/ui/royal";
import { setReady } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import { pacers } from "@/lib/bots";
import { displayedName } from "@/lib/swaps";
import { canAct, useCourtState, type CourtStep } from "@/lib/court";
import { ConsultationChat } from "../ConsultationChat";
import { DeadChat } from "../DeadChat";
import { PhaseTip } from "../PhaseTip";
import { CourtDocket } from "./CourtDocket";
import { CourtTrial } from "./CourtTrial";
import { CourtVerdict } from "./CourtVerdict";
import { CourtSettlement } from "./CourtSettlement";
import { CourtRecord } from "./CourtRecord";
import type { Player, Room } from "@/lib/types";

// How often the host of a private lobby nudges the court's step machine
// (server rooms are stepped by the server itself).
const COURT_TICK_MS = 2000;

const STEP_TITLE: Record<CourtStep, string> = {
  docket: "The docket",
  against: "The trial — the case against",
  defence: "The trial — the defence",
  verdict: "The verdict",
  settlement: "Settlement",
};
const STEP_TIP: Record<CourtStep, string> = {
  docket:
    "Press a charge and back charges with Soul Energy. The player with the most Soul Energy backed against them goes on trial. Talk — recruit backers out loud.",
  against:
    "Prosecutors file proof — real or forged. The defendant may call a witness. Only the defence can object to the prosecution's proof.",
  defence:
    "The defendant and their witness may each file one counterproof; only prosecutors can object to it. The defence speaks last.",
  verdict: "Everyone except the defendant votes Guilty or Not guilty. Guilty means prison.",
  settlement: "The pot is paid out. A good day in court is worth a lot of Soul Energy.",
};

// The consultation as a court (migrations 136–144). One server-side step
// machine runs it; this screen only shows the step and sends actions.
export function Court({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const state = useCourtState(room.id, myPlayer?.id ?? null, players);
  const step = (room.court_step ?? state?.step ?? "docket") as CourtStep;
  const nameOf = (id: string) => {
    const p = players.find((x) => x.id === id);
    return p ? displayedName(p, room, players, myPlayer?.id) : "someone";
  };

  // Private lobbies: the host's client pings the step machine.
  const pingCourt = !room.server_hosted && !!myPlayer?.is_host;
  useEffect(() => {
    if (!pingCourt) return;
    const ping = () => void supabase.rpc("court_tick", { p_room_id: room.id });
    ping();
    const t = setInterval(ping, COURT_TICK_MS);
    return () => clearInterval(t);
  }, [pingCourt, room.id]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const endsAt = room.phase_ends_at ? Date.parse(room.phase_ends_at) : null;
  const remaining = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;

  // Done / Continue: the active humans set the pace (bots always count as done).
  const pace = pacers(players.filter((p) => canAct(p)));
  const ready = pace.filter((p) => p.ready).length;
  const showDone = step !== "verdict" && canAct(myPlayer);

  return (
    <main className="flex min-h-screen flex-col items-center consultation-council-bg px-4 pb-10 pt-16 text-cream">
      <div className="w-full max-w-2xl space-y-4">
        <div className="text-center">
          <p className={`text-xs uppercase tracking-[0.3em] text-gold ${heading}`}>
            Day {room.day} &mdash; the court
          </p>
          <h1 className={`mt-1 text-2xl font-semibold ${heading}`}>{STEP_TITLE[step]}</h1>
          {remaining !== null && <PhaseTimer seconds={remaining} className="mt-1" />}
          {state?.sworn && (
            <p className="mt-2 inline-block rounded-full border border-[#7678ed]/60 bg-[#190f2e]/80 px-3 py-1 text-xs font-semibold text-[#c9caf6]">
              The court is sworn to truth today — no forged proof can be filed.
            </p>
          )}
        </div>
        <PhaseTip key={step} id={`court_${step}`} text={STEP_TIP[step]} />

        {!state ? (
          <p className="text-center text-sm text-cream/70">Opening the court…</p>
        ) : step === "docket" ? (
          <CourtDocket state={state} players={players} myPlayer={myPlayer} nameOf={nameOf} />
        ) : step === "against" || step === "defence" ? (
          <CourtTrial state={state} players={players} myPlayer={myPlayer} nameOf={nameOf} />
        ) : step === "verdict" ? (
          <CourtVerdict state={state} players={players} myPlayer={myPlayer} nameOf={nameOf} />
        ) : (
          <CourtSettlement state={state} players={players} myPlayer={myPlayer} nameOf={nameOf} />
        )}

        {showDone &&
          (myPlayer?.ready ? (
            <p className="rounded-xl border-2 border-gold/50 bg-gold/10 py-3 text-center text-sm font-semibold">
              {step === "settlement" ? "Ready" : "Done"} — waiting for the others ({ready}/{pace.length})
            </p>
          ) : (
            <button
              onClick={() => myPlayer && setReady(myPlayer.id, true)}
              className={`w-full rounded-xl bg-gold py-3 font-semibold text-home-bg ${heading}`}
            >
              {step === "settlement" ? "Continue" : "Done"} ({ready}/{pace.length})
            </button>
          ))}

        {state && <CourtRecord state={state} players={players} nameOf={nameOf} />}

        <ConsultationChat room={room} players={players} myPlayer={myPlayer} />
        {myPlayer?.dead && <DeadChat room={room} players={players} myPlayer={myPlayer} />}
      </div>
    </main>
  );
}
