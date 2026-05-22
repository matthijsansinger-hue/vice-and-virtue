"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStoredPlayerId } from "@/lib/player";
import type { Room, Player } from "@/lib/types";

export default function LobbyPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Initial load: find the room by its code, then load its players.
  useEffect(() => {
    setMyPlayerId(getStoredPlayerId());
    let cancelled = false;

    async function load() {
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select()
        .eq("code", code)
        .maybeSingle();

      if (cancelled) return;
      if (roomError) {
        setError(roomError.message);
        setLoading(false);
        return;
      }
      if (!roomData) {
        setError("not-found");
        setLoading(false);
        return;
      }

      setRoom(roomData as Room);
      setRoomId(roomData.id);

      const { data: playerData } = await supabase
        .from("players")
        .select()
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      setPlayers((playerData ?? []) as Player[]);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Realtime: keep the player list and room state live.
  useEffect(() => {
    if (!roomId) return;

    async function reloadPlayers() {
      const { data } = await supabase
        .from("players")
        .select()
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      setPlayers((data ?? []) as Player[]);
    }

    const channel = supabase
      .channel(`lobby-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${roomId}`,
        },
        reloadPlayers
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => setRoom(payload.new as Room)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  const myPlayer = players.find((p) => p.id === myPlayerId) ?? null;
  const isHost = myPlayer?.is_host ?? false;

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
    if (!room) return;
    await supabase
      .from("rooms")
      .update({ outreach_enabled: !room.outreach_enabled })
      .eq("id", room.id);
  }

  async function startGame() {
    if (!roomId) return;
    await supabase.from("rooms").update({ status: "in_game" }).eq("id", roomId);
  }

  // ----- Render -----

  if (loading) {
    return <Centered>Loading lobby&hellip;</Centered>;
  }

  if (error === "not-found") {
    return (
      <Centered>
        <p className="text-xl">
          No room with code &ldquo;{code}&rdquo;.
        </p>
        <Link href="/" className="mt-4 text-zinc-400 underline">
          Back to start
        </Link>
      </Centered>
    );
  }

  if (error) {
    return (
      <Centered>
        <p className="text-xl text-red-400">Something went wrong.</p>
        <pre className="mt-2 max-w-sm whitespace-pre-wrap text-sm text-red-400">
          {error}
        </pre>
        <Link href="/" className="mt-4 text-zinc-400 underline">
          Back to start
        </Link>
      </Centered>
    );
  }

  if (room?.status === "in_game") {
    return (
      <Centered>
        <p className="text-2xl font-semibold">The game has started.</p>
        <p className="mt-2 max-w-sm text-zinc-400">
          The game phases are the next milestone &mdash; this screen is a
          placeholder for now.
        </p>
      </Centered>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-black px-6 py-12 text-white">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-sm uppercase tracking-widest text-zinc-500">
          Lobby
        </h1>

        {/* Room code */}
        <button
          onClick={copyCode}
          className="mt-2 flex w-full flex-col items-center rounded-xl border border-zinc-800 bg-zinc-900 py-4 transition-colors hover:border-zinc-600"
        >
          <span className="text-4xl font-semibold tracking-[0.3em]">
            {code}
          </span>
          <span className="mt-1 text-xs text-zinc-500">
            {copied ? "Copied!" : "Tap to copy and share"}
          </span>
        </button>

        {/* Player list */}
        <div className="mt-8 flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-widest text-zinc-500">
            Players
          </h2>
          <span className="text-sm text-zinc-500">{players.length}</span>
        </div>

        <ul className="mt-2 flex flex-col gap-2">
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <span>
                {player.name}
                {player.id === myPlayerId && (
                  <span className="ml-2 text-xs text-zinc-500">(you)</span>
                )}
              </span>
              {player.is_host && (
                <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs uppercase tracking-wide">
                  Host
                </span>
              )}
            </li>
          ))}
        </ul>

        {!myPlayer && (
          <p className="mt-4 text-center text-sm text-zinc-500">
            You are viewing this lobby but have not joined it.
          </p>
        )}

        {/* Host controls */}
        {isHost ? (
          <div className="mt-8 flex flex-col gap-3">
            <button
              onClick={toggleOutreach}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-left"
            >
              <span>Outreach phase</span>
              <span
                className={
                  room?.outreach_enabled
                    ? "font-medium text-green-400"
                    : "font-medium text-zinc-500"
                }
              >
                {room?.outreach_enabled ? "ON" : "OFF"}
              </span>
            </button>

            <button
              onClick={startGame}
              className="rounded-lg bg-white px-4 py-3 font-medium text-black transition-colors hover:bg-zinc-300"
            >
              Start game
            </button>
          </div>
        ) : (
          <p className="mt-8 text-center text-sm text-zinc-500">
            Waiting for the host to start the game&hellip;
          </p>
        )}
      </div>
    </main>
  );
}

// Small helper for the full-screen centered states (loading, errors, etc.).
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center text-white">
      {children}
    </main>
  );
}
