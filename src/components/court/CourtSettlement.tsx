"use client";

import { useEffect, useRef } from "react";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { heading, SoulFlame } from "@/components/ui/royal";
import { playPrisonDoor } from "@/lib/sound";
import { acceptedWitness, prosecution, type CourtState } from "@/lib/court";
import { usePlayerCharacters } from "@/lib/usePlayerCharacters";
import { DeskSurface, SHEET_PAPER } from "./Desk";
import { useCourtNames } from "./names";
import type { Player } from "@/lib/types";

// Step 4 — settlement: the verdict, then everyone at the desk — face, name
// bar in this game's colour, their part in the case, and what the day in
// court earned or cost them (one net total each, from the court ledger; a
// stack of coins for a gain). Most players press Continue → the new day.

const BARS = "repeating-linear-gradient(90deg, transparent 0 7px, rgba(28,24,22,.85) 7px 10px)";
const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export function CourtSettlement({
  state,
  players,
  myPlayer,
}: {
  state: CourtState;
  players: Player[];
  myPlayer: Player | null;
}) {
  const { nameOf, colorOf } = useCourtNames();
  const characters = usePlayerCharacters(players);
  const t = state.trial;
  const def = state.defendant_id ?? t?.defendant_id ?? null;
  const defPlayer = players.find((p) => p.id === def) ?? null;
  const doorRef = useRef(false);
  useEffect(() => {
    if (t?.outcome === "imprisoned" && !doorRef.current) {
      doorRef.current = true;
      playPrisonDoor();
    }
  }, [t?.outcome]);

  const totals = new Map<string, number>();
  for (const l of state.ledger) totals.set(l.player_id, (totals.get(l.player_id) ?? 0) + l.amount);
  const mine = myPlayer ? totals.get(myPlayer.id) ?? 0 : 0;
  const counts = t && t.guilty !== null ? `${t.guilty} Guilty, ${t.not_guilty} Not guilty` : null;

  const pros = prosecution(state);
  const witness = acceptedWitness(state);
  const part = (id: string) =>
    id === def ? "Defendant" : id === witness ? "Witness" : pros.has(id) ? "Prosecution" : "Jury";

  // Everyone still in the game (and anyone the ledger names), biggest gain
  // first, then in seat order.
  const seat = new Map(players.map((p, i) => [p.id, i]));
  const shown = players
    .filter((p) => !p.dead || totals.has(p.id))
    .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || seat.get(a.id)! - seat.get(b.id)!);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-gold bg-home-bg p-5 text-center text-cream shadow-[0_6px_18px_rgba(0,0,0,.3)]">
        {t?.outcome === "adjourned" ? (
          <>
            <p className={`text-xl font-bold ${heading}`}>The court is adjourned</p>
            <p className="mt-1 text-sm text-cream/80">The defendant can&rsquo;t be tried. Everything is refunded.</p>
          </>
        ) : (
          <>
            {def && (
              <span className="relative mx-auto mb-2 block h-16 w-16 rounded-full shadow-[0_0_0_2px_#e3b510]">
                <CharacterAvatar
                  character={characters[defPlayer?.shown_as ?? def] ?? null}
                  initials={nameOf(def).charAt(0).toUpperCase()}
                  className="h-full w-full"
                  textClass="text-lg"
                />
                {t?.outcome === "imprisoned" && (
                  <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: BARS }} />
                )}
              </span>
            )}
            <p className={`text-xl font-bold ${heading}`}>
              {nameOf(def ?? "")}
              {t?.outcome === "imprisoned" && " is imprisoned"}
              {t?.outcome === "spared" && " is spared"}
              {t?.outcome === "warded" && " can't be imprisoned today"}
            </p>
            {counts && <p className="mt-1 text-sm text-cream/80">{counts}</p>}
            {t?.by_justice && (
              <p className="mt-2 text-sm font-semibold text-gold">
                Justice has spoken: a Vice stood trial and goes to prison.
              </p>
            )}
            {t?.outcome === "warded" && (
              <p className="mt-2 text-sm text-cream/80">Nobody goes to prison, and everyone is refunded.</p>
            )}
          </>
        )}
      </div>

      {myPlayer && (
        <p className="flex items-center justify-center gap-1 text-lg font-black text-home-bg">
          Your day in court: {sign(mine)} <SoulFlame size={16} />
        </p>
      )}

      <DeskSurface>
        <ul className="grid grid-cols-3 items-end gap-x-2 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] sm:gap-x-3">
          {shown.map((p) => {
            const n = totals.get(p.id) ?? 0;
            const gc = colorOf(p.id);
            const isMe = p.id === myPlayer?.id;
            return (
              <li
                key={p.id}
                className="flex flex-col items-center text-center"
                aria-label={`${nameOf(p.id)}${isMe ? " (you)" : ""}, ${part(p.id).toLowerCase()}: ${
                  n > 0 ? `earned ${n}` : n < 0 ? `lost ${-n}` : "no change"
                } Soul Energy`}
              >
                <Coins amount={n} />
                <span
                  className="relative block h-14 w-14 rounded-full sm:h-16 sm:w-16"
                  style={{
                    boxShadow: isMe
                      ? "0 0 0 3px #e3b510, 0 4px 10px rgba(0,0,0,.5)"
                      : `0 0 0 2px ${gc?.hex ?? "#e9d9a8"}, 0 4px 10px rgba(0,0,0,.5)`,
                  }}
                >
                  <CharacterAvatar
                    character={characters[p.shown_as ?? p.id] ?? null}
                    initials={nameOf(p.id).charAt(0).toUpperCase()}
                    className="h-full w-full"
                    textClass="text-sm"
                  />
                  {p.in_prison && (
                    <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: BARS }} />
                  )}
                </span>
                <span
                  aria-hidden
                  className="mt-1.5 block w-full max-w-[7.5rem] truncate rounded-[4px] px-1 text-[11px] font-semibold leading-[18px] shadow-[0_1px_3px_rgba(0,0,0,.4)] sm:text-xs sm:leading-5"
                  style={{
                    background: gc?.background ?? "#e9dcb5",
                    color: gc ? (gc.lightText ? "#fff7e6" : "#1c140c") : "#2a1c10",
                  }}
                >
                  {nameOf(p.id)}
                </span>
                <span aria-hidden className="mt-0.5 text-[10px] text-[#e9d9a8]/85 sm:text-[11px]">
                  {isMe ? "You, " + part(p.id).toLowerCase() : part(p.id)}
                </span>
                <span
                  aria-hidden
                  className={`mt-1 flex items-center gap-0.5 rounded-[3px] px-2 py-0.5 text-sm font-bold tabular-nums shadow-[0_2px_5px_rgba(0,0,0,.4)] ${heading}`}
                  style={{
                    background: SHEET_PAPER,
                    color: n > 0 ? "#1d6b2c" : n < 0 ? "#b3141b" : "rgba(42,28,16,.55)",
                  }}
                >
                  {sign(n)}
                  {n !== 0 && <SoulFlame size={12} />}
                </span>
              </li>
            );
          })}
        </ul>
      </DeskSurface>
    </div>
  );
}

// A little stack of gold coins over a winner: one coin per 40 earned, up to
// five. Losers and the unchanged get an empty spot so the row lines up.
function Coins({ amount }: { amount: number }) {
  const count = amount > 0 ? Math.min(5, Math.max(1, Math.ceil(amount / 40))) : 0;
  return (
    <span aria-hidden className="relative mb-1 block h-[26px] w-8">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="absolute left-1/2 h-[7px] w-7 -translate-x-1/2 rounded-[50%]"
          style={{
            bottom: i * 4,
            background: "linear-gradient(180deg, #f7d774 0 45%, #b8860b 45%)",
            boxShadow: "0 0 0 1px #7a5a12, 0 1px 1px rgba(0,0,0,.4)",
          }}
        />
      ))}
    </span>
  );
}
