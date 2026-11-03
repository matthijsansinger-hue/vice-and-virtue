"use client";

// The start-screen "hub": a desktop-sidebar / mobile-bottom-nav shell with a
// top HUD (currencies, Soul Fragments, daily reward, account/level) and in-hub
// sections — Play, Roles, Shop. Friends + Profile route to their full pages;
// Ranked routes to the /ranked queue. Soul Fragments / Daily / Join are modals.
// Season pass, the cosmetics Shop, and Settings are honest "coming soon"
// placeholders (no backend yet). Playing needs an account: a logged-out
// visitor sees a sign-up prompt on Play, and everything else prompts a login.

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, MotionConfig } from "framer-motion";
import { heading, staggerContainer, fadeUp, plaqueStyle, PlaqueLayers, SoulEnergyText } from "@/components/ui/royal";
import {
  IconPlayerPlay,
  IconMasksTheater,
  IconShoppingBag,
  IconUsers,
  IconUser,
  IconMedal,
  IconHelp,
  IconBrandDiscord,
  IconShieldLock,
  IconLock,
  IconTrophy,
  IconSettings,
  IconSparkles,
  IconX,
  IconChevronRight,
  IconDeviceGamepad2,
  IconAdjustmentsHorizontal,
} from "@tabler/icons-react";
import { createRoom, joinRoom } from "@/lib/room";
import { PartyStage, type StageMember, type StageSlot } from "@/components/PartyStage";
import { useParty, PARTY_JOINED_EVENT } from "@/components/PartyProvider";
import { PARTY_MAX, partyReasonText } from "@/lib/party";
import { FriendPicker } from "@/components/FriendPicker";
import { GameModePicker, MODE_LABEL, type ModeChoice } from "@/components/GameModePicker";
import { ClassPreferencePicker } from "@/components/ClassPreferencePicker";
import { useMatchmaking, type Matchmaking } from "@/lib/useMatchmaking";
import {
  CLASS_PREF_KEY,
  parseClassPreference,
  QUEUE_PATIENCE_MS,
  type ClassPreference,
  type QueueKind,
} from "@/lib/matchmaking";
import { useStoredString } from "@/lib/useStoredString";
import { WishlistPrompt } from "@/components/WishlistPrompt";
import {
  acceptFriendInvite,
  getUsername,
  getFriendsActiveLobbies,
  getMyGameInvites,
  getFriendData,
  searchUsers,
  sendFriendRequest,
  acceptRequest,
  removeFriendship,
  type FriendLobby,
  type GameInvite,
  type FriendData,
} from "@/lib/friends";
import {
  setStoredPlayerId,
  setStoredPlayerName,
} from "@/lib/player";
import { useAuth } from "@/lib/useAuth";
import { signOut } from "@/lib/auth";
import { awardAchievement } from "@/lib/achievements";
import { getUserStats } from "@/lib/stats";
import { roleBadgeProgress } from "@/lib/badges";
import type { Profile } from "@/lib/types";
import {
  getMyEconomy,
  openSoulShard,
  claimDailyLogin,
  unlockRoleWithLe,
  levelFromXp,
  LE_ABBR,
  MANO_NAME,
  roleUnlockCost,
  DEFAULT_UNLOCKED_ROLES,
  type AccountEconomy,
} from "@/lib/economy";
import { getMyRanked, formatRank, type RankedState } from "@/lib/ranked";
import { ROLES, ROLE_CLASSES, CLASS_PAIRS, type RoleDef } from "@/lib/roles";
import { RulesGuide } from "@/components/RulesGuide";
import { RoleIcon } from "@/components/RoleIcon";
import { Banner } from "@/components/Banner";
import { CharacterAvatar } from "@/components/CharacterAvatar";
import { LevelStar } from "@/components/LevelStar";
import { ColorShop } from "@/components/ColorShop";
import { FounderPack, GetMano } from "@/components/ManoStore";
import { BattlePass } from "@/components/BattlePass";
import { AuthModal } from "@/components/AuthModal";
import { ProfileDashboard } from "@/components/ProfileDashboard";
import { BadgeProgressStrip } from "@/components/ProfileStats";
import { LeaderboardModal } from "@/components/Leaderboard";
import { ManoIcon, LifeProficiencyIcon, SoulShardIcon, DailyRewardIcon } from "@/components/CurrencyIcons";
import { SoulFragmentReveal } from "@/components/SoulFragmentReveal";

type Section = "play" | "roles" | "shop" | "profile" | "friends";
type NavId = Section | "friends" | "profile";

const NAV: { id: NavId; label: string; Icon: typeof IconUser }[] = [
  { id: "play", label: "Play", Icon: IconPlayerPlay },
  { id: "roles", label: "Roles", Icon: IconMasksTheater },
  { id: "shop", label: "Shop", Icon: IconShoppingBag },
  { id: "friends", label: "Friends", Icon: IconUsers },
  { id: "profile", label: "Profile", Icon: IconUser },
];

const DISCORD_URL = "https://discord.gg/Ju5K2cZquH";


export default function HomePage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();

  const [section, setSection] = useState<Section>("play");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showRules, setShowRules] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [modal, setModal] = useState<
    "daily" | "settings" | "join" | "mode" | "party" | "classes" | null
  >(null);

  // Auth modal (login gate). `authMsg` explains why it opened.
  const [authOpen, setAuthOpen] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");

  // Friend-invite link (?invite=<userId>).
  const [inviteFrom, setInviteFrom] = useState<{ id: string; username: string } | null>(null);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const inviteHandledRef = useRef(false);

  // Friends' open lobbies + direct invites.
  const [friendLobbies, setFriendLobbies] = useState<FriendLobby[]>([]);
  const [gameInvites, setGameInvites] = useState<GameInvite[]>([]);
  const [dismissedGames, setDismissedGames] = useState<Set<string>>(new Set());

  // Account economy + ranked (HUD + Play/Roles).
  const [econ, setEcon] = useState<AccountEconomy | null>(null);
  const [ranked, setRanked] = useState<RankedState | null>(null);
  const [dailyClaimed, setDailyClaimed] = useState(true);

  // Soul Fragment cinematic + daily state. `showFragments` keeps the forced
  // reveal mounted through the final reward even after the count hits 0.
  const [showFragments, setShowFragments] = useState(false);
  const [dailyBusy, setDailyBusy] = useState(false);

  // Play: the selected queue mode + your remembered class picks. The queue
  // lives up here (not in the Play section) so a search survives switching
  // hub tabs — unmounting the hook would leave the queue.
  const [storedMode, setStoredMode] = useStoredString("vv_play_mode");
  const mode: QueueKind = storedMode === "ranked" ? "ranked" : "public";
  const [storedPref, setStoredPref] = useStoredString(CLASS_PREF_KEY);
  const classPref = parseClassPreference(storedPref);
  const playName = profile?.username ?? "";

  // Your party (PartyProvider, migration 137). Members play the leader's mode;
  // only the leader (or a solo player) invites, picks the mode and starts.
  const pty = useParty();
  const partyMembers = pty.party?.members ?? [];
  const partyInvited = pty.party?.invited ?? [];
  const amLeader = pty.isLeader;
  const leaderName = pty.inParty
    ? partyMembers.find((m) => m.userId === pty.party?.leaderId)?.username ?? "your party leader"
    : null;
  const playMode: QueueKind = pty.inParty && !amLeader && pty.party ? pty.party.mode : mode;
  const stageOthers: StageSlot[] = [
    ...partyMembers
      .filter((m) => m.userId !== profile?.id)
      .map((m): StageSlot => ({
        kind: "member",
        userId: m.userId,
        name: m.username,
        character: m.character,
        level: m.level,
        leader: m.userId === pty.party?.leaderId,
        status: m.status,
      })),
    ...partyInvited.map((i): StageSlot => ({ kind: "invited", userId: i.userId, name: i.username, character: i.character })),
  ];
  const stageSlots: [StageSlot, StageSlot] = [stageOthers[0] ?? { kind: "empty" }, stageOthers[1] ?? { kind: "empty" }];

  // The hub doesn't show the idle queue size, so it doesn't poll for it.
  const mm = useMatchmaking(playMode, playName, { idleCounts: false });

  // Accepting a party invite (from the toast) brings you to Play, where the
  // party is shown.
  useEffect(() => {
    const onJoined = () => {
      setModal(null);
      setSection("play");
    };
    window.addEventListener(PARTY_JOINED_EVENT, onJoined);
    return () => window.removeEventListener(PARTY_JOINED_EVENT, onJoined);
  }, []);


  useEffect(() => {
    try {
      const raw = localStorage.getItem("vv_dismissed_friend_games");
      if (raw) setDismissedGames(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  // Read a friend-invite id from the URL (?invite=), persist it across a
  // sign-up round trip, then look up the inviter's name for the prompt.
  useEffect(() => {
    let id: string | null = null;
    const fromUrl = new URLSearchParams(window.location.search).get("invite");
    if (fromUrl) {
      id = fromUrl;
      const url = new URL(window.location.href);
      url.searchParams.delete("invite");
      window.history.replaceState({}, "", url.toString());
      try {
        localStorage.setItem("vv_pending_invite", fromUrl);
      } catch {
        /* ignore */
      }
    } else {
      try {
        id = localStorage.getItem("vv_pending_invite");
      } catch {
        /* ignore */
      }
    }
    if (!id) return;
    const inviterId = id;
    getUsername(inviterId).then((username) =>
      setInviteFrom({ id: inviterId, username: username ?? "a player" })
    );
  }, []);

  // Once logged in, accept the pending invite (instant friends).
  useEffect(() => {
    if (!inviteFrom || authLoading || inviteHandledRef.current || !profile) return;
    inviteHandledRef.current = true;
    const clearPending = () => {
      try {
        localStorage.removeItem("vv_pending_invite");
      } catch {
        /* ignore */
      }
    };
    if (profile.id === inviteFrom.id) {
      setInviteMsg("That's your own invite link.");
      setInviteFrom(null);
      clearPending();
      return;
    }
    const inviterName = inviteFrom.username;
    acceptFriendInvite(inviteFrom.id)
      .then(() => setInviteMsg(`You're now friends with ${inviterName}!`))
      .catch(() => setInviteMsg("Couldn't add that friend — please try again."))
      .finally(() => {
        setInviteFrom(null);
        clearPending();
      });
  }, [inviteFrom, profile, authLoading]);

  // Poll friends' open lobbies + direct invites (logged-in only).
  useEffect(() => {
    if (!profile) {
      setFriendLobbies([]);
      setGameInvites([]);
      return;
    }
    let active = true;
    const fetchLobbies = () => {
      Promise.all([getFriendsActiveLobbies(), getMyGameInvites()])
        .then(([lobbies, invites]) => {
          if (!active) return;
          setFriendLobbies(lobbies);
          setGameInvites(invites);
        })
        .catch(() => {});
    };
    fetchLobbies();
    const t = setInterval(fetchLobbies, 12000);
    const onFocus = () => fetchLobbies();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [profile]);

  // Account economy + ranked for the HUD + Play/Roles sections.
  useEffect(() => {
    if (!profile) {
      setEcon(null);
      setRanked(null);
      return;
    }
    let active = true;
    getMyEconomy()
      .then((e) => {
        if (!active) return;
        setEcon(e);
        // The server's record is authoritative (and cross-device) — prefer it
        // over the localStorage day-guard for the claimed/unclaimed visual.
        if (e) setDailyClaimed(e.dailyClaimed);
      })
      .catch(() => {});
    getMyRanked().then((r) => active && setRanked(r)).catch(() => {});
    try {
      const today = new Date().toISOString().slice(0, 10);
      setDailyClaimed(localStorage.getItem("vv_daily_shard_claimed") === today);
    } catch {
      /* ignore */
    }
    return () => {
      active = false;
    };
  }, [profile]);

  function gate(msg: string | undefined, authAs: "signup" | "login" = "signup") {
    setAuthMsg(msg);
    setAuthMode(authAs);
    setAuthOpen(true);
  }

  function go(id: NavId) {
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    if (id === "play") return setSection("play");
    if (id === "roles" || id === "shop") {
      if (!profile) return gate(`Log in or sign up to open ${id === "roles" ? "Roles" : "the Shop"}.`);
      return setSection(id);
    }
    if (id === "friends") {
      if (!profile) return gate("Log in or sign up to see Friends.");
      return setSection("friends");
    }
    if (id === "profile") {
      if (!profile) return gate("Log in or sign up to see your Profile.");
      return setSection("profile");
    }
  }

  async function handleCreate() {
    if (!profile) return gate("Create an account to start a lobby.");
    const trimmed = profile.username;
    setBusy(true);
    setError(null);
    try {
      const { room, player } = await createRoom(trimmed, profile.id);
      setStoredPlayerName(trimmed);
      setStoredPlayerId(player.id);
      await bringParty(room.code);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  // Select game mode: Public / Ranked select the queue the Play button searches;
  // Private lobby and Join by code act straight away. (The old "join the
  // fullest open lobby" path, findOrCreatePublicRoom, stays for code rejoins
  // but is not how you find a public game.)
  function chooseMode(choice: ModeChoice) {
    setError(null);
    if (choice === "private") {
      setModal(null);
      void handleCreate();
      return;
    }
    if (choice === "join") {
      setModal("join");
      return;
    }
    setStoredMode(choice);
    if (pty.party && amLeader) void pty.setMode(choice).catch(() => {});
    setModal(null);
  }

  // Leading a party into a lobby: members' clients follow (party_goto). A
  // failure here only means they don't follow; the leader still goes in.
  async function bringParty(code: string) {
    if (!pty.inParty || !amLeader) return;
    try {
      await pty.goto(code);
    } catch {
      /* members can still join by code */
    }
  }

  function openModePicker() {
    if (pty.inParty && !amLeader) return setError(`${leaderName} picks the game mode.`);
    setModal("mode");
  }

  // Play: search the selected queue with your remembered class picks.
  async function handlePlay() {
    setError(null);
    if (!profile) return gate("Create an account to play.");
    if (pty.inParty) {
      if (!amLeader) return;
      return setError(
        "Queueing together arrives in the next update. For now, start a private lobby or join one by code and your party comes with you."
      );
    }
    await mm.start(mode, classPref);
  }

  function updateClassPref(p: ClassPreference) {
    setStoredPref(JSON.stringify(p));
  }

  function openPartyPicker() {
    if (!profile) return gate("Log in or sign up to play with friends.");
    if (pty.inParty && !amLeader) return setError(`Only ${leaderName} can invite.`);
    setModal("party");
  }

  async function inviteFriend(friendId: string, username: string): Promise<string | null> {
    const res = await pty.invite(friendId, mode);
    return res.ok ? null : partyReasonText(res.reason, username);
  }

  async function removePartyMember(userId: string, name: string) {
    setError(null);
    try {
      const res = await pty.remove(userId);
      if (!res.ok) setError(partyReasonText(res.reason, name));
    } catch {
      setError("Couldn't update your party. Please try again.");
    }
  }

  async function leaveMyParty() {
    setError(null);
    try {
      const res = await pty.leave();
      if (!res.ok) setError(partyReasonText(res.reason));
    } catch {
      setError("Couldn't leave the party. Please try again.");
    }
  }

  async function handleJoin() {
    if (!profile) return gate("Create an account to join a lobby.");
    const trimmed = profile.username;
    const code = joinCode.trim().toUpperCase();
    if (!code) return setError("Please enter a room code.");
    setBusy(true);
    setError(null);
    try {
      const { room, player } = await joinRoom(code, trimmed, profile.id);
      setStoredPlayerName(trimmed);
      setStoredPlayerId(player.id);
      await bringParty(room.code);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function joinFriendLobby(code: string) {
    if (!profile) return gate("Create an account to join a lobby.");
    const trimmed = profile.username;
    setBusy(true);
    setError(null);
    try {
      const { room, player } = await joinRoom(code, trimmed, profile.id);
      setStoredPlayerName(trimmed);
      setStoredPlayerId(player.id);
      await bringParty(room.code);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join that game.");
      setBusy(false);
    }
  }

  function dismissGame(roomId: string) {
    setDismissedGames((prev) => {
      const next = new Set(prev);
      next.add(roomId);
      try {
        localStorage.setItem("vv_dismissed_friend_games", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Forced open: the moment you hold any unopened fragment, raise the cinematic.
  useEffect(() => {
    if (profile && (econ?.unopened_shards ?? 0) > 0) setShowFragments(true);
  }, [profile, econ?.unopened_shards]);

  async function refreshEcon() {
    const fresh = await getMyEconomy();
    if (fresh) setEcon(fresh);
  }

  async function claimDaily() {
    if (dailyBusy) return;
    setDailyBusy(true);
    try {
      await claimDailyLogin();
      const fresh = await getMyEconomy();
      if (fresh) setEcon(fresh);
      setDailyClaimed(true);
    } catch {
      /* ignore */
    } finally {
      setDailyBusy(false);
    }
  }

  const surfaceGames = (() => {
    const byRoom = new Map<string, { roomId: string; code: string; name: string; players: number; invited: boolean }>();
    for (const l of friendLobbies)
      byRoom.set(l.room_id, { roomId: l.room_id, code: l.code, name: l.host_username, players: l.player_count, invited: false });
    for (const inv of gameInvites)
      byRoom.set(inv.room_id, { roomId: inv.room_id, code: inv.code, name: inv.from_username, players: inv.player_count, invited: true });
    return [...byRoom.values()]
      .filter((g) => !dismissedGames.has(g.roomId))
      .sort((a, b) => Number(b.invited) - Number(a.invited));
  })();

  const lvl = econ ? levelFromXp(econ.xp) : null;
  const initials = profile ? profile.username.slice(0, 2).toUpperCase() : "";
  const sectionTitle =
    section === "play"
      ? "Play"
      : section === "roles"
        ? "Roles"
        : section === "shop"
          ? "Shop"
          : section === "profile"
            ? "Profile"
            : "Friends";

  return (
    <MotionConfig reducedMotion="user">
    <main className="wood-desk-startscreen min-h-screen bg-home-bg text-cream">
      {/* ---- Desktop sidebar (fixed: stays put while the page scrolls) ---- */}
      <aside className="hidden border-r border-gold/20 p-4 lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-56 lg:flex-col lg:gap-1.5 lg:overflow-y-auto">
        <div className="mb-2 border-b border-gold/20 px-2 pb-4">
          <button
            type="button"
            onClick={() => go("play")}
            aria-label="Home"
            title="Home"
            className="block w-fit cursor-pointer rounded transition-opacity hover:opacity-80 focus:outline-none focus-visible:opacity-80"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png?v=3" alt="Vice and Virtue" className="h-auto w-40 max-w-full" />
          </button>
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`relative flex items-center gap-3.5 overflow-hidden rounded-lg py-3 pl-3 pr-3 text-left text-base transition-colors ${heading} ${
              section === id ? "font-semibold text-gold" : "text-cream/70 hover:bg-cream/5"
            }`}
          >
            {section === id && (
              <motion.span
                layoutId="desktop-nav-active"
                className="absolute inset-0 rounded-lg border-l-2 border-gold bg-gold/15"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-3.5">
              <Icon size={20} aria-hidden /> {label}
            </span>
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-1.5 border-t border-gold/20 pt-3">
          <button onClick={() => setShowLeaderboard(true)} className={`flex items-center gap-3.5 rounded-lg py-2.5 pl-3 pr-3 text-left text-base text-cream/70 transition-colors hover:bg-cream/5 ${heading}`}>
            <IconMedal size={20} aria-hidden /> Leaderboard
          </button>
          <button onClick={() => setShowRules(true)} className={`flex items-center gap-3.5 rounded-lg py-2.5 pl-3 pr-3 text-left text-base text-cream/70 transition-colors hover:bg-cream/5 ${heading}`}>
            <IconHelp size={20} aria-hidden /> How to play
          </button>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => profile && void awardAchievement("discord_joined")}
            className={`flex items-center gap-3.5 rounded-lg py-2.5 pl-3 pr-3 text-base text-[#9aa0f2] transition-colors hover:bg-cream/5 ${heading}`}
          >
            <IconBrandDiscord size={20} aria-hidden /> Discord
          </a>
          <Link
            href="/privacy"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-cream/70 transition-colors hover:bg-cream/5"
          >
            <IconShieldLock size={18} aria-hidden /> Privacy
          </Link>
        </div>
      </aside>

      {/* ---- Content column ---- */}
      <div className="flex min-h-screen flex-col lg:pl-56">
        {/* HUD */}
        <header className="flex items-center gap-2 border-b border-gold/20 px-4 py-3 lg:py-3.5">
          <span className={`hidden text-2xl font-semibold tracking-wide text-gold lg:block ${heading}`}>{sectionTitle}</span>
          {/* mobile account chip (left) — held back while auth resolves, then
              fades in. Logged-out shows nothing here (the brand logo lives in
              the Play section on mobile). */}
          {!authLoading && profile && (
            <motion.button variants={fadeUp} initial="hidden" animate="show" onClick={() => go("profile")} className="relative min-w-0 lg:hidden" aria-label="Profile">
              <Banner
                name={profile.username}
                character={profile.appearance}
                initials={initials}
                featuredBadges={profile.featured_badges}
                nameColor={profile.name_color}
                bannerColor={profile.banner_color}
              />
              {/* Your level, in a 9-pointed star at the banner's top-right. */}
              <span className="absolute -right-1.5 -top-2.5 z-10">
                <LevelStar level={lvl?.level ?? 1} size={28} />
              </span>
            </motion.button>
          )}

          {/* Fixed-height cluster: the header never changes size while auth/econ resolve.
              shrink-0 keeps the currency pills + icons full-size; the banner yields. */}
          <div className="ml-auto flex h-10 shrink-0 items-center gap-1.5 sm:gap-2">
            {!authLoading && profile && (
              <>
                {econ && (
                  <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex items-center gap-2">
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border-[3px] border-teal-400/70 bg-panel px-2.5 py-1.5 text-sm shadow-[0_0_10px_rgba(45,212,191,0.4)] sm:px-3.5 ${heading}`} title="Life Proficiency">
                      <LifeProficiencyIcon size={16} />
                      <span className="font-semibold text-teal-300">{econ.le}</span> <span className="text-teal-300">{LE_ABBR}</span>
                    </span>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-pink-400/80 bg-panel px-2.5 py-1.5 text-sm shadow-[0_0_10px_rgba(244,114,182,0.45)] sm:px-3.5 ${heading}`} title={MANO_NAME}>
                      <ManoIcon size={16} />
                      <span className="font-semibold text-pink-300">{econ.mano}</span>
                    </span>
                  </motion.div>
                )}
                <motion.div variants={fadeUp} initial="hidden" animate="show" className="flex items-center gap-2">
                  <HudIcon
                    label="Daily reward"
                    onClick={() => setModal("daily")}
                    badge={dailyClaimed ? null : "!"}
                    state={dailyClaimed && (econ?.dailyWins ?? 0) >= 3 ? "done" : "available"}
                  >
                    <DailyRewardIcon size={18} />
                  </HudIcon>
                  {/* desktop account banner — profile icon + name (in your
                      earned name color) + featured badges on your earned banner
                      color; the level sits with the name. */}
                  <button onClick={() => go("profile")} className="relative hidden lg:block" aria-label="Profile">
                    <Banner
                      name={profile.username}
                      character={profile.appearance}
                      initials={initials}
                      featuredBadges={profile.featured_badges}
                      nameColor={profile.name_color}
                      bannerColor={profile.banner_color}
                    />
                    {/* Your level, in a 9-pointed star at the banner's top-right. */}
                    <span className="absolute -right-1.5 -top-2.5 z-10">
                      <LevelStar level={lvl?.level ?? 1} size={28} />
                    </span>
                  </button>
                  <HudIcon label="Settings" onClick={() => setModal("settings")}>
                    <IconSettings size={18} stroke={1.5} aria-hidden />
                  </HudIcon>
                </motion.div>
              </>
            )}
            {!authLoading && !profile && (
              <motion.button
                variants={fadeUp}
                initial="hidden"
                animate="show"
                onClick={() => { setAuthMsg(undefined); setAuthOpen(true); }}
                className={`rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 ${heading}`}
              >
                Log in / Sign up
              </motion.button>
            )}
          </div>
        </header>

        {/* Scrollable section content */}
        <div className="flex-1 px-5 py-6 pb-24 lg:pb-8">
          {section === "play" && (
            <PlaySection
              profile={!!profile}
              authLoading={authLoading}
              ranked={ranked}
              error={error}
              busy={busy}
              inviteMsg={inviteMsg}
              inviteFrom={inviteFrom}
              onInviteLogin={() => gate(undefined)}
              surfaceGames={surfaceGames}
              me={{
                name: profile?.username ?? "",
                character: profile?.appearance ?? null,
                level: lvl?.level ?? null,
                leader: pty.inParty && amLeader,
              }}
              stageSlots={stageSlots}
              canInvite={amLeader}
              canRemove={amLeader}
              onRemoveMember={removePartyMember}
              onLeaveParty={pty.inParty ? leaveMyParty : null}
              leaderName={amLeader ? null : leaderName}
              mode={playMode}
              mm={mm}
              classPref={classPref}
              onSelectMode={openModePicker}
              onPlay={handlePlay}
              onAddFriend={openPartyPicker}
              onEditClasses={() => setModal("classes")}
              onSignUp={() => gate("Create an account to play.")}
              onLogIn={() => gate(undefined, "login")}
              onJoinFriend={joinFriendLobby}
              onDismissGame={dismissGame}
              onHowToPlay={() => setShowRules(true)}
              onLeaderboard={() => setShowLeaderboard(true)}
              onOpenPass={() => (profile ? setShowPass(true) : gate("Log in or sign up to view the season pass."))}
            />
          )}
          {section === "roles" && profile && (
            <RolesSection
              meId={profile.id}
              econ={econ}
              onUnlocked={() => getMyEconomy().then(setEcon).catch(() => {})}
            />
          )}
          {section === "shop" && (
            <div className="space-y-10">
              <FounderPack econ={econ} onPurchased={() => getMyEconomy().then(setEcon).catch(() => {})} />
              <ColorShop econ={econ} onBought={() => getMyEconomy().then(setEcon).catch(() => {})} />
              <GetMano econ={econ} onPurchased={() => getMyEconomy().then(setEcon).catch(() => {})} />
            </div>
          )}
          {section === "profile" && profile && <ProfileDashboard profile={profile} />}
          {section === "friends" && profile && <FriendsSection meId={profile.id} />}
        </div>
      </div>

      {/* A search keeps running on other hub tabs: show it, with a way back. */}
      {mm.searching && section !== "play" && (
        <div className="fixed bottom-20 right-3 z-30 flex items-center gap-1 rounded-full border border-gold/60 bg-[#2a1d12]/95 py-1 pl-3 pr-1 text-xs shadow-[0_4px_16px_rgba(0,0,0,.5)] lg:bottom-6 lg:right-6">
          <button onClick={() => go("play")} className="font-semibold text-cream">
            Searching · {formatElapsed(mm.elapsedMs)}
          </button>
          <button onClick={() => void mm.cancel()} aria-label="Cancel search" className="rounded-full p-1.5 text-cream/60 transition-colors hover:bg-cream/10 hover:text-cream">
            <IconX size={14} aria-hidden />
          </button>
        </div>
      )}

      {/* ---- Mobile bottom nav ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-gold/30 bg-[#3a281a] px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] ${heading} ${
              section === id ? "text-gold" : "text-cream/60"
            }`}
          >
            {section === id && (
              <motion.span
                layoutId="mobile-nav-active"
                className="absolute top-0 h-0.5 w-8 rounded-full bg-gold shadow-[0_0_8px_rgba(227,181,16,.8)]"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <motion.span
              animate={{ scale: section === id ? 1.15 : 1, y: section === id ? -1 : 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Icon size={21} aria-hidden />
            </motion.span>
            {label}
          </button>
        ))}
      </nav>

      {/* ---- Modals ---- */}
      {/* Soul Fragments — forced full-screen cinematic: whenever you hold any
          unopened fragment it takes over the screen (idle shard → tap → shatter
          → rarity wash → reward), and stays until every fragment is opened. */}
      {showFragments && econ && (
        <SoulFragmentReveal
          remaining={econ.unopened_shards}
          openOne={openSoulShard}
          onAfterOpen={refreshEcon}
          onClose={() => setShowFragments(false)}
        />
      )}

      {modal === "daily" && (
        <Overlay onClose={() => setModal(null)}>
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-cream/55">Daily reward</div>
            <div
              className="mx-auto my-3 flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-gold text-gold"
              style={{ background: "rgba(0,0,0,.25)" }}
            >
              <DailyRewardIcon size={38} />
            </div>
            <p className="mx-auto max-w-xs text-sm text-cream/80">
              Two ways to earn a Soul Fragment each day:
            </p>
            <div className="mx-auto mt-3 flex max-w-xs flex-col gap-2 text-left">
              {/* Daily login — gold while claimable, greyed once collected. */}
              <div className={"flex items-center gap-3 rounded-xl px-3 py-2.5 " + (dailyClaimed ? "border border-cream/15 bg-black/10" : "border-2 border-gold bg-gold/10")}>
                <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-full " + (dailyClaimed ? "border border-cream/15 bg-black/20 text-cream/35" : "border-2 border-gold bg-gold/20 text-gold")}>
                  <DailyRewardIcon size={18} />
                </span>
                <span className={"min-w-0 flex-1 text-xs " + (dailyClaimed ? "text-cream/50" : "font-semibold text-cream")}>Daily login</span>
                {dailyClaimed ? (
                  <span className="shrink-0 rounded-full border border-cream/20 px-2 py-0.5 text-xs font-semibold text-cream/45">✓ Claimed</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 rounded-full border border-gold bg-gold px-2 py-0.5 text-xs font-bold text-home-bg">
                    <SoulShardIcon size={13} /> +1
                  </span>
                )}
              </div>
              {/* First three wins — gold while you can still earn, greyed at 3/3. */}
              {(() => {
                const w = econ?.dailyWins ?? 0;
                const done = w >= 3;
                return (
                  <div className={"flex items-center gap-3 rounded-xl px-3 py-2.5 " + (done ? "border border-cream/15 bg-black/10" : "border-2 border-gold bg-gold/10")}>
                    <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-full " + (done ? "border border-cream/15 bg-black/20 text-cream/35" : "border-2 border-gold bg-gold/20 text-gold")}>
                      <IconTrophy size={18} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={"block text-xs " + (done ? "text-cream/50" : "font-semibold text-cream")}>First three wins of the day</span>
                      <span className="block text-[11px] text-cream/55">{w}/3 won today</span>
                    </span>
                    {done ? (
                      <span className="shrink-0 rounded-full border border-cream/20 px-2 py-0.5 text-xs font-semibold text-cream/45">✓ Done</span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1 rounded-full border border-gold bg-gold px-2 py-0.5 text-xs font-bold text-home-bg">
                        <SoulShardIcon size={13} /> +1 each
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
            <button
              onClick={claimDaily}
              disabled={dailyBusy || dailyClaimed}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <DailyRewardIcon size={17} />
              {dailyBusy ? "Claiming…" : dailyClaimed ? "Claimed — come back tomorrow" : "Claim today's Soul Fragment"}
            </button>
          </div>
        </Overlay>
      )}

      {modal === "settings" && (
        <Overlay onClose={() => setModal(null)}>
          <div className="text-center">
            <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-cream/55">Settings</div>
            <p className="mb-4 text-sm text-cream/60">Account and game options.</p>
          </div>

          <div className="space-y-2">
            {/* Legal — the privacy notice lives here now (no longer a forced popup on entry). */}
            <Link
              href="/privacy"
              className="flex items-center justify-between gap-3 rounded-xl border border-gold/40 bg-black/20 px-4 py-3 text-left text-cream transition-colors hover:bg-cream/5"
            >
              <span className="flex items-center gap-3">
                <IconShieldLock size={20} aria-hidden className="shrink-0 text-gold" />
                <span>
                  <span className="block text-sm font-semibold">Privacy notice</span>
                  <span className="block text-xs text-cream/55">What data we store, why, and your rights.</span>
                </span>
              </span>
              <IconChevronRight size={18} aria-hidden className="shrink-0 text-cream/45" />
            </Link>
          </div>

          <button
            onClick={async () => {
              await signOut().catch(() => {});
              setModal(null);
            }}
            className="mt-4 w-full rounded-xl border border-gold px-4 py-2.5 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            Log out
          </button>
        </Overlay>
      )}

      {modal === "join" && (
        <Overlay onClose={() => setModal(null)}>
          <div className="text-center">
            <div className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-cream/55">Join with a room code</div>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={5}
              placeholder="CODE"
              className="w-full rounded-lg border border-gold bg-cream px-4 py-3 text-center text-xl tracking-[0.4em] text-home-bg placeholder:tracking-normal placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
            />
            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
            <button onClick={handleJoin} disabled={busy} className="mt-3 w-full rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50">
              Join room
            </button>
          </div>
        </Overlay>
      )}

      {modal === "mode" && (
        <Overlay onClose={() => setModal(null)} wide>
          <GameModePicker
            selected={mode}
            rankNote={ranked ? formatRank(ranked) : null}
            onChoose={chooseMode}
          />
        </Overlay>
      )}

      {modal === "party" && profile && (
        <Overlay onClose={() => setModal(null)} wide>
          <FriendPicker
            meId={profile.id}
            partyIds={new Set(partyMembers.map((m) => m.userId))}
            invitedIds={new Set(partyInvited.map((i) => i.userId))}
            full={partyMembers.length + partyInvited.length >= PARTY_MAX}
            onInvite={inviteFriend}
            onAddFriends={() => {
              setModal(null);
              go("friends");
            }}
          />
        </Overlay>
      )}

      {modal === "classes" && (
        <Overlay onClose={() => setModal(null)} wide>
          <h2 className={`text-xl font-semibold tracking-wide text-gold ${heading}`}>Your preferred classes</h2>
          <p className="mb-3 mt-1 text-xs text-cream/60">
            You don&rsquo;t know which camp you&rsquo;ll be dealt, so pick one class for each. Public and ranked
            matches try to give you the one for your camp. Saved on this device.
          </p>
          <ClassPreferencePicker value={classPref} onChange={updateClassPref} />
          <button
            onClick={() => setModal(null)}
            className={`mt-4 w-full rounded-xl bg-gold px-4 py-2.5 font-semibold text-home-bg ${heading}`}
          >
            Done
          </button>
        </Overlay>
      )}

      {showRules && <RulesGuide onClose={() => setShowRules(false)} />}
      {showPass && (
        <BattlePass
          econ={econ}
          onClose={() => setShowPass(false)}
          onChanged={() => getMyEconomy().then(setEcon).catch(() => {})}
        />
      )}
      {showLeaderboard && (
        <LeaderboardModal meUserId={profile?.id} onClose={() => setShowLeaderboard(false)} />
      )}
      {authOpen && <AuthModal initialMode={authMode} message={authMsg} onClose={() => setAuthOpen(false)} />}
    </main>
    </MotionConfig>
  );
}

// ---- Sections ----

function PlaySection(props: {
  profile: boolean;
  authLoading: boolean;
  ranked: RankedState | null;
  error: string | null;
  busy: boolean;
  inviteMsg: string | null;
  inviteFrom: { id: string; username: string } | null;
  onInviteLogin: () => void;
  surfaceGames: { roomId: string; code: string; name: string; players: number; invited: boolean }[];
  me: StageMember;
  stageSlots: [StageSlot, StageSlot];
  canInvite: boolean;
  canRemove: boolean;
  onRemoveMember: (userId: string, name: string) => void;
  onLeaveParty: (() => void) | null;
  // Set when you're a party member (not the leader): the leader's name.
  leaderName: string | null;
  mode: QueueKind;
  mm: Matchmaking;
  classPref: ClassPreference;
  onSelectMode: () => void;
  onPlay: () => void;
  onAddFriend: () => void;
  onEditClasses: () => void;
  onSignUp: () => void;
  onLogIn: () => void;
  onJoinFriend: (code: string) => void;
  onDismissGame: (roomId: string) => void;
  onHowToPlay: () => void;
  onLeaderboard: () => void;
  onOpenPass: () => void;
}) {
  return (
    <motion.div className="mx-auto max-w-3xl lg:max-w-6xl" initial="hidden" animate="show" variants={staggerContainer}>
      {/* Friend-invite banner */}
      {(props.inviteMsg || (props.inviteFrom && !props.profile)) && (
        <motion.div variants={fadeUp} className="mb-4 rounded-xl border border-gold bg-home-bg/70 p-3 text-center text-sm">
          {props.inviteMsg ? (
            props.inviteMsg
          ) : (
            <>
              Log in or sign up to add <span className="font-semibold text-gold">{props.inviteFrom!.username}</span> as a friend.
              <button onClick={props.onInviteLogin} className="ml-2 rounded-lg bg-gold px-3 py-1 text-xs font-semibold text-home-bg">
                Log in / Sign up
              </button>
            </>
          )}
        </motion.div>
      )}

      {/* Seasonal reward track. Mobile: brand logo beside the ribbon; desktop:
          the ribbon spans the full width (the sidebar owns the logo). */}
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png?v=3" alt="Vice and Virtue" className="block h-24 w-24 shrink-0 lg:hidden" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={props.onOpenPass}
            className="season-ribbon-glow flex w-full items-center gap-3 overflow-hidden rounded-xl border border-[#9aa0ee] px-4 py-2.5 text-left transition-shadow hover:shadow-[0_0_18px_rgba(118,120,237,.55)]"
            style={{ background: "linear-gradient(rgba(16,15,42,.42), rgba(16,15,42,.55)), url('/banners/spirit.png?v=1') center / cover" }}
          >
            <span
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 bg-black/30 lg:flex"
              style={{ borderColor: "#cdd2ff", color: "#e6ddff" }}
            >
              <IconSparkles size={18} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1 lg:flex-row lg:items-center lg:justify-between lg:gap-2">
              <span className={`w-full truncate text-[10px] font-semibold uppercase tracking-widest text-[#ece7ff] [text-shadow:0_1px_2px_rgba(0,0,0,0.7)] lg:w-auto lg:text-xs ${heading}`}>Season 1 · The First Souls</span>
              <span className="shrink-0 rounded-full border border-white/40 bg-black/35 px-1.5 py-0.5 text-[9px] font-semibold text-cream lg:px-2 lg:text-[10px]">View pass →</span>
            </div>
          </button>
        </div>
      </motion.div>

      {/* Your party: you in the middle, a "+" slot on each side. */}
      <PartyStage
        me={props.me}
        loggedOut={!props.authLoading && !props.profile}
        slots={props.stageSlots}
        canInvite={props.canInvite}
        canRemove={props.canRemove}
        onAddFriend={props.onAddFriend}
        onRemove={props.onRemoveMember}
        onLeave={props.onLeaveParty}
      />

      {/* Select game mode + Classes + Play — or, while searching, the search
          itself. Logged out: the sign-up prompt (playing needs an account). */}
      {props.profile ? (
        <PlayControls
          mode={props.mode}
          mm={props.mm}
          busy={props.busy}
          classPref={props.classPref}
          leaderName={props.leaderName}
          onSelectMode={props.onSelectMode}
          onPlay={props.onPlay}
          onEditClasses={props.onEditClasses}
        />
      ) : (
        !props.authLoading && <SignUpPrompt onSignUp={props.onSignUp} onLogIn={props.onLogIn} />
      )}
      {props.error && <p className="mt-3 text-center text-sm text-red-300">{props.error}</p>}

      {/* Wishlist — the hub's standing ask, dismissable. */}
      <motion.div variants={fadeUp} className="mt-4">
        <WishlistPrompt />
      </motion.div>

      {/* Friends' games */}
      {props.profile && props.surfaceGames.length > 0 && (
        <motion.div variants={fadeUp} className="mt-4 rounded-xl border border-gold/20 bg-panel p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-cream/55">Friends&rsquo; games</div>
          <ul className="flex flex-col gap-2">
            {props.surfaceGames.slice(0, 5).map((g) => (
              <li key={g.roomId} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-black/25 text-[11px]">
                    {g.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{g.name} {g.invited ? "invited you" : "started a game"}</span>
                    <span className="block text-[10px] text-cream/60">{g.players} in the lobby</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button onClick={() => props.onJoinFriend(g.code)} className="rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-home-bg transition-opacity hover:opacity-90">
                    Join
                  </button>
                  <button onClick={() => props.onDismissGame(g.roomId)} aria-label="Dismiss" className="rounded-lg p-1.5 text-cream/50 transition-colors hover:bg-cream/10 hover:text-cream">
                    <IconX size={16} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Quick links — the way to reach these on mobile (the sidebar is desktop only). */}
      <motion.div variants={fadeUp} className="mt-5 flex gap-2 lg:hidden">
        <button onClick={props.onHowToPlay} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gold px-3 py-2 text-xs font-semibold text-cream transition-colors hover:bg-cream/10">
          <IconHelp size={16} aria-hidden /> How to play
        </button>
        <button onClick={props.onLeaderboard} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gold px-3 py-2 text-xs font-semibold text-cream transition-colors hover:bg-cream/10">
          <IconMedal size={16} aria-hidden /> Leaderboard
        </button>
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => props.profile && void awardAchievement("discord_joined")}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#5865F2] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          <IconBrandDiscord size={16} aria-hidden /> Discord
        </a>
      </motion.div>

      {/* Privacy notice — reachable on mobile (the sidebar is desktop only). */}
      <motion.p variants={fadeUp} className="mt-4 text-center lg:hidden">
        <Link
          href="/privacy"
          className="text-xs text-cream/50 underline transition-colors hover:text-cream"
        >
          Privacy notice
        </Link>
      </motion.p>
    </motion.div>
  );
}

// Camp colours for the Roles tab columns: the game's camp palette —
// --color-consultation-bg #800020 (vice) / --color-consultation-fg #000080
// (virtue), the same as the head icons' discs — with the light tints used for
// the camp headings. (Medallion rims are gold for both camps.)
const CAMP_STYLE = {
  vice: { light: "#e6889a", wash: "rgba(128,0,32,.45)", border: "rgba(230,136,154,.5)" },
  virtue: { light: "#9a9ce0", wash: "rgba(16,24,150,.42)", border: "rgba(154,156,224,.5)" },
} as const;
// Gold bevel for every head medallion (--color-gold #e3b510), muted for locked.
const RIM_GOLD = "linear-gradient(150deg, #fff3c4 0%, #e3b510 46%, rgba(0,0,0,.6) 135%)";
const RIM_GOLD_LOCKED = "linear-gradient(150deg, #d8cdb4 0%, #a8862a 46%, rgba(0,0,0,.6) 135%)";

function RolesSection({
  meId,
  econ,
  onUnlocked,
}: {
  meId: string;
  econ: AccountEconomy | null;
  onUnlocked: () => void;
}) {
  // Tap toggles the overlay on touch devices; hover handles it on desktop.
  const [open, setOpen] = useState<string | null>(null);
  // Your wins per role (role id → wins), for the per-character badge progress
  // shown in each role's popup.
  const [winsByRole, setWinsByRole] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let active = true;
    getUserStats(meId)
      .then((s) => {
        if (active) setWinsByRole(new Map(s.perRole.map((r) => [r.role, r.won])));
      })
      .catch(() => {
        /* non-critical — the widget just shows 0 progress */
      });
    return () => {
      active = false;
    };
  }, [meId]);
  // Locked-role unlock modal + its in-flight state.
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // Camp roles for the owned/locked split. Anomalies get their own row, and
  // FILLERS (Vice Worshipper / Virtue Seeker) are excluded entirely: they
  // belong to no class, aren't unlockable, and are documented in How to play.
  const all = Object.values(ROLES).filter((r) => !r.anomaly && !r.filler);
  // Anomaly roles (the Wandering Soul, more later) — shown as their own row of
  // icon badges beneath the camps.
  const anomalies = Object.values(ROLES).filter((r) => r.anomaly);
  // Owned vs locked (a role not in your unlock set is locked). While econ is
  // still loading, fall back to the default starter set.
  const ownedSet = new Set(econ?.unlockedRoles ?? DEFAULT_UNLOCKED_ROLES);
  const owned = all.filter((r) => ownedSet.has(r.id));
  const locked = all.filter((r) => !ownedSet.has(r.id));
  const le = econ?.le ?? 0;
  const sel = open ? ROLES[open] : null; // tapped owned role → mobile popup
  const unlockRole = unlockId ? ROLES[unlockId] : null;
  const unlockCost = unlockRole ? roleUnlockCost() : 0;

  async function doUnlock() {
    if (!unlockRole || unlockBusy) return;
    setUnlockBusy(true);
    setUnlockError(null);
    try {
      const res = await unlockRoleWithLe(unlockRole.id);
      if (res.ok) {
        setUnlockId(null);
        onUnlocked(); // refresh econ → the role moves to the owned table
      } else {
        setUnlockError(
          res.reason === "insufficient"
            ? `Not enough ${LE_ABBR}.`
            : res.reason === "owned"
              ? "You already own this role."
              : "Couldn't unlock that role."
        );
      }
    } catch {
      setUnlockError("Couldn't unlock. Try again.");
    } finally {
      setUnlockBusy(false);
    }
  }

  // An owned role: compact head-icon medallion — the hand-drawn head on its
  // camp disc, in a gold bevelled rim. Click opens the full-card popup.
  function medallion(r: RoleDef) {
    return (
      <motion.button
        key={r.id}
        type="button"
        onClick={() => setOpen(r.id)}
        whileHover={{ scale: 1.1, y: -2 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="group flex w-16 flex-col items-center gap-1 lg:w-20"
      >
        {/* Bevelled gold rim catching the light at the top-left, falling to
            shadow at the bottom-right. */}
        <span
          className="relative block h-14 w-14 rounded-full p-[3px] shadow-[0_2px_6px_rgba(0,0,0,.45)] transition-shadow duration-200 group-hover:shadow-[0_0_16px_rgba(227,181,16,.55)] lg:h-16 lg:w-16"
          style={{ background: RIM_GOLD }}
        >
          {/* Thin gold seam between the rim and the recessed disc. */}
          <span className="relative block h-full w-full overflow-hidden rounded-full border border-gold/45">
            <span
              aria-hidden
              className="absolute inset-0"
              style={{ background: "radial-gradient(circle at 50% 38%, #3c2b18 0%, #1b130a 100%)" }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/role-icons/${r.id}.png`}
              alt={r.name}
              className="relative h-full w-full object-contain"
              // A role whose art hasn't been drawn yet (new roles land in the
              // data before their icons) would otherwise show a broken image.
              // Hide it and let the recessed disc + the name label carry it.
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
          </span>
        </span>
        <span className="w-full truncate text-center text-[10px] leading-tight text-cream/75 lg:text-[11px]">{r.name}</span>
      </motion.button>
    );
  }

  // A locked role: the same head-icon medallion as owned roles, but greyscaled
  // with a lock overlay. Click opens the unlock modal (which shows the full
  // card art + price + unlock button).
  function lockedMedallion(r: RoleDef) {
    return (
      <motion.button
        key={r.id}
        type="button"
        onClick={() => {
          setUnlockError(null);
          setUnlockId(r.id);
        }}
        whileHover={{ scale: 1.1, y: -2 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="group flex w-16 flex-col items-center gap-1 lg:w-20"
      >
        {/* Same bevelled rim as owned, muted so it reads as locked. */}
        <span
          className="relative block h-14 w-14 rounded-full p-[3px] shadow-[0_2px_6px_rgba(0,0,0,.45)] transition-shadow duration-200 group-hover:shadow-[0_0_16px_rgba(227,181,16,.45)] lg:h-16 lg:w-16"
          style={{ background: RIM_GOLD_LOCKED }}
        >
          <span className="relative block h-full w-full overflow-hidden rounded-full border border-gold/35">
            <span
              aria-hidden
              className="absolute inset-0"
              style={{ background: "radial-gradient(circle at 50% 38%, #2a2018 0%, #140d07 100%)" }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/role-icons/${r.id}.png`}
              alt={r.name}
              className="relative h-full w-full object-contain opacity-45 grayscale"
              // Same fallback as the owned medallion — a role without art yet
              // shows the disc + lock rather than a broken image.
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            {/* lock overlay */}
            <span className="absolute inset-0 flex items-center justify-center bg-black/40">
              <IconLock size={18} className="text-cream/90 drop-shadow" aria-hidden />
            </span>
          </span>
        </span>
        <span className="w-full truncate text-center text-[10px] leading-tight text-cream/55 lg:text-[11px]">{r.name}</span>
      </motion.button>
    );
  }

  // An anomaly role: a soul-tinted icon badge (no tier ring — anomalies sit
  // outside the tier system) from its role-icon. Click opens the same card
  // popup as the camp roles. Multiple fit on the row via flex-wrap.
  function anomalyMedallion(r: RoleDef) {
    // Anomalies are purchasable too now (the Game Master, migration 119), so an
    // unowned one greys out and routes to the unlock modal rather than the card
    // popup — same behaviour as a locked camp role.
    const isOwned = ownedSet.has(r.id);
    return (
      <motion.button
        key={r.id}
        type="button"
        onClick={() => {
          if (isOwned) {
            setOpen(r.id);
          } else {
            setUnlockError(null);
            setUnlockId(r.id);
          }
        }}
        whileHover={{ scale: 1.1, y: -2 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className="group flex w-16 flex-col items-center gap-1 lg:w-20"
      >
        <span className="relative">
          <RoleIcon
            roleId={r.id}
            camp="neutral"
            className={`h-14 w-14 lg:h-16 lg:w-16 ${isOwned ? "" : "opacity-45 grayscale"}`}
          />
          {!isOwned && (
            <span className="absolute inset-0 flex items-center justify-center">
              <IconLock size={16} className="text-cream/90 drop-shadow" aria-hidden />
            </span>
          )}
        </span>
        <span
          className={`w-full truncate text-center text-[10px] leading-tight lg:text-[11px] ${isOwned ? "text-cream/75" : "text-cream/55"}`}
        >
          {r.name}
        </span>
      </motion.button>
    );
  }

  // Two vertical columns, Vice | Virtue, each a camp-tinted plaque. Inside a
  // column every class (Exterminators, Troublemakers, ...) gets its name
  // above its own group of medallions; classes with no roles in this set are
  // skipped. Used for both the owned and the locked roles.
  function columns(roles: RoleDef[], renderCard: (r: RoleDef) => ReactNode, emptyText: string) {
    const camps = [
      { camp: "vice" as const, title: "Vice", classes: CLASS_PAIRS.map(([v]) => v) },
      { camp: "virtue" as const, title: "Virtue", classes: CLASS_PAIRS.map(([, t]) => t) },
    ];
    return (
      <div className="mt-4 grid grid-cols-2 gap-2.5 lg:gap-4">
        {camps.map(({ camp, title, classes }) => {
          const c = CAMP_STYLE[camp];
          const groups = classes
            .map((cls) => ({ cls, list: roles.filter((r) => r.roleClass === cls) }))
            .filter((g) => g.list.length > 0);
          return (
            <motion.div
              key={camp}
              variants={fadeUp}
              className="relative overflow-hidden rounded-xl border-2 px-1.5 py-2.5 lg:p-3"
              style={{ ...plaqueStyle(), borderColor: c.border }}
            >
              {/* Wooden plaque base (homepage button material) with the
                  translucent camp wash layered on top. */}
              <PlaqueLayers />
              <span aria-hidden className="absolute inset-0" style={{ background: c.wash }} />
              <div className="relative">
                <h3
                  className={`text-center text-xl font-bold tracking-wide lg:text-2xl ${heading}`}
                  style={{ color: c.light }}
                >
                  {title}
                </h3>
                <div aria-hidden className="mx-auto mt-1 h-px w-2/3" style={{ background: c.border }} />
                {groups.length === 0 ? (
                  <p className="mt-3 text-center text-xs text-cream/55">{emptyText}</p>
                ) : (
                  <div className="mt-2.5 flex flex-col gap-3.5">
                    {groups.map(({ cls, list }) => (
                      <div key={cls}>
                        <p
                          className={`mb-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-cream/80 lg:text-[11px] ${heading}`}
                        >
                          {ROLE_CLASSES[cls].label}
                        </p>
                        <div className="flex flex-wrap justify-center gap-x-2 gap-y-2 lg:gap-x-2.5">
                          {list.map(renderCard)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    );
  }

  return (
    <motion.div className="mx-auto max-w-5xl" initial="hidden" animate="show" variants={staggerContainer}>
      <motion.div variants={fadeUp}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className={`text-3xl font-bold tracking-wide text-gold ${heading}`}>Roles</h1>
          <div className="flex items-center gap-1.5">
            <span className={`rounded-full border border-gold/50 bg-panel px-3 py-1 text-xs font-semibold text-gold ${heading}`}>
              {owned.length} owned
            </span>
            <span className={`rounded-full border border-cream/25 bg-panel px-3 py-1 text-xs font-semibold text-cream/60 ${heading}`}>
              {locked.length} locked
            </span>
          </div>
        </div>
      </motion.div>

      {/* Roles you already own — compact head-icon medallions. */}
      {columns(owned, medallion, "None yet")}

      {/* Roles you haven't unlocked yet — greyed + locked; tap to unlock. */}
      {locked.length > 0 && (
        <>
          <motion.div variants={fadeUp} className="mt-7 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className={`text-xl font-semibold tracking-wide text-gold ${heading}`}>Locked roles</h2>
            <span className="text-xs text-cream/55">
              Tap a role to unlock it &mdash; price scales with its tier
            </span>
          </motion.div>
          {columns(locked, lockedMedallion, "All unlocked")}
        </>
      )}

      {/* Anomaly roles — a row of icon badges (multiple fit via flex-wrap);
          each opens its card + description + wins in the popup below. */}
      {anomalies.length > 0 && (
        <motion.div variants={fadeUp} className="mt-7">
          <h2
            className={`text-xl font-semibold tracking-wide ${heading}`}
            style={{ color: "#7de0f0", textShadow: "0 0 12px rgba(125,224,240,.35)" }}
          >
            Anomaly
          </h2>
          <p className="text-xs text-cream/55">
            Neutral roles dealt on odd player counts &mdash; they belong to no camp.
          </p>
          <div
            className="mt-2 flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-xl border-2 border-soul/40 bg-[#0d1c20]/70 p-3"
            style={{ boxShadow: "0 6px 18px rgba(0,0,0,.35), 0 0 14px rgba(125,224,240,.22)" }}
          >
            {anomalies.map(anomalyMedallion)}
          </div>
        </motion.div>
      )}

      {/* Tap/click an OWNED medallion → the full card art with its details on
          a semi-transparent panel over it. */}
      {sel && (
        <RoleCardPopup role={sel} onClose={() => setOpen(null)}>
          <div className={`text-xl font-semibold tracking-wide text-gold ${heading}`}>{sel.name}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-gold/40 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cream/85">
              {sel.camp === "vice" ? "Vice" : sel.camp === "neutral" ? "Anomaly" : "Virtue"}
            </span>
            {!sel.anomaly && (
              <span className="rounded-full border border-gold/40 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cream/85">
                {sel.roleClass ? ROLE_CLASSES[sel.roleClass].label : "Filler"}
              </span>
            )}
            <span className="rounded-full border border-gold/40 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cream/85">
              <SoulEnergyText>{sel.cost}</SoulEnergyText>
            </span>
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-cream/95"><SoulEnergyText>{sel.description}</SoulEnergyText></p>
          {/* This character's win-badge progress (every role, incl. the
              anomaly Wandering Soul, has the per-tier matrix). */}
          <div className="mt-3 border-t border-gold/20 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-cream/65">Your wins as {sel.name}</div>
            <div className="mt-2">
              <BadgeProgressStrip progress={roleBadgeProgress(sel.id, winsByRole.get(sel.id) ?? 0)} />
            </div>
          </div>
        </RoleCardPopup>
      )}

      {/* Unlock modal for a locked role: the same full-card view, with the
          balance + Unlock button pinned under the details. */}
      {unlockRole && (
        <RoleCardPopup
          role={unlockRole}
          locked
          onClose={() => setUnlockId(null)}
          footer={
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-cream/75">Your balance</span>
                <span className="font-semibold text-gold">
                  {le} {LE_ABBR}
                </span>
              </div>
              {unlockError && (
                <p className="mt-2 text-xs font-medium text-red-300">{unlockError}</p>
              )}
              <button
                onClick={doUnlock}
                disabled={unlockBusy || le < unlockCost}
                className="mt-2.5 w-full rounded-lg bg-gold py-2.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {unlockBusy ? "Unlocking…" : `Unlock for ${unlockCost} ${LE_ABBR}`}
              </button>
              {le < unlockCost && (
                <p className="mt-1.5 text-center text-[11px] text-cream/60">
                  You need {unlockCost - le} more {LE_ABBR}.
                </p>
              )}
            </>
          }
        >
          <div className={`text-xl font-semibold tracking-wide text-gold ${heading}`}>{unlockRole.name}</div>
          <div className="text-xs uppercase tracking-wide text-cream/75">
            {unlockRole.camp === "vice" ? "Vice" : unlockRole.camp === "neutral" ? "Anomaly" : "Virtue"}
            {" · "}
            {unlockRole.anomaly ? "Neutral" : unlockRole.roleClass ? ROLE_CLASSES[unlockRole.roleClass].label : "Filler"}
            {" · "}
            <SoulEnergyText>{unlockRole.cost}</SoulEnergyText>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-cream/95"><SoulEnergyText>{unlockRole.description}</SoulEnergyText></p>
          {/* This character's win-badge progress. */}
          <div className="mt-3 border-t border-gold/20 pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-cream/65">Your wins as {unlockRole.name}</div>
            <div className="mt-2">
              <BadgeProgressStrip progress={roleBadgeProgress(unlockRole.id, winsByRole.get(unlockRole.id) ?? 0)} />
            </div>
          </div>
        </RoleCardPopup>
      )}
    </motion.div>
  );
}

// A role's popup in the Roles tab: the whole card art (2:3, sized to fit the
// screen) with the details on a semi-transparent panel over its lower part, so
// the art stays visible behind the text. The panel scrolls when a description
// is long; `footer` (the unlock button) stays pinned under it.
function RoleCardPopup({
  role,
  onClose,
  locked = false,
  footer,
  children,
}: {
  role: RoleDef;
  onClose: () => void;
  locked?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const border = role.camp === "vice" ? "#9b2741" : role.camp === "neutral" ? "#2f9fb0" : "#3a49b8";
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        {/* Breathing gold aura behind the card (owned roles only). */}
        {!locked && <span className="card-aura absolute -inset-6" aria-hidden />}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="relative aspect-[2/3] overflow-hidden rounded-2xl border-2 text-cream shadow-2xl"
          style={{
            width: "min(26rem, calc(100vw - 2rem), calc((100dvh - 2rem) * 2 / 3))",
            borderColor: border,
            background: plaqueStyle(true).background,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/cards/${role.id}.png`}
            alt={role.name}
            className="absolute inset-0 h-full w-full object-cover"
            // A role without card art yet keeps the plaque background.
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
          />
          {locked && (
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-cream">
              <IconLock size={13} aria-hidden /> Locked
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-cream"
          >
            <IconX size={18} aria-hidden />
          </button>
          {/* Semi-transparent details panel over the lower part of the art. */}
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[70%] flex-col"
            style={{
              background:
                "linear-gradient(to top, rgba(18,12,6,.82) 0%, rgba(18,12,6,.66) calc(100% - 28px), rgba(18,12,6,0) 100%)",
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-7 [text-shadow:0_1px_2px_rgba(0,0,0,.7)]">
              {children}
            </div>
            {footer && <div className="shrink-0 border-t border-gold/25 bg-black/35 px-4 py-3">{footer}</div>}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function FriendAvatar({ p }: { p: Profile }) {
  return (
    <CharacterAvatar
      character={p.appearance}
      initials={p.username.slice(0, 2).toUpperCase()}
      className="h-9 w-9"
      textClass="text-xs"
    />
  );
}

function FriendsSection({ meId }: { meId: string }) {
  const [data, setData] = useState<FriendData | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getFriendData(meId));
    } catch {
      /* non-critical */
    }
  }, [meId]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<void>) {
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    }
  }
  async function onSearch(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      setResults(await searchUsers(query, meId));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Search failed.");
    }
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?invite=${meId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked */
    }
  }

  const friendIds = new Set(data?.friends.map((f) => f.profile.id));
  const outgoingIds = new Set(data?.outgoing.map((r) => r.profile.id));
  const incomingById = new Map(data?.incoming.map((r) => [r.profile.id, r.friendshipId]));

  return (
    <div className="mx-auto max-w-4xl">
      {err && <p className="mb-3 text-sm text-red-300">{err}</p>}
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* Friends list */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-cream/55">
            Your friends{data ? ` · ${data.friends.length}` : ""}
          </div>
          {data && data.friends.length > 0 ? (
            <div className="flex flex-col">
              {data.friends.map((f) => (
                <div key={f.friendshipId} className="flex items-center gap-3 border-b border-gold/12 py-2.5">
                  <Link href={`/profile/${f.profile.id}`} className="min-w-0 flex-1 hover:opacity-80">
                    {/* The friend's in-game banner with a games-played-together
                        chip (icon + number) overlaid on its top-right corner. */}
                    <span className="relative block w-full">
                      <Banner
                        name={f.profile.username}
                        character={f.profile.appearance}
                        initials={f.profile.username.charAt(0).toUpperCase()}
                        featuredBadges={f.profile.featured_badges}
                        nameColor={f.profile.name_color}
                        bannerColor={f.profile.banner_color}
                        fullWidth
                      />
                      <span
                        className="absolute -right-1.5 -top-1.5 inline-flex items-center gap-1 rounded-full border border-gold/60 bg-home-bg/90 px-1.5 py-0.5 text-[11px] font-semibold text-cream shadow-[0_1px_4px_rgba(0,0,0,.5)]"
                        title="Games played together"
                      >
                        <IconDeviceGamepad2 size={12} aria-hidden /> {f.gamesTogether}
                      </span>
                    </span>
                  </Link>
                  <button
                    onClick={() => act(() => removeFriendship(f.friendshipId))}
                    className="shrink-0 rounded-lg border border-gold/40 px-2.5 py-1 text-xs text-cream/80 transition-colors hover:bg-cream/10"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-cream/50">No friends yet — add some on the right.</p>
          )}
        </div>

        {/* Add + requests */}
        <div className="flex flex-col gap-4">
          <form onSubmit={onSearch} className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add by username"
              className="flex-1 rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
            />
            <button type="submit" className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90">
              Search
            </button>
          </form>
          <button
            onClick={copyInvite}
            className="rounded-lg border border-gold px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            {copied ? "Invite link copied!" : "Copy invite link"}
          </button>

          {results !== null && (
            <div className="flex flex-col gap-1.5">
              {results.length === 0 ? (
                <p className="text-sm text-cream/50">No players found.</p>
              ) : (
                results.map((p) => {
                  const inc = incomingById.get(p.id);
                  return (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg border border-gold/20 bg-cream/5 px-3 py-2">
                      <FriendAvatar p={p} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.username}</span>
                      {friendIds.has(p.id) ? (
                        <span className="text-xs text-cream/50">Friends</span>
                      ) : outgoingIds.has(p.id) ? (
                        <span className="text-xs text-cream/50">Requested</span>
                      ) : inc ? (
                        <button onClick={() => act(() => acceptRequest(inc))} className="rounded-lg bg-gold px-3 py-1 text-xs font-semibold text-home-bg">
                          Accept
                        </button>
                      ) : (
                        <button onClick={() => act(() => sendFriendRequest(meId, p.id))} className="rounded-lg bg-gold px-3 py-1 text-xs font-semibold text-home-bg">
                          Add
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {data && data.incoming.length > 0 && (
            <div className="rounded-xl border border-gold/28 bg-cream/5 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-cream/55">
                Requests · {data.incoming.length}
              </div>
              <div className="flex flex-col gap-2">
                {data.incoming.map((r) => (
                  <div key={r.friendshipId} className="flex items-center gap-3">
                    <FriendAvatar p={r.profile} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.profile.username}</span>
                    <button onClick={() => act(() => acceptRequest(r.friendshipId))} className="rounded-lg bg-gold px-3 py-1 text-xs font-semibold text-home-bg">
                      Accept
                    </button>
                    <button
                      onClick={() => act(() => removeFriendship(r.friendshipId))}
                      aria-label="Decline"
                      className="rounded-lg p-1.5 text-cream/50 transition-colors hover:bg-cream/10 hover:text-cream"
                    >
                      <IconX size={16} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Small shared bits ----

function HudIcon({ label, onClick, badge, children, state }: { label: string; onClick: () => void; badge?: string | null; children: ReactNode; state?: "available" | "done" }) {
  // `state` makes a claim/earn icon read at a glance: "available" → bright gold
  // outline + glow; "done" → greyed. Undefined keeps the neutral default.
  const ring =
    state === "available"
      ? "border-2 border-gold text-gold shadow-[0_0_10px_rgba(227,181,16,.5)]"
      : state === "done"
        ? "border border-cream/15 text-cream/35"
        : "border border-gold/50 text-cream";
  return (
    <button onClick={onClick} aria-label={label} className={`relative flex h-10 w-10 items-center justify-center rounded-lg bg-panel transition-colors hover:bg-cream/10 ${ring}`}>
      {children}
      {badge && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-home-bg bg-gold px-1 text-[10px] font-semibold text-home-bg">
          {badge}
        </span>
      )}
    </button>
  );
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

// Under your character: "Select game mode" + "Play". While a search runs the
// pair is replaced by the search (timer, queue size, cancel).
function PlayControls({
  mode,
  mm,
  busy,
  classPref,
  leaderName,
  onSelectMode,
  onPlay,
  onEditClasses,
}: {
  mode: QueueKind;
  mm: Matchmaking;
  busy: boolean;
  classPref: ClassPreference;
  leaderName: string | null;
  onSelectMode: () => void;
  onPlay: () => void;
  onEditClasses: () => void;
}) {
  if (mm.searching) {
    const kind = mm.activeKind ?? mode;
    const pastPatience = mm.elapsedMs >= QUEUE_PATIENCE_MS;
    return (
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="relative mx-auto mt-6 max-w-md overflow-hidden rounded-xl border-2 border-gold/60 p-4 text-center"
        style={plaqueStyle(true)}
      >
        <PlaqueLayers />
        <div className="relative">
          <div className={`text-xs font-semibold uppercase tracking-widest text-gold ${heading}`}>
            Searching · {MODE_LABEL[kind]}
          </div>
          <div className="mt-1 text-4xl font-bold tabular-nums text-cream">{formatElapsed(mm.elapsedMs)}</div>
          <div className="mt-1 text-xs text-cream/70">
            <strong className="text-cream">{mm.waiting}</strong> waiting
            {mm.needed > 0 ? (
              <>
                {" · needs "}
                <strong className="text-cream">{mm.needed}</strong> more
              </>
            ) : (
              " · starting now"
            )}
          </div>
          {(kind === "ranked" || pastPatience) && (
            <p className="mx-auto mt-2 max-w-sm text-[11px] leading-relaxed text-cream/55">
              {kind === "public"
                ? "Not enough players yet — bots are taking the empty seats so your game can start."
                : pastPatience
                  ? "You've waited long enough that we'll now place you in any free class to get a game started."
                  : "Holding out for the classes you picked. After a minute we'll place you anywhere free so you're not stuck waiting."}
            </p>
          )}
          <button
            onClick={() => void mm.cancel()}
            className="mt-3 rounded-lg border border-gold/50 px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-gold/10"
          >
            Cancel search
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeUp} className="mx-auto mt-6 max-w-md lg:mt-8 lg:max-w-4xl">
      {/* Mobile: mode + classes side by side, Play full width under them.
          Desktop: one row, mode · classes · Play. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1.15fr_1fr] lg:gap-4">
        <motion.button
          type="button"
          onClick={onSelectMode}
          disabled={busy || !!leaderName}
          whileHover={busy || leaderName ? undefined : { y: -3 }}
          whileTap={busy || leaderName ? undefined : { scale: 0.98 }}
          transition={{ type: "spring", stiffness: 380, damping: 24 }}
          className="group relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-gold/45 px-3 py-3 disabled:opacity-50 lg:py-4"
          style={plaqueStyle()}
        >
          <PlaqueLayers shine />
          <span className="relative text-[10px] font-semibold uppercase tracking-widest text-cream/55 lg:text-[11px]">Game mode</span>
          <span className={`relative mt-0.5 text-center text-base font-semibold tracking-wide text-cream sm:text-lg lg:text-xl ${heading}`}>{MODE_LABEL[mode]}</span>
          <span className="relative mt-1 max-w-full truncate text-[10px] font-semibold text-gold/80 lg:text-[11px]">
            {leaderName ? `Picked by ${leaderName}` : "Change"}
          </span>
        </motion.button>

        <ClassesButton classPref={classPref} disabled={busy} onClick={onEditClasses} />

        {leaderName ? (
          // A party member waits for the leader to start.
          <div
            className={`col-span-2 flex flex-col items-center justify-center rounded-xl border-2 border-gold/30 bg-black/25 px-3 py-3 text-center lg:col-span-1 ${heading}`}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-cream/55 lg:text-[11px]">In a party</span>
            <span className="mt-0.5 max-w-full truncate text-base font-semibold text-cream lg:text-lg">Waiting for {leaderName}</span>
          </div>
        ) : (
          <motion.button
            type="button"
            onClick={onPlay}
            disabled={busy}
            whileHover={busy ? undefined : { y: -3, scale: 1.02 }}
            whileTap={busy ? undefined : { scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className={`col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gold px-3 py-3.5 text-2xl font-bold tracking-wide text-home-bg shadow-[0_0_18px_rgba(227,181,16,.4)] transition-shadow hover:shadow-[0_0_28px_rgba(227,181,16,.6)] disabled:opacity-50 disabled:shadow-none lg:col-span-1 lg:text-3xl ${heading}`}
          >
            <IconPlayerPlay size={26} aria-hidden /> Play
          </motion.button>
        )}
      </div>
      {mm.error && <p className="mt-2 text-center text-sm text-red-300">{mm.error}</p>}
    </motion.div>
  );
}

// The class picks you queue with, one per camp — a button so it reads as a
// setting you can change, with each pick in its camp's colour.
const CAMP_CHIP = {
  vice: { label: "Vice", bg: "rgba(128,0,32,.55)", border: "rgba(230,136,154,.55)", text: "#f6c9d2", tag: "#e6889a" },
  virtue: { label: "Virtue", bg: "rgba(0,0,128,.5)", border: "rgba(154,156,224,.55)", text: "#d6d7fa", tag: "#9a9ce0" },
} as const;

function ClassesButton({
  classPref,
  disabled,
  onClick,
}: {
  classPref: ClassPreference;
  disabled: boolean;
  onClick: () => void;
}) {
  const chip = (camp: "vice" | "virtue") => {
    const c = CAMP_CHIP[camp];
    return (
      <span
        className="flex min-w-0 flex-1 flex-col items-center rounded-lg border px-1.5 py-0.5 lg:px-2.5 lg:py-1.5"
        style={{ background: c.bg, borderColor: c.border }}
      >
        <span className="text-[8px] font-bold uppercase leading-tight tracking-widest lg:text-[10px]" style={{ color: c.tag }}>
          {c.label}
        </span>
        <span className="max-w-full truncate text-xs font-semibold leading-tight lg:text-sm" style={{ color: c.text }}>
          {ROLE_CLASSES[classPref[camp]].label}
        </span>
      </span>
    );
  };
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -3 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 24 }}
      aria-label={`Your classes: ${ROLE_CLASSES[classPref.vice].label} and ${ROLE_CLASSES[classPref.virtue].label}. Change`}
      className="group relative flex flex-col items-stretch justify-center overflow-hidden rounded-xl border-2 border-gold/45 px-2.5 py-2.5 disabled:opacity-50 lg:px-3 lg:py-3"
      style={plaqueStyle()}
    >
      <PlaqueLayers shine />
      <span className="relative flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-cream/55 lg:text-[11px]">
        <IconAdjustmentsHorizontal size={13} aria-hidden /> Your classes
      </span>
      <span className="relative mt-1.5 flex flex-col gap-1 lg:flex-row lg:gap-2">
        {chip("vice")}
        {chip("virtue")}
      </span>
    </motion.button>
  );
}

// Logged out: playing needs an account, so this takes the place of the Play
// controls.
function SignUpPrompt({ onSignUp, onLogIn }: { onSignUp: () => void; onLogIn: () => void }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="relative mx-auto mt-6 max-w-md overflow-hidden rounded-xl border-2 border-gold/60 p-5 text-center lg:mt-8 lg:max-w-xl lg:p-6"
      style={plaqueStyle(true)}
    >
      <PlaqueLayers />
      <div className="relative">
        <h2 className={`text-xl font-semibold tracking-wide text-gold lg:text-2xl ${heading}`}>Create an account to play</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-cream/70">
          It&rsquo;s free and takes a minute. Your account keeps your level, stats, badges and friends, and lets
          you play with a party.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <motion.button
            type="button"
            onClick={onSignUp}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className={`rounded-xl bg-gold px-4 py-3 text-lg font-bold tracking-wide text-home-bg shadow-[0_0_18px_rgba(227,181,16,.35)] ${heading}`}
          >
            Sign up
          </motion.button>
          <motion.button
            type="button"
            onClick={onLogIn}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className={`rounded-xl border-2 border-gold/60 px-4 py-3 text-lg font-semibold tracking-wide text-cream transition-colors hover:bg-gold/10 ${heading}`}
          >
            Log in
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function Overlay({ onClose, dismissable = true, wide = false, children }: { onClose: () => void; dismissable?: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={dismissable ? onClose : undefined}>
      <div className={`relative w-full ${wide ? "max-w-lg" : "max-w-sm"} rounded-2xl border border-gold/55 bg-home-bg p-5`} onClick={(e) => e.stopPropagation()}>
        {dismissable && (
          <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-cream/70 transition-colors hover:text-cream">
            <IconX size={20} aria-hidden />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
