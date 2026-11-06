"use client";

import { useEffect, useMemo, useState } from "react";
import { heading, PhaseTimer } from "@/components/ui/royal";
import { setReady } from "@/lib/game";
import { supabase } from "@/lib/supabase";
import { pacers } from "@/lib/bots";
import { displayedName } from "@/lib/swaps";
import { gameColors } from "@/lib/gameColors";
import { canAct, useCourtState, type CourtStep } from "@/lib/court";
import { ConsultationChat } from "../ConsultationChat";
import { DeadChat } from "../DeadChat";
import { PhaseTip } from "../PhaseTip";
import { CourtNamesProvider } from "./names";
import { CourtDocket } from "./CourtDocket";
import { CourtTrial } from "./CourtTrial";
import { CourtVerdict } from "./CourtVerdict";
import { CourtSettlement } from "./CourtSettlement";
import { CourtRecord } from "./CourtRecord";
import type { Player, Room } from "@/lib/types";

// How often the host of a private lobby nudges the court's step machine
// (server rooms are stepped by the server itself).
const COURT_TICK_MS = 2000;

const STEPS: { id: CourtStep; label: string }[] = [
  { id: "docket", label: "Docket" },
  { id: "against", label: "Case against" },
  { id: "defence", label: "Defence" },
  { id: "verdict", label: "Verdict" },
  { id: "settlement", label: "Settlement" },
];
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
// Desktop: the court handbook (top left, always there) | the step | the chats.
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
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const colors = useMemo(() => gameColors(room.id, players.map((p) => p.id)), [room.id, players]);
  const names = useMemo(
    () => ({
      nameOf: (id: string) => {
        const p = players.find((x) => x.id === id);
        return p ? displayedName(p, room, players, myPlayer?.id) : "someone";
      },
      colorOf: (id: string) => colors.get(id),
    }),
    [players, room, myPlayer?.id, colors]
  );

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
    <CourtNamesProvider value={names}>
      <main className="consultation-council-bg min-h-screen px-4 pb-10 pt-16 text-home-bg">
        <div className="mx-auto grid w-full max-w-[96rem] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_22rem] lg:items-start">
          {/* The court handbook — top left, there the whole time. */}
          <aside className="order-2 lg:order-none lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
            {state ? (
              <CourtRecord state={state} players={players} />
            ) : null}
          </aside>

          {/* The step */}
          <section className="order-1 min-w-0 space-y-4 lg:order-none">
            <div className="text-center">
              <p className={`text-xs font-bold uppercase tracking-[0.3em] text-home-bg/70 ${heading}`}>
                Day {room.day} &mdash; the court
              </p>
              <h1 className={`mt-1 text-2xl font-bold text-home-bg lg:text-3xl ${heading}`}>{STEP_TITLE[step]}</h1>
              {remaining !== null && <PhaseTimer seconds={remaining} onLight className="mt-1" />}
            </div>

            {/* Where we are */}
            <ol className="flex flex-wrap justify-center gap-1.5">
              {STEPS.map((s, i) => (
                <li
                  key={s.id}
                  className={
                    "rounded-full px-3 py-1 text-xs font-bold " +
                    (i === stepIndex
                      ? "bg-home-bg text-cream shadow-[0_2px_6px_rgba(0,0,0,.3)]"
                      : i < stepIndex
                        ? "bg-home-bg/20 text-home-bg/70"
                        : "border border-home-bg/30 text-home-bg/60")
                  }
                >
                  {i < stepIndex ? "✓ " : ""}
                  {s.label}
                </li>
              ))}
            </ol>

            {state?.sworn && (
              <p className="rounded-xl border-2 border-[#3a3d8f] bg-[#1d1640] px-3 py-2 text-center text-sm font-semibold text-[#e3e4fb]">
                The court is sworn to truth today — no forged proof can be filed.
              </p>
            )}
            <PhaseTip key={step} id={`court_${step}`} text={STEP_TIP[step]} />

            {!state ? (
              <p className="text-center text-sm text-home-bg/70">Opening the court…</p>
            ) : step === "docket" ? (
              <CourtDocket state={state} players={players} myPlayer={myPlayer} />
            ) : step === "against" || step === "defence" ? (
              <CourtTrial state={state} players={players} myPlayer={myPlayer} />
            ) : step === "verdict" ? (
              <CourtVerdict state={state} players={players} myPlayer={myPlayer} />
            ) : (
              <CourtSettlement state={state} players={players} myPlayer={myPlayer} />
            )}

            {showDone &&
              (myPlayer?.ready ? (
                <p className="mx-auto max-w-md rounded-xl border-2 border-home-bg/40 bg-white/40 py-3 text-center text-sm font-bold text-home-bg">
                  {step === "settlement" ? "Ready" : "Done"} — waiting for the others ({ready}/{pace.length})
                </p>
              ) : (
                <button
                  onClick={() => myPlayer && setReady(myPlayer.id, true)}
                  className={`mx-auto block w-full max-w-md rounded-xl bg-home-bg py-3 font-bold text-cream shadow-[0_3px_10px_rgba(0,0,0,.3)] hover:opacity-90 ${heading}`}
                >
                  {step === "settlement" ? "Continue" : "Done"} ({ready}/{pace.length})
                </button>
              ))}
          </section>

          {/* The chats — right column on wide screens, below on smaller ones. */}
          <aside className="order-3 space-y-3 lg:col-start-2 xl:col-start-auto xl:sticky xl:top-16">
            <ConsultationChat room={room} players={players} myPlayer={myPlayer} />
            {myPlayer?.dead && <DeadChat room={room} players={players} myPlayer={myPlayer} />}
          </aside>
        </div>
      </main>
    </CourtNamesProvider>
  );
}
