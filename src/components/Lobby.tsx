"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { startGame, kickPlayer } from "@/lib/game";
import { clearStoredPlayer } from "@/lib/player";
import { displayedName } from "@/lib/swaps";
import type { Room, Player } from "@/lib/types";
import { ShowcaseBadges } from "./ShowcaseBadges";

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
  // Avatar URLs for account-linked players, keyed by their user_id.
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  // Featured badge ids for account-linked players, keyed by user_id.
  const [featuredByUser, setFeaturedByUser] = useState<
    Record<string, string[]>
  >({});

  const isHost = myPlayer?.is_host ?? false;

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
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-6 py-12 text-cream">
      <div className="w-full max-w-sm">
        {/* Use a plain <img> here — Next.js's image optimiser was
            re-rendering the transparent PNG with a visible checker
            pattern. Raw <img> serves the file untouched. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png?v=3"
          alt="Vice and Virtue"
          width={1254}
          height={1254}
          className="mx-auto h-auto w-40 drop-shadow-xl"
        />
        <h1 className="mt-1 text-center text-sm uppercase tracking-widest text-gold">
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
            const avatarUrl = player.user_id ? avatars[player.user_id] : null;
            return (
              <li
                key={player.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-gold/40 bg-cream px-4 py-3 text-home-bg"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
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
                  <span className="min-w-0 truncate">
                    {displayedName(player, room, players, myPlayer?.id)}
                    {isMe && (
                      <span className="ml-2 text-xs text-home-bg/50">
                        (you)
                      </span>
                    )}
                  </span>
                  {player.user_id && (
                    <ShowcaseBadges
                      ids={featuredByUser[player.user_id]}
                      sizeClass="h-9 w-9"
                    />
                  )}
                </div>
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
          <div className="mt-8 flex flex-col gap-2">
            <button
              onClick={handleStartGame}
              disabled={starting}
              className="rounded-lg bg-gold px-4 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
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
          <p className="mt-8 text-center text-sm text-cream/60">
            Waiting for the host to start the game&hellip;
          </p>
        )}
      </div>
    </main>
  );
}
