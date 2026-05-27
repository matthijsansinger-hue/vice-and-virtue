"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { startGame, kickPlayer } from "@/lib/game";
import { clearStoredPlayer } from "@/lib/player";
import { displayedName } from "@/lib/swaps";
import type { Room, Player } from "@/lib/types";

export function Lobby({
  room,
  players,
  myPlayer,
  code,
}: {
  room: Room;
  players: Player[];
  myPlayer: Player | null;
  code: string;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const isHost = myPlayer?.is_host ?? false;

  async function kick(playerId: string) {
    await kickPlayer(playerId);
  }

  async function leave() {
    if (!myPlayer) return;
    await kickPlayer(myPlayer.id);
    clearStoredPlayer();
    router.push("/");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; ignore silently.
    }
  }

  async function toggleOutreach() {
    await supabase
      .from("rooms")
      .update({ outreach_enabled: !room.outreach_enabled })
      .eq("id", room.id);
  }

  async function handleStartGame() {
    setStarting(true);
    setStartError(null);
    try {
      await startGame(
        room.id,
        players.map((p) => p.id)
      );
    } catch (e) {
      setStartError(
        e instanceof Error ? e.message : "Could not start the game."
      );
      setStarting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-home-bg px-6 py-12 text-cream">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-gold">
          Lobby
        </h1>

        {/* Room code */}
        <button
          onClick={copyCode}
          className="mt-2 flex w-full flex-col items-center rounded-xl border border-gold bg-cream py-4 text-home-bg transition-opacity hover:opacity-90"
        >
          <span className="text-4xl font-semibold tracking-[0.3em]">
            {code}
          </span>
          <span className="mt-1 text-xs text-home-bg/60">
            {copied ? "Copied!" : "Tap to copy and share"}
          </span>
        </button>

        {/* Player list */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-widest text-gold">
            Players
          </h2>
          <span className="text-sm text-cream/60">{players.length}</span>
        </div>

        <ul className="mt-2 flex flex-col gap-2">
          {players.map((player) => {
            const isMe = player.id === myPlayer?.id;
            return (
              <li
                key={player.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-gold/40 bg-cream px-4 py-3 text-home-bg"
              >
                <span className="min-w-0 flex-1 truncate">
                  {displayedName(player, room, players)}
                  {isMe && (
                    <span className="ml-2 text-xs text-home-bg/50">(you)</span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {player.is_host && (
                    <span className="rounded bg-gold px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-home-bg">
                      Host
                    </span>
                  )}
                  {/* Host can kick anyone but themselves. */}
                  {isHost && !isMe && (
                    <button
                      onClick={() => kick(player.id)}
                      title={`Kick ${player.name}`}
                      className="rounded border border-red-700/40 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-700 hover:text-cream"
                    >
                      Kick
                    </button>
                  )}
                  {/* Non-host players can leave the lobby. */}
                  {isMe && !player.is_host && (
                    <button
                      onClick={leave}
                      className="rounded border border-home-bg/40 px-2 py-0.5 text-xs font-medium text-home-bg/70 hover:bg-home-bg hover:text-cream"
                    >
                      Leave
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {!myPlayer && (
          <p className="mt-4 text-center text-sm text-cream/60">
            You are viewing this lobby but have not joined it.
          </p>
        )}

        {/* Host controls */}
        {isHost ? (
          <div className="mt-8 flex flex-col gap-3">
            <button
              onClick={toggleOutreach}
              className="flex items-center justify-between rounded-lg border border-gold/40 bg-cream px-4 py-3 text-left text-home-bg"
            >
              <span>Outreach phase</span>
              <span
                className={
                  room.outreach_enabled
                    ? "font-semibold text-green-700"
                    : "font-semibold text-home-bg/40"
                }
              >
                {room.outreach_enabled ? "ON" : "OFF"}
              </span>
            </button>

            <button
              onClick={handleStartGame}
              disabled={starting}
              className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {starting ? "Starting…" : "Start game"}
            </button>

            {startError && (
              <p className="text-center text-sm text-red-300">{startError}</p>
            )}
          </div>
        ) : (
          <p className="mt-8 text-center text-sm text-cream/60">
            Waiting for the host to start the game&hellip;
          </p>
        )}
      </div>
    </main>
  );
}
