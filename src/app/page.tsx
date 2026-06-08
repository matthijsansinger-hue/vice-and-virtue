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
  IconBolt,
  IconDiamond,
  IconDiamonds,
  IconGift,
  IconSettings,
  IconSparkles,
  IconX,
  IconUsersPlus,
  IconTicket,
  IconChevronRight,
  IconSkull,
  IconHeart,
  IconBottle,
  IconScale,
  IconEye,
  IconMessages,
  IconGhost,
  IconFlame,
  IconCross,
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
  levelFromXp,
  LE_ABBR,
  MANO_NAME,
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
import { Leaderboard } from "@/components/Leaderboard";

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

// Per-role glyphs for the Roles matrix (matches the hub design's Tabler icons).
const ROLE_ICONS: Record<string, typeof IconUser> = {
  murder: IconSkull,
  empathy: IconHeart,
  intoxication: IconBottle,
  justice: IconScale,
  envy: IconMasksTheater,
  certainty: IconEye,
  truthfulness: IconMessages,
  torment: IconGhost,
  vengeance: IconFlame,
  sacrifice: IconCross,
  vice_worshipper: IconBolt,
  virtue_seeker: IconSparkles,
};

// Power-tier band colours for the Roles matrix rows (S..D).
const TIER_BANDS: Record<string, { bg: string; badge: string; text: string }> = {
  S: { bg: "rgba(233,198,74,.14)", badge: "#e9c64a", text: "#4e3624" },
  A: { bg: "rgba(123,75,176,.22)", badge: "#7b4bb0", text: "#fff" },
  B: { bg: "rgba(212,85,31,.18)", badge: "#d4551f", text: "#fff" },
  C: { bg: "rgba(79,157,79,.17)", badge: "#4f9d4f", text: "#fff" },
  D: { bg: "rgba(122,90,63,.22)", badge: "#7a5a3f", text: "#ffefc5" },
};

export default function HomePage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();

  const [section, setSection] = useState<Section>("play");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showRules, setShowRules] = useState(false);
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
    <main className="wood-desk-startscreen min-h-screen bg-home-bg text-cream lg:flex">
      {/* ---- Desktop sidebar ---- */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-gold/20 p-4 lg:flex">
        <div className="px-2 pb-3 text-base font-semibold leading-tight tracking-wide">
          VICE &amp;<br />VIRTUE
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
          <Link href="/profile" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-cream/70 transition-colors hover:bg-cream/5">
            <IconMedal size={18} aria-hidden /> Leaderboard
          </Link>
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
        </div>
      </aside>

      {/* ---- Content column ---- */}
      <div className="flex min-h-screen flex-1 flex-col">
        {/* HUD */}
        <header className="flex items-center gap-2 border-b border-gold/15 px-4 py-2.5">
          <span className="hidden text-base font-semibold lg:block">{sectionTitle}</span>
          {/* mobile account chip (left) */}
          {profile ? (
            <button onClick={() => go("profile")} className="lg:hidden" aria-label="Profile">
              <Avatar url={profile.avatar_url} initials={initials} />
            </button>
          ) : (
            <span className="text-base font-semibold lg:hidden">Vice &amp; Virtue</span>
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
                <HudIcon label="Soul Shards" onClick={() => { setShardReward(null); setModal("shards"); }} badge={econ && econ.unopened_shards > 0 ? String(econ.unopened_shards) : null}>
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
        <div className="flex-1 overflow-y-auto px-5 py-6 pb-24 lg:pb-8">
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
            />
          )}
          {section === "roles" && <RolesSection unlocked={econ?.unlockedRoles ?? []} />}
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
            <div className="text-xs font-semibold uppercase tracking-widest text-cream/55">Soul Shards</div>
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
              Each shard grants XP, plus a chance at Mano or a rare role unlock.
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
              <IconSparkles size={17} aria-hidden /> {shardBusy ? "Opening…" : econ && econ.unopened_shards > 0 ? "Open a shard" : "No shards to open"}
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
              You get a Soul Shard every day you log in, and another for your first win of the day.
            </p>
            <button
              onClick={claimDaily}
              disabled={dailyBusy || dailyClaimed}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 text-sm font-semibold text-home-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <IconGift size={17} aria-hidden />
              {dailyBusy ? "Claiming…" : dailyClaimed ? "Claimed — come back tomorrow" : "Claim today's Soul Shard"}
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
}) {
  const rankMeta = props.ranked ? TIER_META[tierKey(props.ranked.tierIndex)] : null;

  return (
    <div className="mx-auto max-w-5xl">
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

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div>
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

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PlayCard onClick={props.onQuickPlay} disabled={props.busy} accent title="Quick play" note="Jump into a public game" Icon={IconPlayerPlay} />
            <PlayCard
              onClick={props.onRanked}
              title="Ranked"
              note={props.ranked ? `${tierName(props.ranked.tierIndex)} · Div ${props.ranked.division} · 3v3 / 6v6` : "3v3 / 6v6 ladder"}
              emblem={
                rankMeta && props.ranked ? (
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full border-2 text-base font-bold"
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
        </div>

        {/* Side rail */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-[#7678ed]/50 bg-cream/5 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#7678ed]">Season 1</span>
              <span className="rounded-full border border-[#7678ed] px-2 py-0.5 text-[11px] text-[#a9aaf0]">Soon</span>
            </div>
            <div className="mt-1.5 text-sm font-semibold">Trials of Virtue</div>
            <p className="mt-1 text-[11px] text-cream/60">A seasonal reward track is coming soon.</p>
          </div>

          {props.profile && props.surfaceGames.length > 0 && (
            <div className="rounded-xl border border-gold/40 bg-cream/5 p-4">
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
        </div>
      </div>
    </div>
  );
}

function RolesSection({ unlocked }: { unlocked: string[] }) {
  const [sel, setSel] = useState("murder");
  const owned = new Set(unlocked);
  const all = Object.values(ROLES);
  const r = ROLES[sel] ?? all[0];
  const rVice = r.camp === "vice";
  const RIcon = ROLE_ICONS[r.id] ?? IconUser;

  function card(x: RoleDef) {
    const vice = x.camp === "vice";
    const Icon = ROLE_ICONS[x.id] ?? IconUser;
    const isSel = sel === x.id;
    return (
      <button
        key={x.id}
        onClick={() => setSel(x.id)}
        onMouseEnter={() => setSel(x.id)}
        className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-black/30 text-left transition-transform hover:-translate-y-0.5 ${
          isSel ? "-translate-y-0.5 ring-2 ring-gold" : ""
        }`}
        style={{ borderColor: vice ? "rgba(176,60,80,.6)" : "rgba(100,110,210,.6)" }}
      >
        <span
          className="flex h-9 items-center justify-center text-white"
          style={{ background: vice ? "linear-gradient(135deg,#a01030,#5a0016)" : "linear-gradient(135deg,#2433a8,#000063)" }}
        >
          <Icon size={18} aria-hidden />
        </span>
        <span className="truncate px-1.5 pt-1 text-[11px] font-semibold leading-tight">{x.name}</span>
        <span className="px-1.5 pb-1.5 text-[9px] text-cream/60">{x.tier} · {x.cost}</span>
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Roles</h1>
        <span className="text-xs text-cream/60">{owned.size}/12 owned · hover a card</span>
      </div>
      <p className="mt-0.5 text-xs text-cream/60">Across by camp · down by power tier (S → D)</p>

      <div className="mt-4 flex flex-col-reverse gap-4 lg:grid lg:grid-cols-[1fr_300px] lg:items-start">
        {/* tier matrix */}
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-[40px_1fr_1fr] gap-2 px-2 text-center text-xs font-semibold">
            <div />
            <div style={{ color: "#e6889a" }}>Vice</div>
            <div style={{ color: "#9a9ce0" }}>Virtue</div>
          </div>
          {["S", "A", "B", "C", "D"].map((t) => {
            const b = TIER_BANDS[t];
            const vice = all.filter((x) => x.tier === t && x.camp === "vice");
            const vir = all.filter((x) => x.tier === t && x.camp === "virtue");
            return (
              <div key={t} className="grid grid-cols-[40px_1fr_1fr] gap-2 rounded-xl p-2" style={{ background: b.bg }}>
                <div className="flex items-center justify-center rounded-lg text-sm font-semibold" style={{ background: b.badge, color: b.text }}>
                  {t}
                </div>
                <div className="flex gap-1.5">{vice.map(card)}</div>
                <div className="flex gap-1.5">{vir.map(card)}</div>
              </div>
            );
          })}
        </div>

        {/* detail panel */}
        <div className="rounded-xl border border-gold/30 bg-cream/5 p-4 lg:sticky lg:top-0">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full border-2 text-white"
              style={{
                background: rVice ? "linear-gradient(135deg,#a01030,#5a0016)" : "linear-gradient(135deg,#2433a8,#000063)",
                borderColor: rVice ? "#b03c50" : "#5a6ad2",
              }}
            >
              <RIcon size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{r.name}</div>
              <div className="text-[11px] text-cream/60">{rVice ? "Vice" : "Virtue"} · Tier {r.tier} · {r.cost}</div>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-cream/85">{r.ability}</p>
          <p className="mt-2 text-xs leading-relaxed text-cream/65">{r.description}</p>
        </div>
      </div>
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
      className={`rounded-2xl border bg-cream/5 p-4 text-left transition-colors hover:bg-cream/10 disabled:opacity-50 ${
        accent ? "border-gold/55" : "border-gold/25"
      }`}
    >
      {emblem ?? (
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${accent ? "bg-gold text-home-bg" : "border border-gold/50 bg-[#372155] text-cream"}`}>
          {Icon && <Icon size={20} aria-hidden />}
        </span>
      )}
      <div className="mt-2.5 text-sm font-semibold">{title}</div>
      <div className="text-[11px] text-cream/60">{note}</div>
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
