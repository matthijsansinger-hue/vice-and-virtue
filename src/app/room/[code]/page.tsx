"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStoredPlayerId } from "@/lib/player";
import { startGame } from "@/lib/game";
import { getRole } from "@/lib/roles";
import { RoleCard } from "@/components/RoleCard";
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
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

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

  async function handleStartGame() {
    if (!roomId) return;
    setStarting(true);
    setStartError(null);
    try {
      await startGame(
        roomId,
        players.map((p) => p.id)
      );
      // The room status flips to "in_game" via realtime, which re-renders
      // this page into the role-reveal screen below.
    } catch (e) {
      setStartError(
        e instanceof Error ? e.message : "Could not start the game."
      );
      setStarting(false);
    }
  }

  // ----- Render -----

  if (loading) {
    return <Centered>Loading lobby&hellip;</Centered>;
  }

  if (error === "not-found") {
    return (
      <Centered>
        <p className="text-xl">No room with code &ldquo;{code}&rdquo;.</p>
        <Link href="/" className="mt-4 text-gold underline">
          Back to start
        </Link>
      </Centered>
    );
  }

  if (error) {
    return (
      <Centered>
        <p className="text-xl text-red-300">Something went wrong.</p>
        <pre className="mt-2 max-w-sm whitespace-pre-wrap text-sm text-red-300">
          {error}
        </pre>
        <Link href="/" className="mt-4 text-gold underline">
          Back to start
        </Link>
      </Centered>
    );
  }

  // Game has started: show the player their role.
  if (room?.status === "in_game") {
    if (!myPlayer) {
      return (
        <Centered>
          <p className="text-xl">This game is already in progress.</p>
          <Link href="/" className="mt-4 text-gold underline">
            Back to start
          </Link>
        </Centered>
      );
    }

    const myRole = getRole(myPlayer.role);
    if (!myRole) {
      return <Centered>Assigning your role&hellip;</Centered>;
    }

    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-home-bg px-6 text-cream">
        <RoleCard role={myRole} />
        <p className="text-center text-sm text-cream/60">
          The reflection phase is the next milestone.
        </p>
      </main>
    );
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
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center justify-between rounded-lg border border-gold/40 bg-cream px-4 py-3 text-home-bg"
            >
              <span>
                {player.name}
                {player.id === myPlayerId && (
                  <span className="ml-2 text-xs text-home-bg/50">(you)</span>
                )}
              </span>
              {player.is_host && (
                <span className="rounded bg-gold px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-home-bg">
                  Host
                </span>
              )}
            </li>
          ))}
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
                  room?.outreach_enabled
                    ? "font-semibold text-green-700"
                    : "font-semibold text-home-bg/40"
                }
              >
                {room?.outreach_enabled ? "ON" : "OFF"}
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

// Small helper for the full-screen centered states (loading, errors, etc.).
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-home-bg px-6 text-center text-cream">
      {children}
    </main>
  );
}
