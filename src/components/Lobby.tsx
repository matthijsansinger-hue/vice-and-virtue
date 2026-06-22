"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { IconCrown, IconCheck, IconHourglassHigh } from "@tabler/icons-react";
import {
  heading,
  staggerContainer,
  fadeUp,
  CornerFrame,
  plaqueStyle,
  PlaqueLayers,
  SlidingToggle,
} from "@/components/ui/royal";
import { supabase } from "@/lib/supabase";
import { startGame, kickPlayer, leaveRoom } from "@/lib/game";
import {
  setRoomVisibility,
  setRoleAssignMode,
  expireStaleLobbies,
  LOBBY_EXPIRY_MINUTES,
} from "@/lib/room";
import { trackInviteSent, trackGameStarted } from "@/lib/analytics";
import { useBlockedIds } from "@/lib/blocks";
import { useReportedIds } from "@/lib/reports";
import { clearStoredPlayer } from "@/lib/player";
import { displayedName } from "@/lib/swaps";
import { bannerBg, nameColorStyle, bannerTextLight } from "@/lib/levelColors";
import { getAccountLevels } from "@/lib/economy";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { normalizeCharacter, type CharacterConfig } from "@/lib/character";
import { LevelStar } from "./LevelStar";
import type { Room, Player } from "@/lib/types";
import { ShowcaseBadges } from "./ShowcaseBadges";
import { InviteToGame } from "./InviteToGame";
import { RoleConfigModal } from "./RoleConfigModal";

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
  const [modeBusy, setModeBusy] = useState(false);
  const [showRoleConfig, setShowRoleConfig] = useState(false);
  // Customized characters for account-linked players, keyed by their user_id.
  const [characters, setCharacters] = useState<Record<string, CharacterConfig | null>>({});
  // Featured badge ids for account-linked players, keyed by user_id.
  const [featuredByUser, setFeaturedByUser] = useState<
    Record<string, string[]>
  >({});
  // Equipped name/banner color tiers for account-linked players, by user_id.
  const [colorsByUser, setColorsByUser] = useState<
    Record<string, { name: string | null; banner: string | null }>
  >({});
  // Account level per account-linked player, by user_id (for the level star).
  const [levelsByUser, setLevelsByUser] = useState<Record<string, number>>({});

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
      setCharacters({});
      setFeaturedByUser({});
      setColorsByUser({});
      setLevelsByUser({});
      return;
    }
    let active = true;
    supabase
      .from("profiles")
      .select("id, appearance, featured_badges, name_color, banner_color")
      .in("id", ids)
      .then(({ data }) => {
        if (!active) return;
        const ch: Record<string, CharacterConfig | null> = {};
        const fb: Record<string, string[]> = {};
        const cl: Record<string, { name: string | null; banner: string | null }> = {};
        for (const row of data ?? []) {
          ch[row.id] = row.appearance ? normalizeCharacter(row.appearance) : null;
          fb[row.id] = row.featured_badges ?? [];
          cl[row.id] = { name: row.name_color ?? null, banner: row.banner_color ?? null };
        }
        setCharacters(ch);
        setFeaturedByUser(fb);
        setColorsByUser(cl);
      });
    getAccountLevels(ids).then((m) => {
      if (active) setLevelsByUser(Object.fromEntries(m));
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

  // Host flips between the two role-assignment modes; realtime updates
  // everyone's lobby (mirrors the visibility toggle).
  async function changeAssignMode(mode: "choose" | "random") {
    if (mode === room.role_assign_mode || modeBusy) return;
    setModeBusy(true);
    try {
      await setRoleAssignMode(room.id, mode);
    } catch {
      // Open RLS makes this unlikely; realtime keeps the old state on failure.
    } finally {
      setModeBusy(false);
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

  // Lobby lifetime: if the host doesn't start within LOBBY_EXPIRY_MINUTES of
  // the room being created, the room is deleted and everyone is sent back to
  // the start screen (the room page handles that redirect once the room is
  // gone). Show a live countdown so players — and an AFK host — see it coming,
  // and trigger the cleanup ourselves the instant it elapses instead of
  // waiting on the every-minute server janitor.
  const expiresAtMs =
    new Date(room.created_at).getTime() + LOBBY_EXPIRY_MINUTES * 60_000;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remainingMs = Math.max(0, expiresAtMs - nowMs);

  const expireFired = useRef(false);
  useEffect(() => {
    if (remainingMs > 0 || expireFired.current) return;
    expireFired.current = true;
    // Best-effort: the every-minute cron janitor is the backstop, and the room
    // page still redirects everyone once the room is actually gone.
    expireStaleLobbies().catch(() => {});
  }, [remainingMs]);

  const mm = Math.floor(remainingMs / 60_000);
  const ss = Math.floor((remainingMs % 60_000) / 1000);
  const countdown = `${mm}:${ss.toString().padStart(2, "0")}`;
  const closingSoon = remainingMs <= 60_000;

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen flex min-h-screen flex-col items-center bg-home-bg px-4 py-10 text-cream sm:px-6">
      <motion.div
        className="w-full max-w-4xl"
        initial="hidden"
        animate="show"
        variants={staggerContainer}
      >
        {/* Header: logo + room code (full width, centered). */}
        <motion.div variants={fadeUp} className="flex flex-col items-center">
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
          <h1
            className={`mt-1 text-center text-base uppercase tracking-[0.35em] text-gold ${heading}`}
          >
            Lobby
          </h1>
          {/* Room code — a gilded plaque, the hero of the screen. */}
          <motion.button
            onClick={copyCode}
            whileHover={{ y: -3, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
            className="group relative mt-4 flex w-full max-w-sm flex-col items-center overflow-hidden rounded-xl border-2 border-gold/65 px-6 py-5"
            style={plaqueStyle(true)}
          >
            <PlaqueLayers shine />
            <CornerFrame accent />
            <span className="relative text-[11px] uppercase tracking-widest text-cream/60">
              Room code
            </span>
            <span
              className={`relative mt-1 text-4xl font-bold tracking-[0.3em] text-gold ${heading}`}
              style={{ textShadow: "0 0 18px rgba(227,181,16,.35)" }}
            >
              {code}
            </span>
            <span className="relative mt-1.5 flex items-center gap-1 text-xs text-cream/60">
              {copied ? (
                <>
                  <IconCheck size={14} className="text-gold" aria-hidden />
                  <span className="font-semibold text-gold">Copied!</span>
                </>
              ) : (
                "Tap to copy and share"
              )}
            </span>
          </motion.button>

          {/* Auto-close countdown: the lobby is removed if it isn't started in
              time, so an AFK host can't leave it lingering for matchmaking. */}
          <span
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-center text-xs ${
              closingSoon
                ? "urgent-pulse border-red-400/70 bg-black/30 font-semibold text-red-200"
                : "border-cream/20 bg-black/20 text-cream/55"
            }`}
          >
            <IconHourglassHigh size={13} aria-hidden />
            {remainingMs > 0 ? (
              <>Closes in {countdown} if the game hasn&rsquo;t started</>
            ) : (
              <>Closing this lobby&hellip;</>
            )}
          </span>

          {/* Invite a specific friend to this game (logged-in players). */}
          {myPlayer?.user_id && (
            <div className="mt-3 w-full max-w-sm">
              <InviteToGame roomId={room.id} myUserId={myPlayer.user_id} />
            </div>
          )}
        </motion.div>

        {/* Body: players (wide) + host controls (side) on desktop; stacks
            on mobile (players above controls, as before). */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_19rem] lg:items-start">
          {/* Players */}
          <motion.section variants={fadeUp}>
            <div className="flex items-center justify-between">
              <h2 className={`text-sm uppercase tracking-widest text-gold ${heading}`}>
                Players
              </h2>
              <span className="rounded-full border border-gold/40 bg-black/25 px-2.5 py-0.5 text-xs font-semibold text-gold">
                {players.length}
              </span>
            </div>

            <ul className="mt-3 flex flex-col gap-2">
          <AnimatePresence initial={false}>
          {players.map((player) => {
            const isMe = player.id === myPlayer?.id;
            const character = player.user_id ? characters[player.user_id] : null;
            // Earned banner/name colors (account players only). A dark banner
            // flips the row's text + action buttons to a light scheme.
            const colors = player.user_id ? colorsByUser[player.user_id] : undefined;
            const bg = colors ? bannerBg(colors.banner) : null;
            // A dark banner flips the row to a light text scheme; a light banner
            // (yellow/white) keeps the dark parchment scheme.
            const lightText = bg ? bannerTextLight(colors?.banner) : false;
            const nameStyle = nameColorStyle(colors?.name);
            const actBtn = lightText
              ? "rounded border border-cream/40 px-2 py-0.5 text-xs font-medium text-cream/80 hover:bg-cream hover:text-home-bg"
              : "rounded border border-home-bg/40 px-2 py-0.5 text-xs font-medium text-home-bg/70 hover:bg-home-bg hover:text-cream";
            return (
              <motion.li
                key={player.id}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className={
                  "relative flex flex-wrap items-center gap-2 rounded-xl border border-gold/60 px-3 py-2.5 shadow-[0_3px_10px_rgba(0,0,0,.3)] " +
                  (lightText ? "text-cream" : "text-home-bg")
                }
                style={{ background: bg ?? "linear-gradient(170deg, #fff6d8 0%, #f3e2ae 100%)" }}
              >
                {/* Account level, in a 9-pointed star at the row's top-right. */}
                {player.user_id && levelsByUser[player.user_id] != null && (
                  <span className="absolute -right-1.5 -top-2.5 z-10">
                    <LevelStar level={levelsByUser[player.user_id]} size={26} />
                  </span>
                )}
                {/* Identity: avatar + name + host + badges. min-w-0 lets the
                    name truncate so host/badges never get pushed off / clip. */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <CharacterAvatar
                    character={character}
                    initials={player.name.charAt(0).toUpperCase()}
                    className="h-8 w-8 ring-2 ring-gold/60"
                    textClass="text-sm"
                  />
                  <span className="min-w-0 truncate font-semibold" style={nameStyle}>
                    {displayedName(player, room, players, myPlayer?.id)}
                    {isMe && (
                      <span
                        className={"ml-1.5 text-xs font-normal " + (lightText ? "text-cream/55" : "text-home-bg/50")}
                        style={{ fontFamily: "var(--font-geist-sans), sans-serif", textShadow: "none" }}
                      >
                        (you)
                      </span>
                    )}
                  </span>
                  {player.is_host && (
                    <span className="flex shrink-0 items-center gap-1 rounded bg-gold px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-home-bg shadow-[0_0_8px_rgba(227,181,16,.45)]">
                      <IconCrown size={11} aria-hidden /> Host
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
                      <span className={"rounded border px-2 py-0.5 text-xs font-medium " + (lightText ? "border-cream/20 text-cream/40" : "border-home-bg/20 text-home-bg/40")}>
                        Reported
                      </span>
                    ) : (
                      <button
                        onClick={() => report(myPlayer.id, player.id)}
                        title={`Report ${player.name}`}
                        className={actBtn}
                      >
                        Report
                      </button>
                    ))}
                  {!isMe &&
                    (isBlocked(player.id) ? (
                      <button
                        onClick={() => unblock(player.id)}
                        className={actBtn}
                      >
                        Unblock
                      </button>
                    ) : (
                      <button
                        onClick={() => block(player.id)}
                        title={`Block ${player.name}`}
                        className={actBtn}
                      >
                        Block
                      </button>
                    ))}
                  {isHost && !isMe && (
                    <button
                      onClick={() => kick(player.id)}
                      title={`Kick ${player.name}`}
                      className={"rounded border px-2 py-0.5 text-xs font-medium " + (lightText ? "border-red-400/50 text-red-300 hover:bg-red-600 hover:text-cream" : "border-red-700/40 text-red-700 hover:bg-red-700 hover:text-cream")}
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
              </motion.li>
            );
          })}
          </AnimatePresence>
        </ul>

            {!myPlayer && (
              <p className="mt-4 text-center text-sm text-cream/60">
                You are viewing this lobby but have not joined it.
              </p>
            )}
          </motion.section>

          {/* Host controls (side panel on desktop) / waiting state. */}
          <motion.section variants={fadeUp}>
            {isHost ? (
              <div
                className="relative overflow-hidden rounded-xl border-2 border-gold/40 p-4"
                style={plaqueStyle()}
              >
                <PlaqueLayers />
                <CornerFrame />
                <div className="relative flex flex-col gap-3">
                  {/* Public / Private visibility toggle. */}
                  <span className={`text-sm uppercase tracking-widest text-gold ${heading}`}>
                    Visibility
                  </span>
                  <SlidingToggle
                    layoutId="lobby-visibility"
                    value={room.is_public ? "public" : "private"}
                    disabled={visBusy}
                    onChange={(v) => changeVisibility(v === "public")}
                    options={[
                      { value: "private", label: "Private" },
                      { value: "public", label: "Public" },
                    ]}
                  />
                  <p className="text-center text-xs text-cream/50">
                    {room.is_public
                      ? "Anyone can find this game with Find Public Session. Friends can still join with the code."
                      : "Only players with the code can join."}
                  </p>

                  {/* Role-assignment mode: live pick (ranked-style) vs random deal. */}
                  <span className={`mt-2 text-sm uppercase tracking-widest text-gold ${heading}`}>
                    Role assignment
                  </span>
                  <SlidingToggle
                    layoutId="lobby-assign-mode"
                    value={room.role_assign_mode}
                    disabled={modeBusy}
                    onChange={(v) => changeAssignMode(v)}
                    options={[
                      { value: "choose", label: "Choose" },
                      { value: "random", label: "Random" },
                    ]}
                  />
                  <p className="text-center text-xs text-cream/50">
                    {room.role_assign_mode === "choose"
                      ? "At start, everyone is dealt a camp + tier and picks their own role (30s)."
                      : "Roles are dealt secretly from your configuration."}
                  </p>
                  {room.role_assign_mode === "random" && (
                    <button
                      onClick={() => setShowRoleConfig(true)}
                      className="rounded-lg border border-gold/50 px-3 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10"
                    >
                      Configure roles
                    </button>
                  )}

                  <motion.button
                    onClick={handleStartGame}
                    disabled={starting}
                    whileHover={starting ? undefined : { scale: 1.02 }}
                    whileTap={starting ? undefined : { scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className={`mt-2 rounded-xl bg-gold px-4 py-3 font-semibold text-home-bg shadow-[0_0_16px_rgba(227,181,16,.35)] transition-shadow hover:shadow-[0_0_26px_rgba(227,181,16,.55)] disabled:opacity-50 ${heading}`}
                  >
                    {starting ? "Starting…" : "Start game"}
                  </motion.button>
                  <p className="text-center text-xs text-cream/50">
                    Best with 6 or more players.
                  </p>

                  {startError && (
                    <p className="text-center text-sm text-red-300">{startError}</p>
                  )}
                </div>
              </div>
            ) : (
              <div
                className="glow-gold-pulse relative overflow-hidden rounded-xl border-2 border-gold/40 p-5 text-center"
                style={plaqueStyle()}
              >
                <PlaqueLayers />
                <CornerFrame />
                <p className={`relative text-base font-semibold text-gold ${heading}`}>
                  {room.is_public ? "Public game" : "Private game"}
                </p>
                <p className="relative mt-1 text-xs text-cream/55">
                  Roles:{" "}
                  {room.role_assign_mode === "choose"
                    ? "you pick your own at game start"
                    : "dealt secretly by the game"}
                </p>
                <p className="relative mt-3 text-sm text-cream/70">
                  Waiting for the host to start the game&hellip;
                </p>
              </div>
            )}
          </motion.section>
        </div>
      </motion.div>

      {/* Host's random-mode role configuration. */}
      {showRoleConfig && (
        <RoleConfigModal room={room} onClose={() => setShowRoleConfig(false)} />
      )}
    </main>
    </MotionConfig>
  );
}
