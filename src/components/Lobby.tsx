"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { startGame, kickPlayer, leaveRoom } from "@/lib/game";
import { setRoomVisibility, setRoomRanked } from "@/lib/room";
import { trackInviteSent, trackGameStarted } from "@/lib/analytics";
import { useBlockedIds } from "@/lib/blocks";
import { useReportedIds } from "@/lib/reports";
import { clearStoredPlayer } from "@/lib/player";
import { displayedName } from "@/lib/swaps";
import type { Room, Player } from "@/lib/types";
import { ShowcaseBadges } from "./ShowcaseBadges";
import { InviteToGame } from "./InviteToGame";

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
  const [visBusy, setVisBusy] = useState(false);
  const [rankedBusy, setRankedBusy] = useState(false);
  // Avatar URLs for account-linked players, keyed by their user_id.
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  // Featured badge ids for account-linked players, keyed by user_id.
  const [featuredByUser, setFeaturedByUser] = useState<
    Record<string, string[]>
  >({});

  const isHost = myPlayer?.is_host ?? false;
  const { isBlocked, block, unblock } = useBlockedIds(room.id);
  const { isReported, report } = useReportedIds(room.id);

  // Fetch profile photos for any players who have an account, so their
  // icon shows in the lobby. Guests have no user_id and just get an
  // initial. Re-runs when the set of account players changes.
  const accountIdsKey = players.map((p) => p.user_id ?? "").join(",");
  useEffect(() => {
    const ids = players
      .map((p) => p.user_id)
      .filter((x): x is string => !!x);
    if (ids.length === 0) {
      setAvatars({});
      setFeaturedByUser({});
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("id, avatar_url, featured_badges")
      .in("id", ids)
      .then(({ data }) => {
        if (!active) return;
        const av: Record<string, string | null> = {};
        const fb: Record<string, string[]> = {};
        for (const row of data ?? []) {
          av[row.id] = row.avatar_url;
          fb[row.id] = row.featured_badges ?? [];
        }
        setAvatars(av);
        setFeaturedByUser(fb);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIdsKey]);

  async function kick(playerId: string) {
    await kickPlayer(playerId);
  }

  async function leave() {
    if (!myPlayer) return;
    // leaveRoom promotes the next-oldest player to host if I'm the host.
    await leaveRoom(myPlayer.id);
    clearStoredPlayer();
    router.push("/");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      // Sharing the code is a room invite.
      trackInviteSent("room", room.id);
    } catch {
      // Clipboard can be blocked; ignore silently.
    }
  }

  // Host flips the lobby Public/Private. Realtime re-pushes room state to
  // everyone, so the button highlight + caption update on all clients.
  async function changeVisibility(isPublic: boolean) {
    if (isPublic === room.is_public || visBusy) return;
    setVisBusy(true);
    try {
      await setRoomVisibility(room.id, isPublic);
    } catch {
      // Open RLS makes this unlikely; if it fails, realtime keeps the old
      // state and the host can retry.
    } finally {
      setVisBusy(false);
    }
  }

  // Host flips the lobby Casual/Ranked. In a ranked game, account players'
  // ladder rank moves on win/loss (the dedicated ranked queue will set this
  // automatically later).
  async function changeRanked(isRanked: boolean) {
    if (isRanked === room.is_ranked || rankedBusy) return;
    setRankedBusy(true);
    try {
      await setRoomRanked(room.id, isRanked);
    } catch {
      // Realtime keeps the old state; the host can retry.
    } finally {
      setRankedBusy(false);
    }
  }

  async function handleStartGame() {
    setStarting(true);
    setStartError(null);
    try {
      await startGame(
        room.id,
        players.map((p) => p.id)
      );
      // One game_started per game — only the host has this button.
      trackGameStarted({
        gameId: room.id,
        playerCount: players.length,
        isPublic: room.is_public,
      });
    } catch (e) {
      setStartError(
        e instanceof Error ? e.message : "Could not start the game."
      );
      setStarting(false);
    }
  }

  return (
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-6 py-10 text-cream">
      <div className="w-full max-w-4xl">
        {/* Header: logo + room code (full width, centered). */}
        <div className="flex flex-col items-center">
          {/* Plain <img> — Next's optimiser left a checker pattern on this
              transparent PNG. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png?v=3"
            alt="Vice and Virtue"
            width={1254}
            height={1254}
            className="h-auto w-24 drop-shadow-xl sm:w-28"
          />
          <h1 className="mt-1 text-center text-sm uppercase tracking-widest text-gold">
            Lobby
          </h1>
          <button
            onClick={copyCode}
            className="mt-3 flex w-full max-w-sm flex-col items-center rounded-xl border border-gold bg-cream py-4 text-home-bg transition-opacity hover:opacity-90"
          >
            <span className="text-4xl font-semibold tracking-[0.3em]">
              {code}
            </span>
            <span className="mt-1 text-xs text-home-bg/60">
              {copied ? "Copied!" : "Tap to copy and share"}
            </span>
          </button>

          {/* Invite a specific friend to this game (logged-in players). */}
          {myPlayer?.user_id && (
            <div className="mt-3 w-full max-w-sm">
              <InviteToGame roomId={room.id} myUserId={myPlayer.user_id} />
            </div>
          )}
        </div>

        {/* Body: players (wide) + host controls (side) on desktop; stacks
            on mobile (players above controls, as before). */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_19rem] lg:items-start">
          {/* Players */}
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-sm uppercase tracking-widest text-gold">
                Players
              </h2>
              <span className="text-sm text-cream/60">{players.length}</span>
            </div>

            <ul className="mt-2 flex flex-col gap-2">
          {players.map((player) => {
            const isMe = player.id === myPlayer?.id;
            const avatarUrl = player.user_id ? avatars[player.user_id] : null;
            return (
              <li
                key={player.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-cream px-3 py-2.5 text-home-bg"
              >
                {/* Identity: avatar + name + host + badges. min-w-0 lets the
                    name truncate so host/badges never get pushed off / clip. */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-home-bg text-sm font-bold text-cream">
                      {player.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 truncate font-medium">
                    {displayedName(player, room, players, myPlayer?.id)}
                    {isMe && (
                      <span className="ml-1.5 text-xs font-normal text-home-bg/50">
                        (you)
                      </span>
                    )}
                  </span>
                  {player.is_host && (
                    <span className="shrink-0 rounded bg-gold px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-home-bg">
                      Host
                    </span>
                  )}
                  {player.user_id && (
                    <span className="flex shrink-0">
                      <ShowcaseBadges
                        ids={featuredByUser[player.user_id]}
                        sizeClass="h-7 w-7"
                      />
                    </span>
                  )}
                </div>

                {/* Actions: wrap to a second line on very narrow rows. */}
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {!isMe &&
                    myPlayer &&
                    (isReported(player.id) ? (
                      <span className="rounded border border-home-bg/20 px-2 py-0.5 text-xs font-medium text-home-bg/40">
                        Reported
                      </span>
                    ) : (
                      <button
                        onClick={() => report(myPlayer.id, player.id)}
                        title={`Report ${player.name}`}
                        className="rounded border border-home-bg/40 px-2 py-0.5 text-xs font-medium text-home-bg/70 hover:bg-home-bg hover:text-cream"
                      >
                        Report
                      </button>
                    ))}
                  {!isMe &&
                    (isBlocked(player.id) ? (
                      <button
                        onClick={() => unblock(player.id)}
                        className="rounded border border-home-bg/40 px-2 py-0.5 text-xs font-medium text-home-bg/70 hover:bg-home-bg hover:text-cream"
                      >
                        Unblock
                      </button>
                    ) : (
                      <button
                        onClick={() => block(player.id)}
                        title={`Block ${player.name}`}
                        className="rounded border border-home-bg/40 px-2 py-0.5 text-xs font-medium text-home-bg/70 hover:bg-home-bg hover:text-cream"
                      >
                        Block
                      </button>
                    ))}
                  {isHost && !isMe && (
                    <button
                      onClick={() => kick(player.id)}
                      title={`Kick ${player.name}`}
                      className="rounded border border-red-700/40 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-700 hover:text-cream"
                    >
                      Kick
                    </button>
                  )}
                  {/* Anyone can leave — including the host, who hands off to
                      the next-oldest player. */}
                  {isMe && (
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
          </section>

          {/* Host controls (side panel on desktop) / waiting state. */}
          <section>
            {isHost ? (
              <div className="flex flex-col gap-3 rounded-xl border border-gold/40 bg-home-bg/40 p-4">
                {/* Public / Private visibility toggle. */}
            <span className="text-sm uppercase tracking-widest text-gold">
              Visibility
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => changeVisibility(false)}
                disabled={visBusy}
                aria-pressed={!room.is_public}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  !room.is_public
                    ? "border-gold bg-gold text-home-bg"
                    : "border-gold/40 text-cream hover:bg-cream/10"
                }`}
              >
                Private
              </button>
              <button
                onClick={() => changeVisibility(true)}
                disabled={visBusy}
                aria-pressed={room.is_public}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  room.is_public
                    ? "border-gold bg-gold text-home-bg"
                    : "border-gold/40 text-cream hover:bg-cream/10"
                }`}
              >
                Public
              </button>
            </div>
            <p className="text-center text-xs text-cream/50">
              {room.is_public
                ? "Anyone can find this game with Find Public Session. Friends can still join with the code."
                : "Only players with the code can join."}
            </p>

            <span className="mt-1 text-sm uppercase tracking-widest text-gold">
              Mode
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => changeRanked(false)}
                disabled={rankedBusy}
                aria-pressed={!room.is_ranked}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  !room.is_ranked
                    ? "border-gold bg-gold text-home-bg"
                    : "border-gold/40 text-cream hover:bg-cream/10"
                }`}
              >
                Casual
              </button>
              <button
                onClick={() => changeRanked(true)}
                disabled={rankedBusy}
                aria-pressed={room.is_ranked}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  room.is_ranked
                    ? "border-gold bg-gold text-home-bg"
                    : "border-gold/40 text-cream hover:bg-cream/10"
                }`}
              >
                Ranked
              </button>
            </div>
            <p className="text-center text-xs text-cream/50">
              {room.is_ranked
                ? "Ranked: account players' ladder rank moves on win/loss."
                : "Casual: no effect on ladder rank."}
            </p>

            <button
              onClick={handleStartGame}
              disabled={starting}
              className="mt-2 rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {starting ? "Starting…" : "Start game"}
            </button>
            <p className="text-center text-xs text-cream/50">
              Best with 6 or more players.
            </p>

            {startError && (
              <p className="text-center text-sm text-red-300">{startError}</p>
            )}
          </div>
            ) : (
              <div className="rounded-xl border border-gold/30 bg-home-bg/40 p-4 text-center">
                <p className="text-sm font-semibold text-cream/80">
                  {room.is_public ? "Public game" : "Private game"}
                  {room.is_ranked ? " · Ranked" : ""}
                </p>
                <p className="mt-1 text-sm text-cream/60">
                  Waiting for the host to start the game&hellip;
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
