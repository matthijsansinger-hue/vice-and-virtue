"use client";

import Link from "next/link";
import { ROLES } from "@/lib/roles";
import { checkWinner } from "@/lib/winConditions";
import type { Player } from "@/lib/types";

export function GameOver({
  players,
  myPlayer,
}: {
  players: Player[];
  myPlayer: Player | null;
}) {
  const winner = checkWinner(players);
  const myCamp = myPlayer?.role ? ROLES[myPlayer.role]?.camp : undefined;
  const myOutcome =
    winner && myCamp ? (myCamp === winner ? "win" : "loss") : null;

  const winnerLabel =
    winner === "virtue"
      ? "Virtues win"
      : winner === "vice"
        ? "Vices win"
        : "Game over";

  const bannerClass =
    winner === "virtue"
      ? "bg-consultation-fg text-cream"
      : winner === "vice"
        ? "bg-consultation-bg text-cream"
        : "bg-cream text-home-bg";

  return (
    <main className="flex min-h-screen flex-col items-center bg-home-bg px-6 py-12 text-cream">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-gold">
          Game over
        </h1>

        <div
          className={
            "mt-4 rounded-xl border-2 border-gold p-6 text-center " +
            bannerClass
          }
        >
          <p className="text-3xl font-semibold">{winnerLabel}</p>
          {myOutcome && (
            <p className="mt-2 text-sm opacity-80">
              {myOutcome === "win" ? "You won!" : "You lost."}
            </p>
          )}
        </div>

        <h2 className="mt-8 text-sm uppercase tracking-widest text-gold">
          Roles revealed
        </h2>
        <ul className="mt-2 flex flex-col gap-2">
          {players.map((player) => {
            const role = player.role ? ROLES[player.role] : undefined;
            const isMe = player.id === myPlayer?.id;
            const campLabel = role ? (role.camp === "vice" ? "Vice" : "Virtue") : "?";
            const campClass = role
              ? role.camp === "vice"
                ? "bg-consultation-bg text-cream"
                : "bg-consultation-fg text-cream"
              : "bg-home-bg/20 text-home-bg/60";
            return (
              <li
                key={player.id}
                className={
                  "flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-home-bg " +
                  (isMe ? "border-2 border-gold" : "border border-gold/40")
                }
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{player.name}</span>
                  {isMe && (
                    <span className="ml-2 text-xs text-home-bg/50">(you)</span>
                  )}
                  {player.in_prison && (
                    <span className="ml-2 text-xs text-home-bg/50">
                      (prison)
                    </span>
                  )}
                </span>
                <span className="text-sm text-home-bg/80">
                  {role?.name ?? "—"}
                </span>
                <span
                  className={
                    "rounded px-2 py-0.5 text-xs font-semibold uppercase " +
                    campClass
                  }
                >
                  {campLabel}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 text-center">
          <Link
            href="/"
            className="rounded-lg bg-gold px-6 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90"
          >
            Back to start
          </Link>
        </div>
      </div>
    </main>
  );
}
