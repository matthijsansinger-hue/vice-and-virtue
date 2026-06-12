"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, MotionConfig, type Variants } from "framer-motion";
import { heading, fadeUp } from "@/components/ui/royal";
import { ROLES } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { createRoom, joinRoom } from "@/lib/room";
import { setStoredPlayerId, setStoredPlayerName } from "@/lib/player";
import { checkWinner } from "@/lib/winConditions";
import { useAuth } from "@/lib/useAuth";
import { trackGameCompleted } from "@/lib/analytics";
import { getNewlyEarnedBadges } from "@/lib/achievements";
import { BadgeTile } from "@/components/BadgesShowcase";
import { RoleIcon } from "@/components/RoleIcon";
import { ShowcaseBadges } from "@/components/ShowcaseBadges";
import type { BadgeDef } from "@/lib/badges";
import type { Player, Room } from "@/lib/types";

// Quick cascade for the revealed-roles grid.
const rolesGridContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.2 } },
};

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

  // game_completed: fire once per game, from the host (who always reaches
  // this screen by advancing the victory intro). A localStorage flag keyed
  // by room id stops a refresh on the game-over screen from re-counting.
  useEffect(() => {
    if (!myPlayer?.is_host) return;
    const key = `vv_analytics_completed_${room.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // localStorage blocked — still fire (once per mount is acceptable).
    }
    trackGameCompleted({
      gameId: room.id,
      playerCount: players.length,
      isPublic: room.is_public,
      day: room.day,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPlayer?.is_host, room.id]);

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

  // Who killed who, revealed now the game has ended (gated server-side).
  const [killLog, setKillLog] = useState<
    { killer: string | null; victim: string; day: number }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_kill_log", { p_room_id: room.id }).then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      setKillLog(
        data as { killer: string | null; victim: string; day: number }[]
      );
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
  // Match the victory intro's solid base colour exactly, so when that screen
  // hands off to this one the backdrop never flashes through to the brown
  // home-bg before the (cached) image repaints.
  const baseColor =
    winner === "virtue" ? "#2a3f5e" : winner === "vice" ? "#3a2618" : undefined;
  // Same camp vignette as the victory intro for a seamless continuation.
  const vignette =
    winner === "virtue"
      ? "radial-gradient(ellipse at center, rgba(227,181,16,.22) 0%, transparent 55%)"
      : winner === "vice"
        ? "radial-gradient(ellipse at center, transparent 35%, rgba(128,0,32,.55) 100%)"
        : null;

  return (
    <MotionConfig reducedMotion="user">
    {/* Viewport-pinned background. Painting it on the (tall, scrolling)
        <main> made bg-cover rescale to the full content height, so handing
        off from the victory intro — where the same image is one viewport —
        visibly jumped/flashed. A fixed, viewport-sized layer keeps the exact
        framing of the victory screen, so the swap is seamless. */}
    {bgImage && (
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url('${bgImage}')`, backgroundColor: baseColor }}
        />
        <div className="absolute inset-0 bg-black/55" />
        {vignette && (
          <div className="absolute inset-0" style={{ background: vignette }} />
        )}
      </div>
    )}
    <main
      className={
        "relative z-10 flex min-h-screen flex-col items-center px-6 py-12 text-cream " +
        (bgImage ? "" : "bg-home-bg")
      }
    >
      <motion.div
        className="relative w-full max-w-4xl"
        initial="hidden"
        animate="show"
        variants={fadeUp}
      >
        {/* Banner + new badges stay centered; the roles list below goes
            full-width as a grid. */}
        <div className="mx-auto max-w-lg">
        <h1 className={`text-center text-base uppercase tracking-[0.3em] text-gold ${heading}`}>
          Game over
        </h1>

        {winner === "virtue" || winner === "vice" ? (
          // Illustrated camp banner (transparent PNG) over the victory
          // background. Plain <img> to avoid Next/Image's checker artefact
          // on transparent PNGs.
          <motion.div
            initial={{ opacity: 0, scale: 0.82, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 80, damping: 18, delay: 0.15 }}
            className="relative mt-4 flex flex-col items-center"
          >
            {/* Camp-tinted backing glow so the emblem crowns the scene — the
                same warm gold / blood red as the matching victory intro. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-56 scale-125"
              style={{
                background:
                  winner === "virtue"
                    ? "radial-gradient(ellipse, rgba(227,181,16,.5) 0%, transparent 70%)"
                    : "radial-gradient(ellipse, rgba(150,10,40,.55) 0%, transparent 70%)",
                filter: "blur(20px)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                winner === "virtue"
                  ? "/virtues-win-text.png"
                  : "/vices-win-text.png"
              }
              alt={winnerLabel}
              className="relative h-auto w-full max-w-md drop-shadow-2xl"
            />
            {myOutcome && (
              <p
                className={`relative mt-2 text-3xl font-bold ${heading} ${
                  myOutcome === "win" ? "text-gold" : "text-cream/85"
                }`}
                style={
                  myOutcome === "win"
                    ? { textShadow: "0 0 18px rgba(227,181,16,.65)" }
                    : undefined
                }
              >
                {myOutcome === "win" ? "You won!" : "You lost."}
              </p>
            )}
          </motion.div>
        ) : (
          <div
            className={
              "mt-4 rounded-xl border-2 border-gold p-6 text-center " +
              bannerClass
            }
          >
            <p className={`text-3xl font-bold ${heading}`}>{winnerLabel}</p>
            {myOutcome && (
              <p className="mt-2 text-sm opacity-80">
                {myOutcome === "win" ? "You won!" : "You lost."}
              </p>
            )}
          </div>
        )}

        {newBadges.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="glow-gold-pulse mt-6 rounded-xl border-2 border-gold/60 bg-home-bg/80 p-4"
          >
            <h2 className={`text-center text-sm uppercase tracking-widest text-gold ${heading}`}>
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
          </motion.div>
        )}
        </div>

        <h2 className={`mt-8 text-center text-base uppercase tracking-[0.3em] text-gold ${heading}`}>
          Roles revealed
        </h2>
        <motion.ul
          variants={rolesGridContainer}
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        >
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
            // Camp-tinted card: a faint burgundy / navy edge wash so the two
            // sides read at a glance on the reveal.
            const cardStyle = role
              ? role.camp === "vice"
                ? { background: "linear-gradient(170deg, #fff2ec 0%, #f3e0d6 100%)" }
                : { background: "linear-gradient(170deg, #eef1ff 0%, #dfe2f3 100%)" }
              : { background: "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" };
            return (
              <motion.li
                key={player.id}
                variants={fadeUp}
                className={
                  "flex flex-col gap-1.5 rounded-xl px-3 py-2.5 text-home-bg shadow-[0_3px_10px_rgba(0,0,0,.3)] " +
                  (isMe
                    ? "border-2 border-gold shadow-[0_3px_10px_rgba(0,0,0,.3),0_0_12px_rgba(227,181,16,.4)]"
                    : "border border-gold/40")
                }
                style={cardStyle}
              >
                {/* Name + status + featured badges */}
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{player.name}</span>
                    {isMe && (
                      <span className="ml-1.5 text-xs text-home-bg/50">(you)</span>
                    )}
                    {player.dead && (
                      <span className="ml-1.5 text-xs text-home-bg/50">(dead)</span>
                    )}
                    {player.in_prison && !player.dead && (
                      <span className="ml-1.5 text-xs text-home-bg/50">
                        (prison)
                      </span>
                    )}
                    {player.in_hospital &&
                      !player.dead &&
                      !player.in_prison && (
                        <span className="ml-1.5 text-xs text-home-bg/50">
                          (hospital)
                        </span>
                      )}
                  </span>
                  {player.user_id && (
                    <span className="flex shrink-0">
                      <ShowcaseBadges
                        ids={featuredByUser[player.user_id]}
                        sizeClass="h-7 w-7"
                      />
                    </span>
                  )}
                </div>
                {/* Role + camp */}
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-home-bg/80">
                    {roleId && role && (
                      <RoleIcon
                        roleId={roleId}
                        camp={role.camp}
                        className="h-7 w-7 shrink-0"
                      />
                    )}
                    <span className="truncate">{role?.name ?? "—"}</span>
                  </span>
                  <span
                    className={
                      "shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase " +
                      campClass
                    }
                  >
                    {campLabel}
                  </span>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>

        {/* Who killed who — the full toll of the game, attributed. */}
        {killLog.length > 0 && (
          <div className="mx-auto mt-8 max-w-lg">
            <h2 className={`text-center text-base uppercase tracking-[0.3em] text-gold ${heading}`}>
              The fallen
            </h2>
            <ul className="mt-3 flex flex-col gap-2">
              {killLog.map((k, i) => {
                const victim = players.find((p) => p.id === k.victim);
                if (!victim) return null;
                const killer = k.killer
                  ? players.find((p) => p.id === k.killer) ?? null
                  : null;
                const selfSac = !!k.killer && k.killer === k.victim;
                return (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-xl border-2 border-[#b3445c]/50 px-3 py-2.5 text-cream shadow-[0_3px_10px_rgba(0,0,0,.3)]"
                    style={{
                      background:
                        "linear-gradient(165deg, rgba(128,0,32,.4) 0%, rgba(24,6,10,.9) 75%)",
                    }}
                  >
                    <span
                      className={`shrink-0 rounded bg-black/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cream/70 ${heading}`}
                    >
                      Day {k.day}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      {selfSac ? (
                        <>
                          <span className="font-semibold">{victim.name}</span>{" "}
                          <span className="text-cream/75">sacrificed themselves</span>
                        </>
                      ) : killer ? (
                        <>
                          <span className="font-semibold">{killer.name}</span>{" "}
                          <span className="text-red-200">killed</span>{" "}
                          <span className="font-semibold">{victim.name}</span>
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">{victim.name}</span>{" "}
                          <span className="text-red-200">was killed</span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-3">
          <motion.button
            onClick={reque}
            disabled={requeuing}
            whileHover={requeuing ? undefined : { scale: 1.02 }}
            whileTap={requeuing ? undefined : { scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
            className={`rounded-xl bg-gold px-8 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 ${heading}`}
          >
            {requeuing
              ? "Starting…"
              : room.next_room_code
                ? "Join the re-queue"
                : "Play again with this group"}
          </motion.button>
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
      </motion.div>
    </main>
    </MotionConfig>
  );
}
