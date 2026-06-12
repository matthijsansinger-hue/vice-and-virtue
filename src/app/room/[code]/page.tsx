"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStoredPlayerId } from "@/lib/player";
import { Centered } from "@/components/Centered";
import { Lobby } from "@/components/Lobby";
import { GameOverview } from "@/components/GameOverview";
import { RoleSelect } from "@/components/RoleSelect";
import { RoleOverview } from "@/components/RoleOverview";
import { LoreIntro } from "@/components/LoreIntro";
import { RoleReveal } from "@/components/RoleReveal";
import { RoleAction } from "@/components/RoleAction";
import { EventSummary } from "@/components/EventSummary";
import { Minigame } from "@/components/Minigame";
import { Result } from "@/components/Result";
import { Outreach } from "@/components/Outreach";
import { Store } from "@/components/Store";
import { GroupAction } from "@/components/GroupAction";
import { Consultation } from "@/components/Consultation";
import { NewDay } from "@/components/NewDay";
import { MurderSuccession } from "@/components/MurderSuccession";
import { ViceVictoryIntro } from "@/components/ViceVictoryIntro";
import { VirtueVictoryIntro } from "@/components/VirtueVictoryIntro";
import { GameOver } from "@/components/GameOver";
import { TopBar } from "@/components/TopBar";
import { PlayerNotices } from "@/components/PlayerNotices";
import type { Room, Player } from "@/lib/types";

// Public player columns only — the secret fields (role / vote /
// pending_action / pending_target) are never fetched in the player list.
// Your own come from get_my_secrets; other players' come from purpose-built
// RPCs. This is what stops roles being sent to the browser.
const PUBLIC_PLAYER_COLS =
  "id, room_id, user_id, name, is_host, connected, ready, minigame_score, minigame_submitted_at, soul_energy, has_voted, in_prison, dead, in_hospital, acted_this_day, murder_kills, muted, created_at";

// Public room columns only — the secret "tells" (envy_swap_a/b,
// torment_target, pending_murder_death, recent_successor_id) are never sent;
// per-viewer flags come from get_my_secrets, display names from get_display_names.
const PUBLIC_ROOM_COLS =
  "id, code, status, is_public, is_ranked, phase, phase_ends_at, day, outreach_enabled, last_imprisoned_player, vote_reveal, revote_candidates, last_events, group_action_result, group_action_freed_id, eye_revealed, eye_uses_left, free_uses_left, role_pool, next_room_code, minigame_clue, role_assign_mode, role_config, created_at";

type MySecrets = {
  role: string | null;
  vote: string | null;
  pending_action: string | null;
  pending_target: string | null;
  is_dying_murder: boolean;
  is_recent_successor: boolean;
  is_tormented: boolean;
  extra_lives: number;
  bomb_must_pass: boolean;
  bomb_pass_to: string | null;
  notices: { id: string; text: string }[];
};
const EMPTY_SECRETS: MySecrets = {
  role: null,
  vote: null,
  pending_action: null,
  pending_target: null,
  is_dying_murder: false,
  is_recent_successor: false,
  is_tormented: false,
  extra_lives: 0,
  bomb_must_pass: false,
  bomb_pass_to: null,
  notices: [],
};

// Public rows -> Player[], with the secret fields filled as null (your own
// are merged in separately from get_my_secrets).
function toPlayers(rows: unknown): Player[] {
  return ((rows as Record<string, unknown>[] | null) ?? []).map((r) => ({
    ...r,
    role: null,
    vote: null,
    pending_action: null,
    pending_target: null,
  })) as unknown as Player[];
}

// Public room row -> Room, with the secret tells filled null.
function toRoom(row: unknown): Room | null {
  if (!row) return null;
  return {
    ...(row as Record<string, unknown>),
    envy_swap_a: null,
    envy_swap_b: null,
    torment_target: null,
    pending_murder_death: null,
    recent_successor_id: null,
  } as unknown as Room;
}

// The room page loads the room + players, keeps them live with realtime,
// and renders the screen for the room's current phase.
export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();

  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [mySecrets, setMySecrets] = useState<MySecrets>(EMPTY_SECRETS);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when the room is deleted out from under us (e.g. an un-started lobby
  // that expired). Triggers a redirect back to the start screen.
  const [gone, setGone] = useState(false);

  // Initial load: find the room by its code, then load its players.
  useEffect(() => {
    setMyPlayerId(getStoredPlayerId());
    let cancelled = false;

    async function load() {
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(PUBLIC_ROOM_COLS)
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

      const rid = (roomData as { id: string }).id;
      setRoom(toRoom(roomData));
      setRoomId(rid);

      const { data: playerData } = await supabase
        .from("players")
        .select(PUBLIC_PLAYER_COLS)
        .eq("room_id", rid)
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
      const [{ data: roomData, error: roomErr }, { data: playerData }] = await Promise.all([
        supabase.from("rooms").select(PUBLIC_ROOM_COLS).eq("id", roomId).maybeSingle(),
        supabase
          .from("players")
          .select(PUBLIC_PLAYER_COLS)
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
      ]);
      // A clean "0 rows" (no error) means the room was deleted — e.g. an
      // un-started lobby that expired. Send everyone back to the start screen.
      if (!roomErr && !roomData) {
        setGone(true);
        return;
      }
      if (roomData) setRoom(toRoom(roomData));
      setPlayers(toPlayers(playerData));
    }

    // Room-only refetch (public columns) for room UPDATE events, so the
    // realtime payload's secret "tells" never enter client state.
    async function refetchRoom() {
      const { data, error } = await supabase
        .from("rooms")
        .select(PUBLIC_ROOM_COLS)
        .eq("id", roomId)
        .maybeSingle();
      if (error) return; // transient network error — keep state; the poll retries
      if (data) setRoom(toRoom(data));
      else setGone(true); // room deleted (e.g. an expired lobby) -> redirect home
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
        refetchRoom
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

    // Safety-net poll: a realtime event can be missed (a dropped socket, or a
    // Supabase project where a table isn't realtime-enabled). Re-pull the FULL
    // state (room + players) every few seconds so transitions always land even
    // when the live event never arrives. This covers not just room phase
    // changes (the host clicking Start) but also player readiness, which the
    // majority-continue gate depends on: if a player's `ready` UPDATE is
    // dropped, the host must still see it to advance — otherwise everyone
    // presses Proceed and the game never starts. (refetchRoom alone, used by
    // the realtime rooms handler, never refreshed players.) Realtime stays the
    // fast path; this guarantees the screen never gets stuck waiting on it.
    const poll = setInterval(resync, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [roomId]);

  // When the room disappears out from under us — an expired lobby, or any
  // other server-side deletion — send the player back to the start screen
  // after a short beat so they see why. Everyone still in the room is bounced.
  useEffect(() => {
    if (!gone) return;
    const t = setTimeout(() => router.replace("/"), 2500);
    return () => clearTimeout(t);
  }, [gone, router]);

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
          is_dying_murder: s.is_dying_murder ?? false,
          is_recent_successor: s.is_recent_successor ?? false,
          is_tormented: s.is_tormented ?? false,
          extra_lives: s.extra_lives ?? 0,
          bomb_must_pass: s.bomb_must_pass ?? false,
          bomb_pass_to: s.bomb_pass_to ?? null,
          notices: s.notices ?? [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [players, myPlayerId]);

  // Per-viewer display names (Envy swap + duplicate indexing) from the
  // server — the raw envy_swap fields never reach the client.
  useEffect(() => {
    if (!roomId || !myPlayerId) {
      setDisplayNames({});
      return;
    }
    let cancelled = false;
    supabase
      .rpc("get_display_names", { p_room_id: roomId, p_viewer_id: myPlayerId })
      .then(({ data }) => {
        if (!cancelled && data && typeof data === "object") {
          setDisplayNames(data as Record<string, string>);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, myPlayerId, room?.phase, room?.day, players.length]);

  // Apply server display names so Envy's swap renders without the client
  // ever seeing the raw swap fields — existing `.name` / displayedName
  // usages just work on these.
  const displayPlayers = players.map((p) => ({
    ...p,
    name: displayNames[p.id] ?? p.name,
  }));

  const publicMe = displayPlayers.find((p) => p.id === myPlayerId) ?? null;
  const myPlayer: Player | null = publicMe
    ? { ...publicMe, ...mySecrets }
    : null;

  if (loading) {
    return <Centered>Loading&hellip;</Centered>;
  }

  if (gone) {
    return (
      <Centered>
        <p className="text-xl">
          {room?.phase === "lobby"
            ? "This lobby was closed because the host didn't start within 10 minutes."
            : "This room is no longer available."}
        </p>
        <p className="mt-2 text-sm text-cream/70">
          Sending you back to the start screen&hellip;
        </p>
        <Link href="/" className="mt-4 text-gold underline">
          Back to start
        </Link>
      </Centered>
    );
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
          <GameOverview room={room} players={displayPlayers} myPlayer={myPlayer} />
        );
      case "role_select":
        return (
          <RoleSelect room={room} players={displayPlayers} myPlayer={myPlayer} />
        );
      case "role_overview":
        return (
          <RoleOverview room={room} players={displayPlayers} myPlayer={myPlayer} />
        );
      case "lore_intro":
        return <LoreIntro room={room} myPlayer={myPlayer} />;
      case "role_reveal":
        return (
          <RoleReveal room={room} players={displayPlayers} myPlayer={myPlayer} />
        );
    case "role_action":
      return <RoleAction room={room} players={displayPlayers} myPlayer={myPlayer} />;
    case "murder_succession":
      return (
        <MurderSuccession
          room={room}
          players={displayPlayers}
          myPlayer={myPlayer}
        />
      );
    case "event_summary":
      return (
        <EventSummary room={room} players={displayPlayers} myPlayer={myPlayer} />
      );
    case "minigame":
      return <Minigame room={room} players={displayPlayers} myPlayer={myPlayer} />;
    case "result":
      return <Result room={room} players={displayPlayers} myPlayer={myPlayer} />;
    case "outreach":
      return <Outreach room={room} players={displayPlayers} myPlayer={myPlayer} />;
    case "store":
      return <Store room={room} players={displayPlayers} myPlayer={myPlayer} />;
    case "group_action":
      return (
        <GroupAction room={room} players={displayPlayers} myPlayer={myPlayer} />
      );
    case "consultation":
      return (
        <Consultation room={room} players={displayPlayers} myPlayer={myPlayer} />
      );
    case "new_day":
      return <NewDay room={room} myPlayer={myPlayer} />;
      case "vice_victory_intro":
        return (
          <ViceVictoryIntro
            room={room}
            players={displayPlayers}
            myPlayer={myPlayer}
          />
        );
      case "virtue_victory_intro":
        return (
          <VirtueVictoryIntro
            room={room}
            players={displayPlayers}
            myPlayer={myPlayer}
          />
        );
      case "game_over":
        return <GameOver room={room} players={displayPlayers} myPlayer={myPlayer} />;
      case "lobby":
      default:
        return (
          <Lobby
            room={room}
            players={displayPlayers}
            myPlayer={myPlayer}
            code={code}
          />
        );
    }
  })();

  return (
    <>
      <TopBar room={room} players={displayPlayers} myPlayer={myPlayer} />
      {phaseScreen}
      <PlayerNotices notices={mySecrets.notices} />
    </>
  );
}
