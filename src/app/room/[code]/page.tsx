"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getStoredPlayerId } from "@/lib/player";
import { Centered } from "@/components/Centered";
import { LoadingScreen } from "@/components/LoadingScreen";
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
import { StoreSummary } from "@/components/StoreSummary";
import { Consultation } from "@/components/Consultation";
import { DeadSpectator } from "@/components/DeadSpectator";
import { NewDay } from "@/components/NewDay";
import { MurderSuccession } from "@/components/MurderSuccession";
import { ViceVictoryIntro } from "@/components/ViceVictoryIntro";
import { VirtueVictoryIntro } from "@/components/VirtueVictoryIntro";
import { WanderingSoulIntro } from "@/components/WanderingSoulIntro";
import { SoulVictoryIntro } from "@/components/SoulVictoryIntro";
import { GameOver } from "@/components/GameOver";
import { TopBar } from "@/components/TopBar";
import { PlayerNotices } from "@/components/PlayerNotices";
import { RoleChangePopup } from "@/components/RoleChangePopup";
import { AnimationProvider } from "@/components/animations/AnimationProvider";
import { PhaseTransition } from "@/components/animations/PhaseTransition";
import { AbilityOutcomeWatcher } from "@/components/animations/AbilityOutcomeWatcher";
import type { Room, Player } from "@/lib/types";

// Phases where a dead player becomes an omniscient spectator (DeadSpectator).
// Other in-game phases are summaries/splashes the dead already see normally.
const DEAD_SPECTATOR_PHASES = new Set<string>([
  "role_action",
  "minigame",
  "outreach",
  "store",
  "consultation",
]);

// Public player columns only — the secret fields (role / vote /
// pending_action / pending_target) are never fetched in the player list.
// Your own come from get_my_secrets; other players' come from purpose-built
// RPCs. This is what stops roles being sent to the browser.
const PUBLIC_PLAYER_COLS =
  "id, room_id, user_id, name, is_host, connected, ready, minigame_score, minigame_submitted_at, soul_energy, has_voted, in_prison, dead, in_hospital, acted_this_day, murder_kills, muted, ability_muted_day, created_at";

// Public room columns only — the secret "tells" (envy_swap_a/b,
// torment_target, pending_murder_death, recent_successor_id) are never sent;
// per-viewer flags come from get_my_secrets, display names from get_display_names.
const PUBLIC_ROOM_COLS =
  "id, code, status, is_public, is_ranked, phase, phase_ends_at, day, outreach_enabled, last_imprisoned_player, vote_reveal, revote_candidates, last_events, group_action_result, group_action_freed_id, eye_revealed, eye_uses_left, free_uses_left, role_pool, next_room_code, minigame_clue, role_assign_mode, role_config, anomaly_win, created_at";

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

// Realtime events are coalesced into one re-pull after this short quiet window.
const RESYNC_DEBOUNCE_MS = 150;
// Safety-net full re-pull interval (in case a realtime nudge is dropped) —
// 3s until nudges are proven to arrive, then relaxed to 6s.
const POLL_MS = 3000;
const POLL_MS_WITH_NUDGES = 6000;
// Background refresh of my own secrets (mid-phase notices from others).
const SECRETS_REFRESH_MS = 10000;

// Cheap structural equality for small JSON-shaped state — lets us keep the old
// object (and skip a re-render) when a re-pull returns identical data.
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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

  // Number of failed initial-load attempts so far (drives the "still
  // connecting" hint on the loading screen).
  const [loadAttempts, setLoadAttempts] = useState(0);

  // Initial load: find the room by its code, then load its players. A failed
  // or timed-out request is RETRIED with backoff instead of giving up — under
  // load the first attempt can fail, and before this a refresh mid-game could
  // sit on "Entering the castle…" forever.
  useEffect(() => {
    setMyPlayerId(getStoredPlayerId());
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function retry() {
      attempt += 1;
      setLoadAttempts(attempt);
      const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
      retryTimer = setTimeout(load, delay);
    }

    async function load() {
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select(PUBLIC_ROOM_COLS)
        .eq("code", code)
        .maybeSingle();

      if (cancelled) return;
      if (roomError) {
        retry();
        return;
      }
      if (!roomData) {
        setError("not-found");
        setLoading(false);
        return;
      }

      const rid = (roomData as { id: string }).id;

      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .select(PUBLIC_PLAYER_COLS)
        .eq("room_id", rid)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (playerError) {
        retry();
        return;
      }
      setRoom(toRoom(roomData));
      setRoomId(rid);
      setPlayers(toPlayers(playerData));
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [code]);

  // Realtime: keep the player list and room state live.
  useEffect(() => {
    if (!roomId) return;

    let disposed = false;

    // Re-pull the full current state (room + players). Used both for live
    // updates and to recover from a desync after a dropped connection.
    async function resync() {
      const [
        { data: roomData, error: roomErr },
        { data: playerData, error: playerErr },
      ] = await Promise.all([
        supabase.from("rooms").select(PUBLIC_ROOM_COLS).eq("id", roomId).maybeSingle(),
        supabase
          .from("players")
          .select(PUBLIC_PLAYER_COLS)
          .eq("room_id", roomId)
          .order("created_at", { ascending: true }),
      ]);
      if (disposed) return;
      // A clean "0 rows" (no error) means the room was deleted — e.g. an
      // un-started lobby that expired. Send everyone back to the start screen.
      if (!roomErr && !roomData) {
        setGone(true);
        return;
      }
      // Only replace state when something actually changed: a new array on
      // every poll re-rendered the whole phase screen (and re-ran every
      // [players] effect) every few seconds on every phone.
      if (roomData) {
        const next = toRoom(roomData);
        setRoom((prev) => (sameJson(prev, next) ? prev : next));
      }
      // On a failed players fetch keep the last good list — never blank it.
      if (!playerErr && playerData) {
        const next = toPlayers(playerData);
        setPlayers((prev) => (sameJson(prev, next) ? prev : next));
      }
    }

    // Coalesced resync. Updates used to arrive one realtime event PER PLAYER
    // ROW (20 events x 20 phones for one room-wide write), each firing its own
    // full re-pull — ~1,000+ requests a second on every phase change, which
    // overloaded the backend in the 20-player playtest. Now nudges, polls and
    // wake-ups all collapse into ONE re-pull per client, and never more than one
    // is in flight at a time (a nudge arriving mid-pull schedules exactly one more).
    let inFlight = false;
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // When the last re-pull started (drives the adaptive safety-net poll).
    let lastPullAt = 0;
    // Set once a nudge has actually arrived on this subscription — proof the
    // server-side broadcast works, so the poll can back off. Cleared whenever
    // the channel drops.
    let nudgesWork = false;

    async function run() {
      timer = null;
      if (inFlight) {
        dirty = true;
        return;
      }
      inFlight = true;
      lastPullAt = Date.now();
      try {
        await resync();
      } catch {
        // transient — the poll / next event retries
      } finally {
        inFlight = false;
        if (dirty && !disposed) {
          dirty = false;
          schedule(RESYNC_DEBOUNCE_MS);
        }
      }
    }

    function schedule(delay = RESYNC_DEBOUNCE_MS) {
      if (disposed || timer) return;
      timer = setTimeout(run, delay);
    }

    // Live updates: the database sends ONE tiny "changed" nudge per affected
    // room per write (migration 121 — statement-level Broadcast from Database),
    // instead of the old per-row Postgres Changes stream that delivered 20
    // messages to each of 20 phones for a single room-wide update. The nudge
    // carries no data; we re-pull public columns through the coalescer.
    const channel = supabase
      .channel(`room:${roomId}`)
      .on("broadcast", { event: "changed" }, () => {
        nudgesWork = true;
        schedule();
      })
      .subscribe((status) => {
        // Fires on first connect AND on every automatic re-subscribe after
        // the socket drops — so a client that briefly lost its connection
        // catches up on anything it missed while offline.
        if (status === "SUBSCRIBED") schedule(0);
        else nudgesWork = false; // CHANNEL_ERROR / TIMED_OUT / CLOSED
      });

    // Phones lock the screen and networks blip; either can silently stall
    // the realtime socket. Re-pull whenever the tab becomes visible again
    // or the network comes back, so the player never sits on stale state.
    function onWake() {
      if (document.visibilityState === "visible") schedule(0);
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
    // presses Proceed and the game never starts. Realtime stays the fast path;
    // this guarantees the screen never gets stuck waiting on it.
    // Goes through the coalescer too, so a slow backend can't make polls pile
    // up on top of each other (the old interval fired a fresh re-pull every 3s
    // even while the previous one was still waiting).
    // Adaptive: every 3s until a nudge proves live updates work, then every 6s
    // (the poll is only a backstop for a dropped nudge at that point).
    const poll = setInterval(() => {
      const every = nudgesWork ? POLL_MS_WITH_NUDGES : POLL_MS;
      if (Date.now() - lastPullAt >= every - 250) schedule(0);
    }, POLL_MS);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
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
  //
  // Re-fetched only when something that can change them changes: the phase /
  // day (resolutions deal roles, conversions, bombs, notices) or MY OWN public
  // row (my own actions/votes touch it). It used to re-run on every change to
  // ANY player — i.e. on every poll and every realtime event, on every phone —
  // which made it the single biggest source of load in a 20-player game. A slow
  // background refresh still picks up the rare mid-phase notice another
  // player's ability sends me (e.g. a Worshipper revealing themselves).
  const myRowKey = JSON.stringify(players.find((p) => p.id === myPlayerId) ?? null);
  const inRoom = myRowKey !== "null";
  useEffect(() => {
    if (!myPlayerId || !inRoom) {
      setMySecrets(EMPTY_SECRETS);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    async function fetchSecrets() {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data } = await supabase.rpc("get_my_secrets", {
          p_player_id: myPlayerId,
        });
        if (cancelled || !data) return;
        const s = data as Partial<MySecrets>;
        const next: MySecrets = {
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
        };
        setMySecrets((prev) => (sameJson(prev, next) ? prev : next));
      } catch {
        // transient — the next change / background refresh retries
      } finally {
        inFlight = false;
      }
    }
    fetchSecrets();
    const t = setInterval(fetchSecrets, SECRETS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [myPlayerId, inRoom, myRowKey, room?.phase, room?.day]);

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
    return (
      <Centered>
        <div className="w-full max-w-md">
          <LoadingScreen title="Entering the castle…" compact />
          {loadAttempts >= 2 && (
            <p className="mt-4 text-center text-sm text-cream/70">
              The connection is slow &mdash; still trying to reach the castle&hellip;
            </p>
          )}
        </div>
      </Centered>
    );
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
    // Dead players are omniscient spectators during the secret phases — they see
    // the dedicated spectator view instead of the normal phase screen.
    if (myPlayer?.dead && DEAD_SPECTATOR_PHASES.has(room.phase)) {
      return (
        <DeadSpectator room={room} players={displayPlayers} myPlayer={myPlayer} />
      );
    }
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
      case "wandering_soul_intro":
        return (
          <WanderingSoulIntro room={room} players={displayPlayers} myPlayer={myPlayer} />
        );
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
    case "store_summary":
      return (
        <StoreSummary room={room} players={displayPlayers} myPlayer={myPlayer} />
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
      case "soul_victory_intro":
        return (
          <SoulVictoryIntro room={room} players={displayPlayers} myPlayer={myPlayer} />
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
    <AnimationProvider>
      <TopBar room={room} players={displayPlayers} myPlayer={myPlayer} />
      {phaseScreen}
      <PhaseTransition room={room} />
      <AbilityOutcomeWatcher
        room={room}
        myPlayer={myPlayer}
        notices={mySecrets.notices}
      />
      <PlayerNotices notices={mySecrets.notices} />
      <RoleChangePopup role={mySecrets.role} />
    </AnimationProvider>
  );
}
