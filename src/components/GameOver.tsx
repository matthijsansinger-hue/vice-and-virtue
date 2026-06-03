"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROLES } from "@/lib/roles";
import { checkWinner } from "@/lib/winConditions";
import { useAuth } from "@/lib/useAuth";
import { getNewlyEarnedBadges } from "@/lib/achievements";
import { BadgeTile } from "@/components/BadgesShowcase";
import type { BadgeDef } from "@/lib/badges";
import type { Player, Room } from "@/lib/types";

export function GameOver({
  room,
  players,
  myPlayer,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
}) {
  const { profile } = useAuth();
  const [newBadges, setNewBadges] = useState<BadgeDef[]>([]);

  // Show badges earned because of this game (logged-in players only).
  useEffect(() => {
    if (!profile || myPlayer?.user_id !== profile.id) return;
    let active = true;
    getNewlyEarnedBadges(profile.id, profile.created_at, room.id, room.created_at)
      .then((b) => active && setNewBadges(b))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [profile, myPlayer?.user_id, room.id, room.created_at]);

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

  // Background image that matches the winning camp's victory intro.
  // A dark overlay layered on top keeps the cream cards + brown text
  // legible against the busy scenes.
  const bgImage =
    winner === "virtue"
      ? "/virtues-win-bg.png"
      : winner === "vice"
        ? "/vices-win-bg.png"
        : null;

  return (
    <main
      className="relative flex min-h-screen flex-col items-center bg-home-bg bg-cover bg-center bg-no-repeat px-6 py-12 text-cream"
      style={bgImage ? { backgroundImage: `url('${bgImage}')` } : undefined}
    >
      {bgImage && (
        <div
          className="pointer-events-none absolute inset-0 bg-black/55"
          aria-hidden
        />
      )}
      <div className="relative w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-gold">
          Game over
        </h1>

        {winner === "virtue" || winner === "vice" ? (
          // Illustrated camp banner (transparent PNG) over the victory
          // background. Plain <img> to avoid Next/Image's checker artefact
          // on transparent PNGs.
          <div className="mt-4 flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                winner === "virtue"
                  ? "/virtues-win-text.png"
                  : "/vices-win-text.png"
              }
              alt={winnerLabel}
              className="h-auto w-full max-w-xs drop-shadow-2xl"
            />
            {myOutcome && (
              <p className="mt-1 text-sm text-cream/90">
                {myOutcome === "win" ? "You won!" : "You lost."}
              </p>
            )}
          </div>
        ) : (
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
        )}

        {newBadges.length > 0 && (
          <div className="mt-6 rounded-xl border border-gold bg-home-bg/70 p-4">
            <h2 className="text-center text-sm uppercase tracking-widest text-gold">
              {newBadges.length === 1
                ? "New badge earned!"
                : `${newBadges.length} new badges earned!`}
            </h2>
            <div className="mt-3 flex flex-wrap justify-center gap-4">
              {newBadges.map((b) => (
                <BadgeTile key={b.id} badge={b} />
              ))}
            </div>
            <p className="mt-2 text-center text-[11px] text-cream/50">
              Tap or hover a badge to see how you earned it.
            </p>
          </div>
        )}

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
                  {player.dead && (
                    <span className="ml-2 text-xs text-home-bg/50">
                      (dead)
                    </span>
                  )}
                  {player.in_prison && !player.dead && (
                    <span className="ml-2 text-xs text-home-bg/50">
                      (prison)
                    </span>
                  )}
                  {player.in_hospital && !player.dead && !player.in_prison && (
                    <span className="ml-2 text-xs text-home-bg/50">
                      (hospital)
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
