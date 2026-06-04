"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStoredPlayerId } from "@/lib/player";
import { Centered } from "@/components/Centered";
import { Lobby } from "@/components/Lobby";
import { GameOverview } from "@/components/GameOverview";
import { LoreIntro } from "@/components/LoreIntro";
import { RoleReveal } from "@/components/RoleReveal";
import { RoleAction } from "@/components/RoleAction";
import { EventSummary } from "@/components/EventSummary";
import { Minigame } from "@/components/Minigame";
import { Result } from "@/components/Result";
import { Outreach } from "@/components/Outreach";
import { GroupAction } from "@/components/GroupAction";
import { Consultation } from "@/components/Consultation";
import { NewDay } from "@/components/NewDay";
import { MurderSuccession } from "@/components/MurderSuccession";
import { ViceVictoryIntro } from "@/components/ViceVictoryIntro";
import { VirtueVictoryIntro } from "@/components/VirtueVictoryIntro";
import { GameOver } from "@/components/GameOver";
import { TopBar } from "@/components/TopBar";
import type { Room, Player } from "@/lib/types";

// Public player columns only — the secret fields (role / vote /
// pending_action / pending_target) are never fetched in the player list.
// Your own come from get_my_secrets; other players' come from purpose-built
// RPCs. This is what stops roles being sent to the browser.
const PUBLIC_PLAYER_COLS =
  "id, room_id, user_id, name, is_host, connected, ready, minigame_score, minigame_submitted_at, soul_energy, has_voted, in_prison, dead, in_hospital, acted_this_day, murder_kills, created_at";

type MySecrets = {
  role: string | null;
  vote: string | null;
  pending_action: string | null;
  pending_target: string | null;
};
const EMPTY_SECRETS: MySecrets = {
  role: null,
  vote: null,
  pending_action: null,
  pending_target: null,
};

// Public rows -> Player[], with the secret fields filled as null (your own
// are merged in separately from get_my_secrets).
function toPlayers(rows: unknown): Player[] {
  return ((rows as Record<string, unknown>[] | null) ?? []).map((r) => ({
    ...r,
    ...EMPTY_SECRETS,
  })) as unknown as Player[];
}

// The room page loads the room + players, keeps them live with realtime,
// and renders the screen for the room's current phase.
export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [mySecrets, setMySecrets] = useState<MySecrets>(EMPTY_SECRETS);
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
        .select(PUBLIC_PLAYER_COLS)
        .eq("room_id", roomData.id)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      setPlayers(toPlayers(playerData));
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

    // Re-pull the full current state (room + players). Used both for live
    // updates and to recover from a desync after a dropped connection.
    async function resync() {
      const [{ data: roomData }, { data: playerData }] = await Promise.all([
        supabase.from("rooms").select().eq("id", roomId).maybeSingle(),
        supabase
          .from("players")
          .select(PUBLIC_PLAYER_COLS)
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
      ]);
      if (roomData) setRoom(roomData as Room);
      setPlayers(toPlayers(playerData));
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
        resync
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
      .subscribe((status) => {
        // Fires on first connect AND on every automatic re-subscribe after
        // the socket drops — so a client that briefly lost its connection
        // catches up on anything it missed while offline.
        if (status === "SUBSCRIBED") resync();
      });

    // Phones lock the screen and networks blip; either can silently stall
    // the realtime socket. Re-pull whenever the tab becomes visible again
    // or the network comes back, so the player never sits on stale state.
    function onWake() {
      if (document.visibilityState === "visible") resync();
    }
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [roomId]);

  // Merge in my OWN secrets (role / vote / queued action), fetched
  // separately so other players' secrets are never sent to this browser.
  useEffect(() => {
    if (!myPlayerId || !players.some((p) => p.id === myPlayerId)) {
      setMySecrets(EMPTY_SECRETS);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("get_my_secrets", { p_player_id: myPlayerId })
      .then(({ data }) => {
        if (cancelled || !data) return;
        const s = data as Partial<MySecrets>;
        setMySecrets({
          role: s.role ?? null,
          vote: s.vote ?? null,
          pending_action: s.pending_action ?? null,
          pending_target: s.pending_target ?? null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [players, myPlayerId]);

  const publicMe = players.find((p) => p.id === myPlayerId) ?? null;
  const myPlayer: Player | null = publicMe
    ? { ...publicMe, ...mySecrets }
    : null;

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

  const phaseScreen = (() => {
    switch (room.phase) {
      case "game_overview":
        return (
          <GameOverview room={room} players={players} myPlayer={myPlayer} />
        );
      case "lore_intro":
        return <LoreIntro room={room} myPlayer={myPlayer} />;
      case "role_reveal":
        return (
          <RoleReveal room={room} players={players} myPlayer={myPlayer} />
        );
    case "role_action":
      return <RoleAction room={room} players={players} myPlayer={myPlayer} />;
    case "murder_succession":
      return (
        <MurderSuccession
          room={room}
          players={players}
          myPlayer={myPlayer}
        />
      );
    case "event_summary":
      return (
        <EventSummary room={room} players={players} myPlayer={myPlayer} />
      );
    case "minigame":
      return <Minigame room={room} players={players} myPlayer={myPlayer} />;
    case "result":
      return <Result room={room} players={players} myPlayer={myPlayer} />;
    case "outreach":
      return <Outreach room={room} players={players} myPlayer={myPlayer} />;
    case "group_action":
      return (
        <GroupAction room={room} players={players} myPlayer={myPlayer} />
      );
    case "consultation":
      return (
        <Consultation room={room} players={players} myPlayer={myPlayer} />
      );
    case "new_day":
      return <NewDay room={room} myPlayer={myPlayer} />;
      case "vice_victory_intro":
        return <ViceVictoryIntro room={room} myPlayer={myPlayer} />;
      case "virtue_victory_intro":
        return <VirtueVictoryIntro room={room} myPlayer={myPlayer} />;
      case "game_over":
        return <GameOver room={room} players={players} myPlayer={myPlayer} />;
      case "lobby":
      default:
        return (
          <Lobby
            room={room}
            players={players}
            myPlayer={myPlayer}
            code={code}
          />
        );
    }
  })();

  return (
    <>
      <TopBar room={room} players={players} myPlayer={myPlayer} />
      {phaseScreen}
    </>
  );
}
