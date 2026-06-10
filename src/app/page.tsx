"use client";

// The start-screen "hub": a desktop-sidebar / mobile-bottom-nav shell with a
// top HUD (currencies, Soul Shards, daily reward, account/level) and in-hub
// sections — Play, Roles, Shop. Friends + Profile route to their full pages;
// Ranked routes to the /ranked queue. Soul Shards / Daily / Join are modals.
// Season pass, the cosmetics Shop, and Settings are honest "coming soon"
// placeholders (no backend yet). Guests can still Quick play / Join by code;
// everything account-bound prompts a login.

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  IconBolt,
  IconDiamond,
  IconDiamonds,
  IconGift,
  IconTrophy,
  IconSettings,
  IconSparkles,
  IconX,
  IconUsersPlus,
  IconTicket,
  IconChevronRight,
} from "@tabler/icons-react";
import { createRoom, joinRoom, findOrCreatePublicRoom } from "@/lib/room";
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
  getStoredPlayerName,
  setStoredPlayerId,
  setStoredPlayerName,
} from "@/lib/player";
import { useAuth } from "@/lib/useAuth";
import { signOut } from "@/lib/auth";
import {
  awardAchievement,
  getEarnedBadges,
  getAccountOlderCount,
} from "@/lib/achievements";
import { getUserStats, type UserStats } from "@/lib/stats";
import type { Profile } from "@/lib/types";
import {
  getMyEconomy,
  openSoulShard,
  claimDailyLogin,
  unlockRoleWithLe,
  levelFromXp,
  LE_ABBR,
  MANO_NAME,
  ROLE_UNLOCK_COST,
  DEFAULT_UNLOCKED_ROLES,
  type AccountEconomy,
  type ShardReward,
} from "@/lib/economy";
import { getMyRanked, tierKey, tierName, type RankedState } from "@/lib/ranked";
import { TIER_META } from "@/lib/badges";
import { ROLES, type RoleDef } from "@/lib/roles";
import { RulesGuide } from "@/components/RulesGuide";
import { AuthModal } from "@/components/AuthModal";
import { ProfileStats } from "@/components/ProfileStats";
import { BadgesShowcase } from "@/components/BadgesShowcase";
import { RankPanel } from "@/components/RankPanel";
import { Leaderboard, LeaderboardModal } from "@/components/Leaderboard";

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
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showRules, setShowRules] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [modal, setModal] = useState<"shards" | "daily" | "settings" | "join" | null>(null);

  // Auth modal (login gate). `authMsg` explains why it opened.
  const [authOpen, setAuthOpen] = useState(false);
  const [authMsg, setAuthMsg] = useState<string | undefined>(undefined);

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

  // Shard-open + daily state.
  const [shardBusy, setShardBusy] = useState(false);
  const [shardReward, setShardReward] = useState<ShardReward | null>(null);
  const [dailyBusy, setDailyBusy] = useState(false);


  useEffect(() => {
    setName(getStoredPlayerName());
    try {
      const raw = localStorage.getItem("vv_dismissed_friend_games");
      if (raw) setDismissedGames(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (profile) setName((n) => n || profile.username);
  }, [profile]);

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
    getMyEconomy().then((e) => active && setEcon(e)).catch(() => {});
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

  function gate(msg: string) {
    setAuthMsg(msg);
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
    if (!authLoading && !profile) return gate("You need an account to create a room. Joining a room is free.");
    const trimmed = name.trim();
    if (!trimmed) return setError("Please enter your name first.");
    setBusy(true);
    setError(null);
    try {
      const { room, player } = await createRoom(trimmed, profile?.id ?? null);
      setStoredPlayerName(trimmed);
      setStoredPlayerId(player.id);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function handleFindPublic() {
    const trimmed = name.trim();
    if (!trimmed) return setError("Please enter your name first.");
    setBusy(true);
    setError(null);
    try {
      const { code, playerId } = await findOrCreatePublicRoom(trimmed, profile?.id ?? null);
      setStoredPlayerName(trimmed);
      setStoredPlayerId(playerId);
      router.push(`/room/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function handleJoin() {
    const trimmed = name.trim();
    const code = joinCode.trim().toUpperCase();
    if (!trimmed) return setError("Please enter your name first.");
    if (!code) return setError("Please enter a room code.");
    setBusy(true);
    setError(null);
    try {
      const { room, player } = await joinRoom(code, trimmed, profile?.id ?? null);
      setStoredPlayerName(trimmed);
      setStoredPlayerId(player.id);
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function joinFriendLobby(code: string) {
    const trimmed = name.trim() || profile?.username || "";
    if (!trimmed) return setError("Please enter your name first.");
    setBusy(true);
    setError(null);
    try {
      const { room, player } = await joinRoom(code, trimmed, profile?.id ?? null);
      setStoredPlayerName(trimmed);
      setStoredPlayerId(player.id);
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

  async function openShard() {
    if (!econ || econ.unopened_shards <= 0 || shardBusy) return;
    setShardBusy(true);
    try {
      const r = await openSoulShard();
      if (r.kind !== "none") {
        setShardReward(r);
        const fresh = await getMyEconomy();
        if (fresh) setEcon(fresh);
      }
    } catch {
      /* ignore */
    } finally {
      setShardBusy(false);
    }
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
    <main className="wood-desk-startscreen min-h-screen bg-home-bg text-cream">
      {/* ---- Desktop sidebar (fixed: stays put while the page scrolls) ---- */}
      <aside className="hidden border-r border-gold/20 p-4 lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-56 lg:flex-col lg:gap-1 lg:overflow-y-auto">
        <div className="px-2 pb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png?v=3" alt="Vice and Virtue" className="h-auto w-32 max-w-full" />
        </div>
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              section === id ? "bg-gold/15 font-semibold text-gold" : "text-cream/70 hover:bg-cream/5"
            }`}
          >
            <Icon size={18} aria-hidden /> {label}
          </button>
        ))}
        <div className="mt-auto flex flex-col gap-1 pt-3">
          <button onClick={() => setShowLeaderboard(true)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-cream/70 transition-colors hover:bg-cream/5">
            <IconMedal size={18} aria-hidden /> Leaderboard
          </button>
          <button onClick={() => setShowRules(true)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-cream/70 transition-colors hover:bg-cream/5">
            <IconHelp size={18} aria-hidden /> How to play
          </button>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => profile && void awardAchievement("discord_joined")}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#9aa0f2] transition-colors hover:bg-cream/5"
          >
            <IconBrandDiscord size={18} aria-hidden /> Discord
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
        <header className="flex items-center gap-2 border-b border-gold/15 px-4 py-2.5">
          <span className="hidden text-base font-semibold lg:block">{sectionTitle}</span>
          {/* mobile account chip (left) */}
          {profile ? (
            <button onClick={() => go("profile")} className="lg:hidden" aria-label="Profile">
              <Avatar url={profile.avatar_url} initials={initials} />
            </button>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/logo.png?v=3" alt="Vice and Virtue" className="h-9 w-auto lg:hidden" />
          )}

          <div className="ml-auto flex items-center gap-2">
            {profile ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-black/25 px-2.5 py-1 text-xs" title="Life Proficiency">
                  <IconBolt size={14} className="text-gold" aria-hidden />
                  <span className="font-semibold text-gold">{econ?.le ?? 0}</span> {LE_ABBR}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-black/25 px-2.5 py-1 text-xs" title={MANO_NAME}>
                  <IconDiamond size={14} className="text-gold" aria-hidden />
                  <span className="font-semibold text-gold">{econ?.mano ?? 0}</span>
                </span>
                <HudIcon label="Soul Fragments" onClick={() => { setShardReward(null); setModal("shards"); }} badge={econ && econ.unopened_shards > 0 ? String(econ.unopened_shards) : null}>
                  <IconDiamonds size={17} aria-hidden />
                </HudIcon>
                <HudIcon label="Daily reward" onClick={() => setModal("daily")} badge={dailyClaimed ? null : "!"}>
                  <IconGift size={17} aria-hidden />
                </HudIcon>
                {/* desktop account chip */}
                <button onClick={() => go("profile")} className="hidden items-center gap-2 lg:flex">
                  <Avatar url={profile.avatar_url} initials={initials} />
                  <span className="text-left">
                    <span className="block text-xs font-semibold leading-tight">{profile.username}</span>
                    <span className="block text-[10px] text-cream/60">Lv {lvl?.level ?? 1}</span>
                  </span>
                </button>
                <HudIcon label="Settings" onClick={() => setModal("settings")}>
                  <IconSettings size={17} aria-hidden />
                </HudIcon>
              </>
            ) : (
              <button
                onClick={() => { setAuthMsg(undefined); setAuthOpen(true); }}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90"
              >
                Log in / Sign up
              </button>
            )}
          </div>
        </header>

        {/* Scrollable section content */}
        <div className="flex-1 px-5 py-6 pb-24 lg:pb-8">
          {section === "play" && (
            <PlaySection
              profile={!!profile}
              name={name}
              setName={setName}
              ranked={ranked}
              error={error}
              busy={busy}
              inviteMsg={inviteMsg}
              inviteFrom={inviteFrom}
              onInviteLogin={() => { setAuthMsg(undefined); setAuthOpen(true); }}
              surfaceGames={surfaceGames}
              onQuickPlay={handleFindPublic}
              onRanked={() => (profile ? router.push("/ranked") : gate("Log in or sign up to play Ranked."))}
              onWithFriends={handleCreate}
              onJoin={() => setModal("join")}
              onJoinFriend={joinFriendLobby}
              onDismissGame={dismissGame}
              onHowToPlay={() => setShowRules(true)}
              onLeaderboard={() => setShowLeaderboard(true)}
            />
          )}
          {section === "roles" && (
            <RolesSection
              econ={econ}
              onUnlocked={() => getMyEconomy().then(setEcon).catch(() => {})}
            />
          )}
          {section === "shop" && <ComingSoon title="Shop" note="Cosmetics, banners, name colors and Mano packs are on the way." />}
          {section === "profile" && profile && <ProfileSection profile={profile} econ={econ} />}
          {section === "friends" && profile && <FriendsSection meId={profile.id} />}
        </div>
      </div>

      {/* ---- Mobile bottom nav ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-gold/30 bg-[#3a281a] px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] ${
              section === id ? "text-gold" : "text-cream/60"
            }`}
          >
            <Icon size={21} aria-hidden /> {label}
          </button>
        ))}
      </nav>

      {/* ---- Modals ---- */}
      {modal === "shards" && (
        <Overlay onClose={() => setModal(null)}>
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-cream/55">Soul Fragments</div>
            <div
              className="mx-auto my-3 flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-gold text-cream"
              style={{ background: "linear-gradient(135deg,#7b4bb0,#3a1857)" }}
            >
              <IconDiamonds size={46} aria-hidden />
            </div>
            <p className="text-sm">
              <span className="font-semibold text-gold">{econ?.unopened_shards ?? 0}</span> unopened
            </p>
            <p className="mx-auto mt-1.5 max-w-xs text-xs text-cream/60">
              Each fragment grants XP, plus a chance at Mano or a rare role unlock.
            </p>
            {shardReward && shardReward.kind !== "none" && (
              <p className="mt-3 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm">
                {shardReward.kind === "le" && <>+{shardReward.amount} {LE_ABBR} &amp; +{shardReward.xp_gained} XP</>}
                {shardReward.kind === "mano" && <>+{shardReward.amount} {MANO_NAME} &amp; +{shardReward.xp_gained} XP</>}
                {shardReward.kind === "role" && <span className="text-gold">★ Unlocked {ROLES[shardReward.role]?.name ?? shardReward.role}!</span>}
              </p>
            )}
            <button
              onClick={openShard}
              disabled={!econ || econ.unopened_shards <= 0 || shardBusy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <IconSparkles size={17} aria-hidden /> {shardBusy ? "Opening…" : econ && econ.unopened_shards > 0 ? "Open a fragment" : "No fragments to open"}
            </button>
          </div>
        </Overlay>
      )}

      {modal === "daily" && (
        <Overlay onClose={() => setModal(null)}>
          <div className="text-center">
            <div className="text-xs font-semibold uppercase tracking-widest text-cream/55">Daily reward</div>
            <div
              className="mx-auto my-3 flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-gold text-gold"
              style={{ background: "rgba(0,0,0,.25)" }}
            >
              <IconGift size={38} aria-hidden />
            </div>
            <p className="mx-auto max-w-xs text-sm text-cream/80">
              Two ways to earn a Soul Fragment each day:
            </p>
            <div className="mx-auto mt-3 flex max-w-xs flex-col gap-2 text-left">
              <div className="flex items-center gap-3 rounded-xl border border-gold/30 bg-cream/5 px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-black/20 text-gold">
                  <IconGift size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-xs text-cream/80">Daily login</span>
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-xs font-semibold text-gold">
                  <IconDiamonds size={13} aria-hidden /> +1
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl border-2 border-gold bg-gold/10 px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-gold/20 text-gold">
                  <IconTrophy size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-xs font-semibold text-cream">First win of the day</span>
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-gold bg-gold px-2 py-0.5 text-xs font-bold text-home-bg">
                  <IconDiamonds size={13} aria-hidden /> +1
                </span>
              </div>
            </div>
            <button
              onClick={claimDaily}
              disabled={dailyBusy || dailyClaimed}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <IconGift size={17} aria-hidden />
              {dailyBusy ? "Claiming…" : dailyClaimed ? "Claimed — come back tomorrow" : "Claim today's Soul Fragment"}
            </button>
          </div>
        </Overlay>
      )}

      {modal === "settings" && (
        <Overlay onClose={() => setModal(null)}>
          <ComingSoon title="Settings" note="Account and game settings will live here." />
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
            {!profile && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={20}
                className="mb-2.5 w-full rounded-lg border border-gold bg-cream px-4 py-2.5 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
              />
            )}
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
            <p className="mt-2.5 text-xs text-cream/50">No account needed to join.</p>
          </div>
        </Overlay>
      )}

      {showRules && <RulesGuide onClose={() => setShowRules(false)} />}
      {showLeaderboard && (
        <LeaderboardModal meUserId={profile?.id} onClose={() => setShowLeaderboard(false)} />
      )}
      {authOpen && <AuthModal initialMode="signup" message={authMsg} onClose={() => setAuthOpen(false)} />}
    </main>
  );
}

// ---- Sections ----

function PlaySection(props: {
  profile: boolean;
  name: string;
  setName: (n: string) => void;
  ranked: RankedState | null;
  error: string | null;
  busy: boolean;
  inviteMsg: string | null;
  inviteFrom: { id: string; username: string } | null;
  onInviteLogin: () => void;
  surfaceGames: { roomId: string; code: string; name: string; players: number; invited: boolean }[];
  onQuickPlay: () => void;
  onRanked: () => void;
  onWithFriends: () => void;
  onJoin: () => void;
  onJoinFriend: (code: string) => void;
  onDismissGame: (roomId: string) => void;
  onHowToPlay: () => void;
  onLeaderboard: () => void;
}) {
  const rankMeta = props.ranked ? TIER_META[tierKey(props.ranked.tierIndex)] : null;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Friend-invite banner */}
      {(props.inviteMsg || (props.inviteFrom && !props.profile)) && (
        <div className="mb-4 rounded-xl border border-gold bg-home-bg/70 p-3 text-center text-sm">
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
        </div>
      )}

      <h1 className="text-xl font-semibold">Choose how to play</h1>
      <p className="mt-1 text-xs text-cream/70">6&ndash;20 players · about 30&ndash;45 minutes · 12 secret roles</p>

      {!props.profile && (
        <input
          value={props.name}
          onChange={(e) => props.setName(e.target.value)}
          placeholder="Your name"
          maxLength={20}
          className="mt-3 w-full max-w-xs rounded-lg border border-gold bg-cream px-4 py-2.5 text-home-bg placeholder:text-home-bg/40 focus:outline-none focus:ring-2 focus:ring-gold"
        />
      )}

      {/* Seasonal reward track — wide banner across the top */}
      <div className="mt-4 rounded-2xl border border-[#7678ed]/55 bg-cream/5 p-5">
        <div className="flex items-center gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2"
            style={{ borderColor: "#7678ed", background: "rgba(118,120,237,.18)", color: "#a9aaf0" }}
          >
            <IconSparkles size={26} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-[#7678ed]">Season 1 · Trials of Virtue</span>
              <span className="shrink-0 rounded-full border border-[#7678ed] px-2.5 py-0.5 text-[11px] text-[#a9aaf0]">Coming soon</span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-cream/15">
              <div className="h-full rounded-full" style={{ width: "45%", background: "#7678ed" }} />
            </div>
            <p className="mt-1.5 text-xs text-cream/60">A seasonal reward track — earn rewards as you play. Coming soon.</p>
          </div>
        </div>
      </div>

      {/* Mobile only: brand logo between the season banner and the gamemodes. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png?v=3"
        alt="Vice and Virtue"
        className="mx-auto mt-5 block h-auto w-40 max-w-full lg:hidden"
      />

      {/* Gamemodes — bigger 2×2 */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <PlayCard onClick={props.onQuickPlay} disabled={props.busy} accent title="Quick play" note="Jump into a public game" Icon={IconPlayerPlay} />
        <PlayCard
          onClick={props.onRanked}
          title="Ranked"
          note={props.ranked ? `${tierName(props.ranked.tierIndex)} · Div ${props.ranked.division} · 3v3 / 5v5` : "3v3 / 5v5 ladder"}
          emblem={
            rankMeta && props.ranked ? (
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full border-2 text-lg font-bold"
                style={{ background: rankMeta.gradient, borderColor: rankMeta.ring, color: rankMeta.text }}
              >
                {props.ranked.division}
              </span>
            ) : undefined
          }
        />
        <PlayCard onClick={props.onWithFriends} disabled={props.busy} title="With friends" note="Create a private lobby" Icon={IconUsersPlus} />
        <PlayCard onClick={props.onJoin} title="Join by code" note="No account needed" Icon={IconTicket} />
      </div>
      {props.error && <p className="mt-3 text-sm text-red-300">{props.error}</p>}

      {/* Friends' games */}
      {props.profile && props.surfaceGames.length > 0 && (
        <div className="mt-4 rounded-xl border border-gold/40 bg-cream/5 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-cream/55">Friends&rsquo; games</div>
          <ul className="flex flex-col gap-2">
            {props.surfaceGames.slice(0, 5).map((g) => (
              <li key={g.roomId} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-[#372155] text-[11px]">
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
        </div>
      )}

      {/* Quick links — the way to reach these on mobile (the sidebar is desktop only). */}
      <div className="mt-5 flex gap-2 lg:hidden">
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
      </div>

      {/* Privacy notice — reachable on mobile (the sidebar is desktop only). */}
      <p className="mt-4 text-center lg:hidden">
        <Link
          href="/privacy"
          className="text-xs text-cream/50 underline transition-colors hover:text-cream"
        >
          Privacy notice
        </Link>
      </p>
    </div>
  );
}

function RolesSection({
  econ,
  onUnlocked,
}: {
  econ: AccountEconomy | null;
  onUnlocked: () => void;
}) {
  // Tap toggles the overlay on touch devices; hover handles it on desktop.
  const [open, setOpen] = useState<string | null>(null);
  // Locked-role unlock modal + its in-flight state.
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // Per-tier: a translucent row tint + a solid colour for the left indicator.
  const band: Record<string, { bg: string; badge: string; text: string }> = {
    S: { bg: "rgba(233,198,74,.13)", badge: "#e9c64a", text: "#4e3624" },
    A: { bg: "rgba(123,75,176,.18)", badge: "#7b4bb0", text: "#fff" },
    B: { bg: "rgba(212,85,31,.15)", badge: "#d4551f", text: "#fff" },
    C: { bg: "rgba(79,157,79,.15)", badge: "#4f9d4f", text: "#fff" },
    D: { bg: "rgba(122,90,63,.18)", badge: "#7a5a3f", text: "#ffefc5" },
  };
  const tiers = ["S", "A", "B", "C", "D"];
  const all = Object.values(ROLES);
  // Owned vs locked (a role not in your unlock set is locked). While econ is
  // still loading, fall back to the default starter set.
  const ownedSet = new Set(econ?.unlockedRoles ?? DEFAULT_UNLOCKED_ROLES);
  const owned = all.filter((r) => ownedSet.has(r.id));
  const locked = all.filter((r) => !ownedSet.has(r.id));
  const le = econ?.le ?? 0;
  const sel = open ? ROLES[open] : null; // tapped owned role → mobile popup
  const unlockRole = unlockId ? ROLES[unlockId] : null;

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

  function card(r: RoleDef) {
    const vice = r.camp === "vice";
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => setOpen(r.id)}
        className="group relative block overflow-hidden rounded-lg border-2 bg-black/30 text-left"
        style={{ borderColor: vice ? "#9b2741" : "#3a49b8" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/cards/${r.id}.png`} alt={r.name} className="block w-full" />
        {/* Desktop: hover shows the description on the card. Mobile (no hover,
            tiny cards) opens the readable popup below on tap instead. */}
        <div
          className="absolute inset-0 hidden flex-col justify-end p-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 lg:flex"
          style={{
            background: vice
              ? "linear-gradient(to top, rgba(74,8,20,.96) 38%, rgba(74,8,20,.35))"
              : "linear-gradient(to top, rgba(8,16,74,.96) 38%, rgba(8,16,74,.35))",
          }}
        >
          <div className="text-[11px] font-semibold leading-tight text-cream">{r.name}</div>
          <div className="text-[9px] uppercase tracking-wide text-cream/70">
            {vice ? "Vice" : "Virtue"} · {r.cost}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-cream/90">{r.description}</p>
        </div>
      </button>
    );
  }

  // A locked role: greyed card with a lock; tap opens the unlock modal.
  function lockedCard(r: RoleDef) {
    const vice = r.camp === "vice";
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => {
          setUnlockError(null);
          setUnlockId(r.id);
        }}
        className="group relative block overflow-hidden rounded-lg border-2 bg-black/30 text-left"
        style={{ borderColor: vice ? "#9b2741" : "#3a49b8" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/cards/${r.id}.png`} alt={r.name} className="block w-full opacity-60" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 px-1 text-center">
          <IconLock size={22} className="text-cream/90" aria-hidden />
          <span className="text-[10px] font-semibold leading-tight text-cream">{r.name}</span>
          <span className="text-[9px] font-semibold text-gold">
            {ROLE_UNLOCK_COST} {LE_ABBR}
          </span>
        </div>
      </button>
    );
  }

  // Render a tier matrix for a list of roles, skipping tiers with no roles.
  function matrix(roles: RoleDef[], renderCard: (r: RoleDef) => ReactNode) {
    const rows = tiers.filter((t) => roles.some((r) => r.tier === t));
    return (
      <div className="flex flex-col gap-2.5">
        {rows.map((t) => {
          const b = band[t];
          const vc = roles.filter((r) => r.tier === t && r.camp === "vice");
          const vr = roles.filter((r) => r.tier === t && r.camp === "virtue");
          return (
            <div key={t} className="flex items-stretch gap-2.5 rounded-xl p-2.5" style={{ background: b.bg }}>
              <div
                className="flex w-8 shrink-0 items-center justify-center rounded-lg text-base font-bold"
                style={{ background: b.badge, color: b.text }}
              >
                {t}
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2 lg:grid-cols-3">{vc.map(renderCard)}</div>
              <div className="w-px shrink-0 self-stretch bg-gold/30" />
              <div className="grid flex-1 grid-cols-2 gap-2 lg:grid-cols-3">{vr.map(renderCard)}</div>
            </div>
          );
        })}
      </div>
    );
  }

  const campHeader = () => (
    <div className="mt-3 flex items-stretch gap-2.5 px-2.5">
      <div className="w-8 shrink-0" />
      <div className="flex-1 text-center text-xs font-semibold" style={{ color: "#e6889a" }}>Vice</div>
      <div className="w-px shrink-0" />
      <div className="flex-1 text-center text-xs font-semibold" style={{ color: "#9a9ce0" }}>Virtue</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Roles</h1>
        <span className="text-xs text-cream/60">
          {owned.length} owned · {locked.length} locked
        </span>
      </div>
      <p className="mt-0.5 text-xs text-cream/60">By power tier (S → D) · Vice | Virtue · hover or tap a card</p>

      {/* Roles you already own. */}
      {campHeader()}
      {matrix(owned, card)}

      {/* Roles you haven't unlocked yet — greyed + locked; tap to unlock. */}
      {locked.length > 0 && (
        <>
          <div className="mt-7 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="text-base font-semibold">Locked roles</h2>
            <span className="text-xs text-cream/55">
              Tap a role to unlock it for {ROLE_UNLOCK_COST} {LE_ABBR}
            </span>
          </div>
          {campHeader()}
          {matrix(locked, lockedCard)}
        </>
      )}

      {/* Mobile only: tap an OWNED card → readable popup with art + description. */}
      {sel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 lg:hidden"
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full max-w-xs overflow-hidden rounded-2xl border-2 bg-home-bg text-cream"
            style={{ borderColor: sel.camp === "vice" ? "#9b2741" : "#3a49b8" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/cards/${sel.id}.png`} alt={sel.name} className="block w-full" />
              <button
                onClick={() => setOpen(null)}
                aria-label="Close"
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-cream"
              >
                <IconX size={18} aria-hidden />
              </button>
            </div>
            <div className="p-4">
              <div className="text-base font-semibold">{sel.name}</div>
              <div className="text-xs uppercase tracking-wide text-cream/70">
                {sel.camp === "vice" ? "Vice" : "Virtue"} · Tier {sel.tier} · {sel.cost}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-cream/90">{sel.description}</p>
            </div>
          </div>
        </div>
      )}

      {/* Unlock modal for a locked role (desktop + mobile). */}
      {unlockRole && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setUnlockId(null)}
        >
          <div
            className="w-full max-w-xs overflow-hidden rounded-2xl border-2 bg-home-bg text-cream"
            style={{ borderColor: unlockRole.camp === "vice" ? "#9b2741" : "#3a49b8" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/cards/${unlockRole.id}.png`} alt={unlockRole.name} className="block w-full" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <IconLock size={40} className="text-cream/90 drop-shadow" aria-hidden />
              </div>
              <button
                onClick={() => setUnlockId(null)}
                aria-label="Close"
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-cream"
              >
                <IconX size={18} aria-hidden />
              </button>
            </div>
            <div className="p-4">
              <div className="text-base font-semibold">{unlockRole.name}</div>
              <div className="text-xs uppercase tracking-wide text-cream/70">
                {unlockRole.camp === "vice" ? "Vice" : "Virtue"} · Tier {unlockRole.tier} · {unlockRole.cost}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-cream/90">{unlockRole.description}</p>

              <div className="mt-4 rounded-lg border border-gold/30 bg-black/20 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-cream/70">Your balance</span>
                  <span className="font-semibold text-gold">
                    {le} {LE_ABBR}
                  </span>
                </div>
                {unlockError && (
                  <p className="mt-2 text-xs font-medium text-red-300">{unlockError}</p>
                )}
                <button
                  onClick={doUnlock}
                  disabled={unlockBusy || le < ROLE_UNLOCK_COST}
                  className="mt-3 w-full rounded-lg bg-gold py-2.5 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {unlockBusy ? "Unlocking…" : `Unlock for ${ROLE_UNLOCK_COST} ${LE_ABBR}`}
                </button>
                {le < ROLE_UNLOCK_COST && (
                  <p className="mt-1.5 text-center text-[11px] text-cream/55">
                    You need {ROLE_UNLOCK_COST - le} more {LE_ABBR}.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileSection({ profile, econ }: { profile: Profile; econ: AccountEconomy | null }) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [founderRank, setFounderRank] = useState<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      const s = await getUserStats(profile.id);
      if (!active) return;
      setStats(s);
      const e = await getEarnedBadges(profile.id, profile.created_at, s);
      if (active) setEarned(e);
      const older = await getAccountOlderCount(profile.created_at);
      if (active && older !== null) setFounderRank(older + 1);
    })().catch(() => {
      /* stats/badges are non-critical */
    });
    return () => {
      active = false;
    };
  }, [profile.id, profile.created_at]);

  const lvl = econ ? levelFromXp(econ.xp) : null;
  const isFounder = founderRank !== undefined && founderRank <= 19;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-[#372155] text-xl font-semibold">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            profile.username.slice(0, 2).toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold">{profile.username}</div>
          <div className="text-xs text-cream/60">
            Level {lvl?.level ?? 1}
            {isFounder ? " · founder" : ""}
          </div>
          {lvl && (
            <div className="mt-1.5 h-2 w-full max-w-[220px] overflow-hidden rounded-full bg-cream/15">
              <div className="h-full rounded-full bg-gold" style={{ width: `${Math.round(lvl.progress * 100)}%` }} />
            </div>
          )}
        </div>
        <Link
          href="/profile"
          className="shrink-0 rounded-lg border border-gold px-3 py-2 text-xs font-semibold text-cream transition-colors hover:bg-cream/10"
        >
          Edit profile
        </Link>
      </div>

      <RankPanel />
      <ProfileStats stats={stats} />
      <BadgesShowcase earned={earned} founderRank={founderRank} />
      <Leaderboard meUserId={profile.id} />
    </div>
  );
}

function FriendAvatar({ p }: { p: Profile }) {
  return p.avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#372155] text-xs font-semibold">
      {p.username.slice(0, 2).toUpperCase()}
    </span>
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
                  <FriendAvatar p={f.profile} />
                  <Link href={`/profile/${f.profile.id}`} className="min-w-0 flex-1 hover:opacity-80">
                    <div className="truncate text-sm font-semibold">{f.profile.username}</div>
                    <div className="text-xs text-cream/60">
                      {f.gamesTogether} {f.gamesTogether === 1 ? "game" : "games"} together
                    </div>
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

function Avatar({ url, initials }: { url: string | null; initials: string }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-gold bg-[#372155] text-xs font-semibold">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

function HudIcon({ label, onClick, badge, children }: { label: string; onClick: () => void; badge?: string | null; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-gold/50 bg-black/25 text-cream transition-colors hover:bg-cream/10">
      {children}
      {badge && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-home-bg bg-gold px-1 text-[10px] font-semibold text-home-bg">
          {badge}
        </span>
      )}
    </button>
  );
}

function PlayCard({ onClick, disabled, accent, title, note, Icon, emblem }: {
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  title: string;
  note: string;
  Icon?: typeof IconUser;
  emblem?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-[150px] flex-col rounded-2xl border bg-cream/5 p-5 text-left transition-colors hover:bg-cream/10 disabled:opacity-50 ${
        accent ? "border-gold/55" : "border-gold/25"
      }`}
    >
      {emblem ?? (
        <span className={`flex h-12 w-12 items-center justify-center rounded-full ${accent ? "bg-gold text-home-bg" : "border border-gold/50 bg-[#372155] text-cream"}`}>
          {Icon && <Icon size={24} aria-hidden />}
        </span>
      )}
      <div className="mt-auto pt-3">
        <div className="text-base font-semibold">{title}</div>
        <div className="text-xs text-cream/60">{note}</div>
      </div>
    </button>
  );
}

function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-black/25 text-gold">
        <IconChevronRight size={26} aria-hidden />
      </span>
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-cream/65">{note}</p>
      <span className="mt-3 rounded-full border border-gold/40 px-3 py-1 text-xs text-cream/70">Coming soon</span>
    </div>
  );
}

function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-2xl border border-gold/55 bg-home-bg p-5" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 text-cream/70 transition-colors hover:text-cream">
          <IconX size={20} aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}
