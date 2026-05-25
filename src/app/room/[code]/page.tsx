"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStoredPlayerId } from "@/lib/player";
import { Centered } from "@/components/Centered";
import { Lobby } from "@/components/Lobby";
import { RoleReveal } from "@/components/RoleReveal";
import { RoleAction } from "@/components/RoleAction";
import { Minigame } from "@/components/Minigame";
import { Result } from "@/components/Result";
import { Outreach } from "@/components/Outreach";
import { Consultation } from "@/components/Consultation";
import { GameOver } from "@/components/GameOver";
import type { Room, Player } from "@/lib/types";

// The room page loads the room + players, keeps them live with realtime,
// and renders the screen for the room's current phase.
export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      .channel(`room-${roomId}`)
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

  if (loading) {
    return <Centered>Loading&hellip;</Centered>;
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

  if (error || !room) {
    return (
      <Centered>
        <p className="text-xl text-red-300">Something went wrong.</p>
        {error && (
          <pre className="mt-2 max-w-sm whitespace-pre-wrap text-sm text-red-300">
            {error}
          </pre>
        )}
        <Link href="/" className="mt-4 text-gold underline">
          Back to start
        </Link>
      </Centered>
    );
  }

  // Phases past the lobby require you to be a player in the room.
  if (room.phase !== "lobby" && !myPlayer) {
    return (
      <Centered>
        <p className="text-xl">This game is already in progress.</p>
        <Link href="/" className="mt-4 text-gold underline">
          Back to start
        </Link>
      </Centered>
    );
  }

  switch (room.phase) {
    case "role_reveal":
      return <RoleReveal room={room} players={players} myPlayer={myPlayer} />;
    case "role_action":
      return <RoleAction room={room} players={players} myPlayer={myPlayer} />;
    case "minigame":
      return <Minigame room={room} players={players} myPlayer={myPlayer} />;
    case "result":
      return <Result room={room} players={players} myPlayer={myPlayer} />;
    case "outreach":
      return <Outreach room={room} players={players} myPlayer={myPlayer} />;
    case "consultation":
      return (
        <Consultation room={room} players={players} myPlayer={myPlayer} />
      );
    case "game_over":
      return <GameOver players={players} myPlayer={myPlayer} />;
    case "lobby":
    default:
      return (
        <Lobby room={room} players={players} myPlayer={myPlayer} code={code} />
      );
  }
}
