"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROLES } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { createRoom, joinRoom } from "@/lib/room";
import { setStoredPlayerId, setStoredPlayerName } from "@/lib/player";
import { checkWinner } from "@/lib/winConditions";
import { useAuth } from "@/lib/useAuth";
import { getNewlyEarnedBadges } from "@/lib/achievements";
import { BadgeTile } from "@/components/BadgesShowcase";
import { RoleIcon } from "@/components/RoleIcon";
import { ShowcaseBadges } from "@/components/ShowcaseBadges";
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
  const router = useRouter();
  const [newBadges, setNewBadges] = useState<BadgeDef[]>([]);
  const [requeuing, setRequeuing] = useState(false);
  const [requeError, setRequeError] = useState<string | null>(null);

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

  // All roles, revealed by the server now that the game has ended.
  const [rolesById, setRolesById] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("reveal_all_roles", { p_room_id: room.id })
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return;
        const map: Record<string, string | null> = {};
        for (const r of data as { player_id: string; role: string | null }[]) {
          map[r.player_id] = r.role;
        }
        setRolesById(map);
      });
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  // Featured badges for account players, shown next to their name.
  const [featuredByUser, setFeaturedByUser] = useState<
    Record<string, string[]>
  >({});
  const accountIdsKey = players.map((p) => p.user_id ?? "").join(",");
  useEffect(() => {
    const ids = players
      .map((p) => p.user_id)
      .filter((x): x is string => !!x);
    if (ids.length === 0) {
      setFeaturedByUser({});
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("id, featured_badges")
      .in("id", ids)
      .then(({ data }) => {
        if (!active) return;
        const fb: Record<string, string[]> = {};
        for (const row of data ?? []) fb[row.id] = row.featured_badges ?? [];
        setFeaturedByUser(fb);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIdsKey]);

  // Re-queue: gather everyone who taps it into a fresh lobby. The first
  // person to tap spins up the new room (creating a room needs an account)
  // and records its code on this finished room (next_room_code); everyone
  // else who taps joins that same lobby.
  async function reque() {
    if (!myPlayer || requeuing) return;
    setRequeuing(true);
    setRequeError(null);
    try {
      // Did someone already start the re-queue lobby?
      const { data: latest } = await supabase
        .from("rooms")
        .select("next_room_code")
        .eq("id", room.id)
        .maybeSingle();
      let code =
        (latest as { next_room_code: string | null } | null)?.next_room_code ??
        null;

      if (!code) {
        if (!myPlayer.user_id) {
          setRequeError("Waiting for a logged-in player to start the re-queue.");
          return;
        }
        const created = await createRoom(myPlayer.name, myPlayer.user_id);
        // Claim the slot only if it's still empty, so simultaneous taps all
        // converge on one lobby.
        await supabase
          .from("rooms")
          .update({ next_room_code: created.room.code })
          .eq("id", room.id)
          .is("next_room_code", null);
        const { data: after } = await supabase
          .from("rooms")
          .select("next_room_code")
          .eq("id", room.id)
          .maybeSingle();
        const winner =
          (after as { next_room_code: string | null } | null)?.next_room_code ??
          created.room.code;
        if (winner === created.room.code) {
          // I'm the host of the new lobby.
          setStoredPlayerName(myPlayer.name);
          setStoredPlayerId(created.player.id);
          router.push(`/room/${created.room.code}`);
          return;
        }
        // A simultaneous tap won the slot — join that lobby instead (my room
        // is orphaned and removed by the nightly cleanup).
        code = winner;
      }

      const joined = await joinRoom(code, myPlayer.name, myPlayer.user_id);
      setStoredPlayerName(myPlayer.name);
      setStoredPlayerId(joined.player.id);
      router.push(`/room/${joined.room.code}`);
    } catch (e) {
      setRequeError(e instanceof Error ? e.message : "Could not re-queue.");
    } finally {
      setRequeuing(false);
    }
  }

  const enrichedPlayers = players.map((p) => ({
    ...p,
    role: rolesById[p.id] ?? null,
  }));
  const winner = checkWinner(enrichedPlayers);
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
            const roleId = rolesById[player.id];
            const role = roleId ? ROLES[roleId] : undefined;
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
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 truncate">
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
                    {player.in_hospital &&
                      !player.dead &&
                      !player.in_prison && (
                        <span className="ml-2 text-xs text-home-bg/50">
                          (hospital)
                        </span>
                      )}
                  </span>
                  {player.user_id && (
                    <ShowcaseBadges
                      ids={featuredByUser[player.user_id]}
                      sizeClass="h-9 w-9"
                    />
                  )}
                </span>
                <span className="flex items-center gap-2 text-sm text-home-bg/80">
                  {roleId && role && (
                    <RoleIcon
                      roleId={roleId}
                      camp={role.camp}
                      className="h-7 w-7"
                    />
                  )}
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

        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            onClick={reque}
            disabled={requeuing}
            className="rounded-lg bg-gold px-8 py-3 font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {requeuing
              ? "Starting…"
              : room.next_room_code
                ? "Join the re-queue"
                : "Play again with this group"}
          </button>
          {room.next_room_code && !requeuing && (
            <p className="text-xs text-cream/55">
              Someone started a new lobby — tap to join them.
            </p>
          )}
          {requeError && <p className="text-sm text-red-300">{requeError}</p>}
          <Link
            href="/"
            className="text-sm text-cream/70 underline hover:text-cream"
          >
            Back to start
          </Link>
        </div>
      </div>
    </main>
  );
}
